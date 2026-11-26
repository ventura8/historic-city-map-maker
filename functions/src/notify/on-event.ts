import '../global-options.js';

import {
    ADMIN_CITY_SEGMENT,
    BACKGROUND_FUNCTIONS,
    FIRESTORE_PATHS,
    INBOX_MAX_ITEMS,
    NOTIFICATION_EVENT_DAYS,
    NOTIFICATION_ID_PATTERN,
    adminCityLink,
    adminDocSchema,
    cityRoleOf,
    inboxItemDocSchema,
    isContributorOnly,
    isReviewRole,
    isStaffRole,
    notificationAudience,
    notificationEventDocSchema,
    notifySettingsDocSchema,
    systemWriter,
    timestampFromDate,
    validate,
    wantsPush,
    type AdminDoc,
    type CityRole,
    type InboxItemDoc,
    type NotificationEventDoc,
} from '@hcm/shared';
import { onDocumentCreated } from 'firebase-functions/firestore';

import { runAs } from '../global-options.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { NOTIFY_WRITER, adminAddress, devicesOf, notificationText, pushToDevices } from './messages.js';

/**
 * `notify.onEvent` (Firestore trigger on `notificationEvents/{eventId}`, `fn-events@`; `docs/research/M4-interfaces.md`
 * §5.3; S-A46-HAPPY-FAN-OUT, S-A47-HAPPY, S-A47-BAD-TOKEN-UNREGISTERED; M5: S-A51-HAPPY-INBOX, only a city's admins get its
 * events, linked into that city): every admin gets the event as an unread inbox
 * item (`admins/{uid}/inbox/{eventId}`, created: a redelivery finds it and writes nothing); an admin whose settings push
 * the event's kind (`wantsPush`) gets it on every device they allowed, in each device's language, and the devices FCM no
 * longer knows are forgotten. Each inbox keeps its newest `INBOX_MAX_ITEMS`: an aggregation counts the inbox (one read)
 * and only the oldest items past the limit are read and deleted, so a full inbox costs a few reads per event, never the
 * whole inbox; events older than `NOTIFICATION_EVENT_DAYS` are deleted, 50 a run. The event records when it was fanned out and to how many admins.
 * Every step is idempotent, so the trigger retries after a transient failure; a push failure never holds the inbox back.
 */
export type FanOutDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'push' | 'config'>;

/** How many old items or events one run deletes at most. */
const PRUNE_BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function stampOf(now: Date) {
    return { updatedBy: systemWriter(NOTIFY_WRITER), updatedAt: timestampFromDate(now) };
}

/**
 * M5 (`docs/research/M5-interfaces.md` §1.9): a city's event opens in its city (`#/c/<city>/<route>`), whatever city the
 * admin's page shows; a project event, or a link the router would not take as a route, is kept as it is.
 */
function itemLink(event: Pick<NotificationEventDoc, 'cityId' | 'link'>): string {
    if (event.cityId === undefined || event.link.startsWith(`#/${ADMIN_CITY_SEGMENT}/`)) {
        return event.link;
    }
    try {
        return adminCityLink(event.cityId, event.link.slice(2));
    } catch {
        return event.link;
    }
}

/** M13 §7: whether this role hears of this kind of a city's event. */
function hears(kind: NotificationEventDoc['kind'], role: CityRole | null): boolean {
    const audience = notificationAudience(kind);
    if (audience === 'owners') {
        return role === 'owner';
    }
    return audience === 'reviewers' ? isReviewRole(role) : isStaffRole(role);
}

/**
 * M5: a city's event goes to that city's admins only; a project event (no city) to every admin. M13 §7: each to its audience,
 * so a moderator or an uploader hears nothing of imagery, budgets or crashes.
 */
function concerns(event: NotificationEventDoc, admin: AdminDoc): boolean {
    if (event.cityId === undefined) {
        return !isContributorOnly(admin.cities);
    }
    return hears(event.kind, cityRoleOf(admin.cities, event.cityId));
}

function itemOf(event: NotificationEventDoc, now: Date): InboxItemDoc {
    return {
        kind: event.kind,
        severity: event.severity,
        ...(event.cityId === undefined ? {} : { cityId: event.cityId }),
        params: event.params,
        link: itemLink(event),
        createdAt: event.createdAt,
        read: false,
        ...stampOf(now),
    };
}

/** Creates the admin's item; false when it exists already (a redelivered event). */
async function deliver(deps: FanOutDeps, uid: string, eventId: string, item: InboxItemDoc): Promise<boolean> {
    try {
        await deps.documents.create(FIRESTORE_PATHS.inboxItem(uid, eventId), inboxItemDocSchema, item);
        return true;
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'conflict') {
            return false;
        }
        throw error;
    }
}

