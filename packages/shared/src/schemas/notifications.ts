/**
 * Notifications (M4; `docs/research/M4-interfaces.md` §5): what happened that an admin should know without watching a
 * page. A producer (the order watch, the imagery dispatcher, the budget alert, the USGS approval check, the crash check)
 * writes one **event** per occurrence, under an id built from what happened, so a redelivered trigger writes nothing new;
 * `notify.onEvent` fans it out to every admin's **inbox** (one item each, read state per admin, the shell's badge) and,
 * for the kinds an admin chose, to the browsers they allowed (**push**, FCM web push, only after the browser's own
 * permission prompt). No e-mail provider, no new account, no new paid service. Every text is the admin catalogue's
 * (`adminContent.notify.event.<kind>`), filled with the event's parameters as plain text.
 */
import { z } from 'zod';

import { LOCALES } from '../i18n/index.js';
import { stamp, timestampSchema } from './firestore-common.js';
import { CITY_ID_PATTERN, NOTIFICATION_ID_PATTERN } from './paths.js';
import { coded, ID_PATTERN } from './primitives.js';

/** Everything an admin can be told, in the order of the notification settings. */
export const NOTIFICATION_KINDS = [
    'usgs.approved',
    'order.delivered',
    'order.imported',
    'order.reminder',
    'order.expired',
    'job.failed',
    'layer.readyToApprove',
    'layer.needsPoints',
    'budget.paused',
    'crash.spike',
    // M7 (docs/research/M7-local-worker.md §4.3): a cloud run made by automation waits for the admin's OK past the free tier.
    'job.needsOk',
    // Finding 68 of 2026-11-02: a job waited for the computer WORKER_WAIT_MINUTES and no computer came.
    'job.noWorker',
    // M13 (docs/research/M13-roles.md §7): an uploader's item, a public suggestion, a role request wait for an answer.
    'review.waiting',
    'suggestion.waiting',
    'role.requested',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'error'] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

interface NotificationSpec {
    readonly severity: NotificationSeverity;
    /** Pushed by default once an admin turns push on (they may change each kind). */
    readonly push: boolean;
}

/** How loud each kind is: the inbox item's colour, and whether push starts on for it. */
export const NOTIFICATION_SPECS: Readonly<Record<NotificationKind, NotificationSpec>> = {
    'usgs.approved': { severity: 'info', push: true },
    'order.delivered': { severity: 'info', push: true },
    'order.imported': { severity: 'info', push: false },
    'order.reminder': { severity: 'warning', push: true },
    'order.expired': { severity: 'warning', push: true },
    'job.failed': { severity: 'error', push: true },
    'layer.readyToApprove': { severity: 'info', push: true },
    // Pushed too: a bought scan whose automatic points failed waits for the admin, who otherwise learns it only in the inbox.
    'layer.needsPoints': { severity: 'info', push: true },
    'budget.paused': { severity: 'error', push: true },
    'crash.spike': { severity: 'warning', push: true },
    'job.needsOk': { severity: 'warning', push: true },
    'job.noWorker': { severity: 'warning', push: true },
    'review.waiting': { severity: 'info', push: true },
    'suggestion.waiting': { severity: 'info', push: false },
    'role.requested': { severity: 'info', push: true },
};

/** M13 §7: who hears of each kind. Every kind before M13 is about the project or its imagery: its staff. */
export type NotificationAudience = 'staff' | 'reviewers' | 'owners';

export function notificationAudience(kind: NotificationKind): NotificationAudience {
    if (kind === 'role.requested') {
        return 'owners';
    }
    return kind === 'review.waiting' || kind === 'suggestion.waiting' ? 'reviewers' : 'staff';
}

/** The kinds pushed when an admin turns push on and changes nothing else. */
export const DEFAULT_PUSH_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS.filter((kind) => NOTIFICATION_SPECS[kind].push);

/** Each admin's inbox keeps its newest items; the fan-out deletes older ones. */
export const INBOX_MAX_ITEMS = 200;
/** The badge counts up to this, then shows `99+`. */
export const INBOX_BADGE_MAX = 99;
/** The browsers one admin may register for push; a sixth replaces the oldest. */
export const PUSH_DEVICES_MAX = 5;
/** Events are kept this long (the fan-out deletes older ones), long enough to see why an inbox item exists. */
export const NOTIFICATION_EVENT_DAYS = 90;
/** `crash.spike`: this many new crash reports within an hour (checked by `ops.tick`), at most one event a day. */
export const CRASH_SPIKE_THRESHOLD = 10;

/** An admin route an item opens (`#/imagery/scene/<id>`, `#/jobs`): never another origin, never a `javascript:` URL. */
export const ADMIN_LINK_PATTERN = /^#\/[A-Za-z0-9/_-]{0,200}$/;

const MAX_PARAMS = 8;

/** The message's `{placeholders}`: plain strings, rendered as text. */
const notificationParamsSchema = z
    .record(z.string().regex(/^[a-zA-Z]{1,30}$/), z.string().max(200))
    .refine((params) => Object.keys(params).length <= MAX_PARAMS, coded('validation.tooBig'));

/** What every event and inbox item says. */
const notice = {
    kind: z.enum(NOTIFICATION_KINDS),
    severity: z.enum(NOTIFICATION_SEVERITIES),
    /** The city it is about (absent for the project's own: the budget, USGS approval, crashes). */
    cityId: z.string().regex(CITY_ID_PATTERN).optional(),
    params: notificationParamsSchema,
    link: z.string().regex(ADMIN_LINK_PATTERN),
    createdAt: timestampSchema,
};