/** Pushes the item to the admin's devices when their settings ask for its kind; marks the item pushed. */
async function push(deps: FanOutDeps, uid: string, eventId: string, item: InboxItemDoc): Promise<void> {
    const settings = await deps.documents.get(FIRESTORE_PATHS.notifySettings(uid), notifySettingsDocSchema);
    const devices = wantsPush(settings, item.kind) ? await devicesOf(deps, uid) : [];
    if (devices.length === 0) {
        return;
    }
    const content = {
        body: (locale: 'ro' | 'en') => notificationText(locale, item.kind, item.params),
        link: adminAddress(deps, item.link),
        tag: eventId,
    };
    const result = await pushToDevices(deps, uid, devices, content).catch((error: unknown) => {
        deps.log.warn('push failed: the inbox still has it', { uid, eventId, error: String(error) });
        return { sent: 0, removed: 0 };
    });
    if (result.sent > 0) {
        await markPushed(deps, uid, eventId);
    }
}

/**
 * Records when the item was pushed, on the item as it is now: the admin may have opened it meanwhile, and a write of the
 * item as delivered would make it unread again.
 */
async function markPushed(deps: FanOutDeps, uid: string, eventId: string): Promise<void> {
    const path = FIRESTORE_PATHS.inboxItem(uid, eventId);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, inboxItemDocSchema);
        if (current !== undefined) {
            await transaction.set(path, inboxItemDocSchema, { ...current, pushedAt: timestampFromDate(now), ...stampOf(now) });
        }
    });
}

/** Keeps the admin's newest `INBOX_MAX_ITEMS` items: counts them, then reads and deletes only the oldest over the limit. */
async function pruneInbox(deps: FanOutDeps, uid: string): Promise<void> {
    const inbox = FIRESTORE_PATHS.inbox(uid);
    const over = (await deps.documents.count(inbox)) - INBOX_MAX_ITEMS;
    if (over <= 0) {
        return;
    }
    const oldest = await deps.documents.query(inbox, inboxItemDocSchema, {
        orderBy: ['createdAt', 'asc'],
        limit: Math.min(over, PRUNE_BATCH),
    });
    for (const old of [...oldest.documents, ...oldest.invalid]) {
        await deps.documents.delete(old.path);
    }
}

/** Deletes up to `PRUNE_BATCH` events older than `NOTIFICATION_EVENT_DAYS`. */
async function pruneEvents(deps: FanOutDeps, now: Date): Promise<number> {
    const cutoff = timestampFromDate(new Date(now.getTime() - NOTIFICATION_EVENT_DAYS * DAY_MS));
    const old = await deps.documents.query(FIRESTORE_PATHS.notificationEvents, notificationEventDocSchema, {
        where: [['createdAt', '<', cutoff]],
        limit: PRUNE_BATCH,
    });
    for (const event of old.documents) {
        await deps.documents.delete(event.path);
    }
    return old.documents.length;
}

/** Fans one event out; returns how many admins have it. */
export async function fanOut(deps: FanOutDeps, eventId: string, event: NotificationEventDoc): Promise<number> {
    const now = deps.clock.now();
    const admins = (await deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema)).documents.filter((admin) =>
        concerns(event, admin.data),
    );
    const item = itemOf(event, now);
    for (const admin of admins) {
        if (await deliver(deps, admin.id, eventId, item)) {
            await push(deps, admin.id, eventId, item);
        }
        await pruneInbox(deps, admin.id);
    }
    const pruned = await pruneEvents(deps, now);
    const recipients = admins.length;
    await deps.documents.set(FIRESTORE_PATHS.notificationEvent(eventId), notificationEventDocSchema, {
        ...event,
        fannedOutAt: timestampFromDate(now),
        recipients,
        ...stampOf(now),
    });
    deps.log.info('notification fanned out', { eventId, kind: event.kind, recipients, pruned });
    return recipients;
}

/** A created event as the trigger received it: the event, or undefined (logged) for one nobody should fan out. */
export function eventOf(deps: Pick<Ports, 'log'>, eventId: string, data: unknown): NotificationEventDoc | undefined {
    const parsed = NOTIFICATION_ID_PATTERN.test(eventId) ? validate(notificationEventDocSchema, data) : undefined;
    if (parsed?.ok !== true) {
        deps.log.error('notification event refused', { eventId: eventId.slice(0, 100) });
        return undefined;
    }
    return parsed.value;
}

/** The `notify-onEvent` trigger: retried after a transient failure (every step is idempotent). */
export function onEventFunction(getDeps: () => FanOutDeps) {
    return onDocumentCreated(
        { document: BACKGROUND_FUNCTIONS['notify.onEvent'].source, retry: true, maxInstances: 2, ...runAs('notify.onEvent') },
        async (event) => {
            const deps = getDeps();
            const eventId = (event.params as { readonly eventId: string }).eventId;
            const notification = eventOf(deps, eventId, event.data?.data());
            if (notification !== undefined) {
                await fanOut(deps, eventId, notification);
            }
        },
    );
}