/** `notificationEvents/{eventId}`: written once by its producer (create-only), then fanned out by `notify.onEvent`. */
export const notificationEventDocSchema = z.strictObject({
    ...notice,
    /** When `notify.onEvent` wrote the inbox items, and for how many admins. */
    fannedOutAt: timestampSchema.optional(),
    recipients: z.number().int().min(0).max(1000).optional(),
    ...stamp,
});

/** `admins/{uid}/inbox/{eventId}`: one admin's copy; the admin marks it read (the only client write). */
export const inboxItemDocSchema = z.strictObject({
    ...notice,
    read: z.boolean(),
    readAt: timestampSchema.optional(),
    /** When it was pushed to the admin's devices (absent: not pushed). */
    pushedAt: timestampSchema.optional(),
    ...stamp,
});

/** `admins/{uid}/notify/settings`: written by the admin; absent means push off. */
export const notifySettingsDocSchema = z.strictObject({
    /** The admin turned push on in this account (each browser still asks its own permission). */
    push: z.boolean(),
    /** When the admin's client created it (absent when `notify.registerDevice` did, CR-M4-10). */
    createdAt: timestampSchema.optional(),
    pushKinds: z
        .array(z.enum(NOTIFICATION_KINDS))
        .max(NOTIFICATION_KINDS.length)
        .refine((kinds) => new Set(kinds).size === kinds.length, coded('validation.duplicateId')),
    ...stamp,
});

/**
 * How FCM addresses a browser (finding 50 of 2026-11-01): an FCM registration `token` (what `getToken` gives; FCM HTTP v1's
 * `message.token`), or a Firebase installation id (`fid`: what `register` gives; `message.fid`).
 */
export const PUSH_TARGET_KINDS = ['token', 'fid'] as const;

export type PushTargetKind = (typeof PUSH_TARGET_KINDS)[number];

/** `admins/{uid}/pushDevices/{deviceId}`: written by `notify.registerDevice` only (the token is checked with FCM first). */
export const pushDeviceDocSchema = z.strictObject({
    /** The FCM registration token of one browser (not a secret, but only the admin and the server read it). */
    token: z
        .string()
        .min(20)
        .max(4096)
        .regex(/^[A-Za-z0-9_:.-]+$/),
    /** What `token` is (finding 50); a device without one was registered before and is an installation id. */
    kind: z.enum(PUSH_TARGET_KINDS).optional(),
    /** The language its notifications are written in. */
    lang: z.enum(LOCALES),
    createdAt: timestampSchema,
    lastPushedAt: timestampSchema.optional(),
    ...stamp,
});

export type NotificationEventDoc = z.infer<typeof notificationEventDocSchema>;
export type InboxItemDoc = z.infer<typeof inboxItemDocSchema>;
export type NotifySettingsDoc = z.infer<typeof notifySettingsDocSchema>;
export type PushDeviceDoc = z.infer<typeof pushDeviceDocSchema>;

/**
 * The id of an event: its kind and what identifies the occurrence (`notificationEventId('order.reminder', 'bucharest',
 * 'DS1105-1071DF076', '7')`). The same occurrence always gets the same id, so a producer that runs twice writes it once
 * (its `create` finds it). Throws a `RangeError` for parts that are not ids (a programming error).
 */
export function notificationEventId(kind: NotificationKind, ...parts: readonly string[]): string {
    const id = [kind, ...parts].join('~');
    if (parts.length === 0 || !parts.every((part) => ID_PATTERN.test(part)) || !NOTIFICATION_ID_PATTERN.test(id)) {
        throw new RangeError(`not a notification id: ${JSON.stringify(id)}`);
    }
    return id;
}

/** True when the admin's settings push `kind` (push turned on, and the kind chosen). */
export function wantsPush(settings: Pick<NotifySettingsDoc, 'push' | 'pushKinds'> | undefined, kind: NotificationKind): boolean {
    return settings?.push === true && settings.pushKinds.includes(kind);
}

/**
 * A parameter's English text, when the producer had one (`label` and `labelEn`): the message is filled in each reader's
 * language from the same event. Every other parameter is the same in both languages.
 */
const ENGLISH_SUFFIX = 'En';

/** The parameters of an event as a reader of `locale` sees them: `<name>En` replaces `<name>` in English. */
export function paramsIn(locale: 'ro' | 'en', params: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
    const own = Object.entries(params).filter(([name]) => !name.endsWith(ENGLISH_SUFFIX));
    return Object.fromEntries(own.map(([name, value]) => [name, locale === 'en' ? (params[`${name}${ENGLISH_SUFFIX}`] ?? value) : value]));
}

/** `ops/crashes`: the crash-spike check's baseline (M4 §5.1, CR-M4-8), written by `ops.tick` only. */
export const OPS_CRASHES_PATH = 'ops/crashes';

export const crashCounterDocSchema = z.strictObject({
    /** The summed counts of the last 24 hours' crash groups when the current hour's window opened. */
    baseline: z.number().int().min(0),
    baselineAt: timestampSchema,
    /** The summed counts at the last check. */
    lastTotal: z.number().int().min(0),
    ...stamp,
});

export type CrashCounterDoc = z.infer<typeof crashCounterDocSchema>;
