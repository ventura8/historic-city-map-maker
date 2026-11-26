/**
 * The fan-out (`functions/src/notify/on-event.ts`, `docs/research/M4-interfaces.md` §5.3): one event becomes one unread
 * inbox item per admin, once; the admins whose settings push its kind get it on their devices in each device's language
 * through the fake FCM; the inbox and the events are pruned; a push failure never holds the inbox back.
 */
import {
    FIRESTORE_PATHS,
    INBOX_MAX_ITEMS,
    inboxItemDocSchema,
    notificationEventDocSchema,
    notifySettingsDocSchema,
    pushDeviceDocSchema,
    timestampFromDate,
    type InboxItemDoc,
    type NotificationEventDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { notificationEvent } from '../../src/api/notification-event.js';
import { notifyFunctions } from '../../src/notify/index.js';
import { eventOf, fanOut, onEventFunction } from '../../src/notify/on-event.js';
import { m4Deps, seedAdmin, type M4Deps } from '../assist/world.js';
import { fcmToken } from '../support/m4-upstreams.js';

const NOW = '2026-10-24T08:30:00.000Z';
const EVENT_ID = 'job.failed~assist-city~job-1~0';

function failedJob(createdAt = NOW): NotificationEventDoc {
    return notificationEvent(
        {
            kind: 'job.failed',
            parts: ['assist-city', 'job-1', '0'],
            params: { label: 'Corona 1968', labelEn: 'Corona 1968 (EN)' },
            link: '#/imagery/version/job-1',
            cityId: 'assist-city',
        },
        'imagery',
        new Date(createdAt),
    );
}

function item(deps: M4Deps, uid: string, eventId = EVENT_ID): Promise<InboxItemDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.inboxItem(uid, eventId), inboxItemDocSchema);
}

async function seedDevice(deps: M4Deps, uid: string, deviceId: string, lang: 'ro' | 'en'): Promise<string> {
    const token = fcmToken(deviceId);
    await deps.documents.set(FIRESTORE_PATHS.pushDevice(uid, deviceId.padEnd(32, '0')), pushDeviceDocSchema, {
        token,
        kind: 'token',
        lang,
        createdAt: timestampFromDate(new Date(NOW)),
        updatedBy: uid,
        updatedAt: timestampFromDate(new Date(NOW)),
    });
    return token;
}

async function pushOn(deps: M4Deps, uid: string, kinds: InboxItemDoc['kind'][] = ['job.failed']): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.notifySettings(uid), notifySettingsDocSchema, {
        push: true,
        pushKinds: kinds,
        updatedBy: uid,
        updatedAt: timestampFromDate(new Date(NOW)),
    });
}

async function world(): Promise<M4Deps> {
    const deps = m4Deps(NOW);
    await seedAdmin(deps, 'u-admin', { role: 'owner' });
    await seedAdmin(deps, 'u-second');
    await deps.documents.create(FIRESTORE_PATHS.notificationEvent(EVENT_ID), notificationEventDocSchema, failedJob());
    return deps;
}

describe('notify.onEvent', () => {
    it('happyPath_oneEventBecomesOneUnreadItemPerAdminOnce @S-A46-HAPPY-FAN-OUT', async () => {
        const deps = await world();

        await expect(fanOut(deps, EVENT_ID, failedJob())).resolves.toBe(2);

        const expected: InboxItemDoc = {
            kind: 'job.failed',
            severity: 'error',
            cityId: 'assist-city',
            params: { label: 'Corona 1968', labelEn: 'Corona 1968 (EN)' },
            link: '#/c/assist-city/imagery/version/job-1',
            createdAt: timestampFromDate(new Date(NOW)),
            read: false,
            updatedBy: 'system:notify',
            updatedAt: timestampFromDate(new Date(NOW)),
        };
        await expect(item(deps, 'u-admin')).resolves.toEqual(expected);
        await expect(item(deps, 'u-second')).resolves.toEqual(expected);
        await expect(deps.documents.get(FIRESTORE_PATHS.notificationEvent(EVENT_ID), notificationEventDocSchema)).resolves.toMatchObject({
            fannedOutAt: timestampFromDate(new Date(NOW)),
            recipients: 2,
        });

        const writes = deps.documents.writes.length;
        await deps.documents.set(FIRESTORE_PATHS.inboxItem('u-admin', EVENT_ID), inboxItemDocSchema, {
            ...expected,
            read: true,
            updatedBy: 'u-admin',
        });
        await fanOut(deps, EVENT_ID, failedJob());

        await expect(item(deps, 'u-admin')).resolves.toMatchObject({ read: true });
        expect(deps.documents.writes.slice(writes + 1).filter((write) => write.path.includes('/inbox/'))).toEqual([]);
    });

    it('happyPath_anInboxPastItsLimitLosesItsOldestAndOldEventsAreDeleted', async () => {
        const deps = await world();
        const base = Date.parse(NOW) - 60_000;
        for (let index = 0; index < INBOX_MAX_ITEMS; index += 1) {
            const old = { ...failedJob(new Date(base - index * 1000).toISOString()), read: false };
            await deps.documents.set(FIRESTORE_PATHS.inboxItem('u-admin', `job.failed~old~j${String(index)}~0`), inboxItemDocSchema, old);
        }
        const ancient = failedJob('2026-07-01T00:00:00.000Z');
        await deps.documents.set(FIRESTORE_PATHS.notificationEvent('job.failed~old~ancient~0'), notificationEventDocSchema, ancient);

        await fanOut(deps, EVENT_ID, failedJob());

        expect(deps.documents.paths('admins/u-admin/inbox/')).toHaveLength(INBOX_MAX_ITEMS);
        await expect(item(deps, 'u-admin', `job.failed~old~j${String(INBOX_MAX_ITEMS - 1)}~0`)).resolves.toBeUndefined();
        await expect(item(deps, 'u-admin')).resolves.toMatchObject({ read: false });
        expect(deps.documents.paths('notificationEvents/')).toEqual([`notificationEvents/${EVENT_ID}`]);
        // The full inbox is counted, and only its one item over the limit is read (security review: not 250 reads an event).
        const inbox = FIRESTORE_PATHS.inbox('u-admin');
        expect(deps.documents.recorder.argsOf('query').filter(([path]) => path === inbox)).toEqual([
            [inbox, { orderBy: ['createdAt', 'asc'], limit: 1 }],
        ]);
    });

    it('happyPath_anInboxUnderItsLimitIsCountedAndNeverRead @S-A46-HAPPY-FAN-OUT', async () => {
        const deps = await world();

        await fanOut(deps, EVENT_ID, failedJob());

        const inbox = FIRESTORE_PATHS.inbox('u-admin');
        expect(deps.documents.recorder.argsOf('count')).toContainEqual([inbox, []]);
        expect(deps.documents.recorder.argsOf('query').filter(([path]) => path === inbox)).toEqual([]);
    });
});

describe('notify.onEvent: the pushes', () => {
    it('happyPath_theChosenKindsArePushedInEachDevicesLanguage', async () => {
        const deps = await world();
        await pushOn(deps, 'u-admin');
        const roToken = await seedDevice(deps, 'u-admin', 'aaaa', 'ro');
        const enToken = await seedDevice(deps, 'u-admin', 'bbbb', 'en');
        await pushOn(deps, 'u-second', ['budget.paused']);
        await seedDevice(deps, 'u-second', 'cccc', 'ro');

        await fanOut(deps, EVENT_ID, failedJob());

        expect(deps.upstream.state.fcm.messages).toEqual([
            {
                token: roToken,
                kind: 'token',
                notification: {
                    title: 'Notificări',
                    body: 'Procesarea „Corona 1968” a eșuat. Deschide-o ca să vezi de ce.',
                    tag: EVENT_ID,
                },
                link: 'https://demo-hcm.web.app/#/c/assist-city/imagery/version/job-1',
            },
            {
                token: enToken,
                kind: 'token',
                notification: { title: 'Notifications', body: 'Processing “Corona 1968 (EN)” failed. Open it to see why.', tag: EVENT_ID },
                link: 'https://demo-hcm.web.app/#/c/assist-city/imagery/version/job-1',
            },
        ]);
        await expect(item(deps, 'u-admin')).resolves.toMatchObject({ pushedAt: timestampFromDate(new Date(NOW)) });
        await expect(item(deps, 'u-second')).resolves.not.toHaveProperty('pushedAt');
    });

    it('badPath_aDeviceFcmForgotIsDeletedAndTheOthersStillPushed @S-A47-BAD-TOKEN-UNREGISTERED', async () => {
        const deps = await world();
        await pushOn(deps, 'u-admin');
        const gone = await seedDevice(deps, 'u-admin', 'aaaa', 'ro');
        const kept = await seedDevice(deps, 'u-admin', 'bbbb', 'ro');
        deps.upstream.state.fcm.unregistered.add(gone);

        await fanOut(deps, EVENT_ID, failedJob());

        expect(deps.upstream.state.fcm.messages.map((message) => message.token)).toEqual([kept]);
        expect(deps.documents.paths('admins/u-admin/pushDevices/')).toEqual([`admins/u-admin/pushDevices/${'bbbb'.padEnd(32, '0')}`]);
    });

    it('badPath_anItemOpenedOrPrunedWhilePushingStaysAsTheAdminLeftIt', async () => {
        const deps = await world();
        await pushOn(deps, 'u-admin');
        await seedDevice(deps, 'u-admin', 'aaaa', 'ro');
        await pushOn(deps, 'u-second');
        await seedDevice(deps, 'u-second', 'bbbb', 'ro');
        const read = { read: true, readAt: timestampFromDate(new Date(NOW)), updatedBy: 'u-admin' };
        // While FCM sends, the first admin opens the item and the second admin's inbox loses it.
        const send = deps.push.send.bind(deps.push);
        const racing: M4Deps = {
            ...deps,
            push: {
                ...deps.push,
                send: async (tokens, message) => {
                    const opened = await item(deps, 'u-admin');
                    if (opened !== undefined && opened.pushedAt === undefined && !opened.read) {
                        await deps.documents.set(FIRESTORE_PATHS.inboxItem('u-admin', EVENT_ID), inboxItemDocSchema, {
                            ...opened,
                            ...read,
                        });
                    } else {
                        await deps.documents.delete(FIRESTORE_PATHS.inboxItem('u-second', EVENT_ID));
                    }
                    return send(tokens, message);
                },
            },
        };

        await fanOut(racing, EVENT_ID, failedJob());

        await expect(item(deps, 'u-admin')).resolves.toMatchObject({ read: true, pushedAt: timestampFromDate(new Date(NOW)) });
        await expect(item(deps, 'u-second')).resolves.toBeUndefined();
    });

    it('badPath_anFcmOutageLeavesTheInboxItemUnpushed', async () => {
        const deps = await world();
        await pushOn(deps, 'u-admin');
        await seedDevice(deps, 'u-admin', 'aaaa', 'ro');
        deps.upstream.fail('fcm', 'forbidden');

        await fanOut(deps, EVENT_ID, failedJob());

        await expect(item(deps, 'u-admin')).resolves.not.toHaveProperty('pushedAt');
        expect(deps.recording.records.some((record) => record.message === 'push failed: the inbox still has it')).toBe(true);
    });

    it('badPath_pushOnWithoutADeviceSendsNothing', async () => {
        const deps = await world();
        await pushOn(deps, 'u-admin');

        await fanOut(deps, EVENT_ID, failedJob());

        expect(deps.upstream.callsTo('fcm')).toEqual([]);
    });

    it('happyPath_aProjectsOwnEventHasNoCity', async () => {
        const deps = await world();
        const approved = notificationEvent({ kind: 'usgs.approved', parts: ['download'], link: '#/imagery' }, 'ops', new Date(NOW));

        await fanOut(deps, 'usgs.approved~download', approved);

        await expect(item(deps, 'u-admin', 'usgs.approved~download')).resolves.not.toHaveProperty('cityId');
        await expect(item(deps, 'u-admin', 'usgs.approved~download')).resolves.toMatchObject({ link: '#/imagery' });
    });

    it('happyPath_aCitysEventReachesOnlyItsAdminsAndAProjectEventEveryone @S-A51-HAPPY-INBOX', async () => {
        const deps = await world();
        await seedAdmin(deps, 'u-other-city', { cities: { cluj: 'owner' } });
        await seedAdmin(deps, 'u-before-m5', { cities: undefined });
        const paused = notificationEvent({ kind: 'budget.paused', parts: ['2026-10-24'], link: '#/imagery' }, 'ops', new Date(NOW));

        await expect(fanOut(deps, EVENT_ID, failedJob())).resolves.toBe(2);
        await expect(fanOut(deps, 'budget.paused~2026-10-24', paused)).resolves.toBe(4);

        await expect(item(deps, 'u-other-city')).resolves.toBeUndefined();
        await expect(item(deps, 'u-before-m5')).resolves.toBeUndefined();
        await expect(item(deps, 'u-other-city', 'budget.paused~2026-10-24')).resolves.toMatchObject({ link: '#/imagery' });
    });

    it.each([
        ['already a city link', '#/c/assist-city/jobs', '#/c/assist-city/jobs'],
        ['a link the router would not take as a route', '#/', '#/'],
    ])('badPath_aCityEventWhoseLinkIs%sKeepsIt', async (_name, link, kept) => {
        const deps = await world();
        const event = { ...failedJob(), link };

        await fanOut(deps, EVENT_ID, event);

        await expect(item(deps, 'u-admin')).resolves.toMatchObject({ link: kept });
    });

    it('badPath_aFailedInboxWriteIsTheTriggersToRetry', async () => {
        const deps = await world();
        deps.documents.recorder.failNext('create', new Error('unavailable'));

        await expect(fanOut(deps, EVENT_ID, failedJob())).rejects.toThrow('unavailable');
    });
});

describe('the trigger', () => {
    it('happyPath_aCreatedEventIsFannedOut', async () => {
        const deps = await world();
        const event = { params: { eventId: EVENT_ID }, data: { data: () => failedJob() } };

        await onEventFunction(() => deps).run(event as unknown as Parameters<ReturnType<typeof onEventFunction>['run']>[0]);

        await expect(item(deps, 'u-second')).resolves.toMatchObject({ read: false });
        expect(onEventFunction(() => deps).__endpoint.eventTrigger?.retry).toBe(true);
        expect(Object.keys(notifyFunctions(() => deps)).sort((a, b) => a.localeCompare(b))).toEqual([
            'onEvent',
            'registerDevice',
            'sendTest',
            'unregisterDevice',
        ]);
    });

    it('badPath_anEventWithoutDataIsRefused', async () => {
        const deps = await world();
        const event = { params: { eventId: EVENT_ID }, data: undefined };

        await onEventFunction(() => deps).run(event as unknown as Parameters<ReturnType<typeof onEventFunction>['run']>[0]);

        expect(deps.documents.paths('admins/u-admin/inbox/')).toEqual([]);
    });

    it.each([
        ['a malformed id', 'job.failed', failedJob()],
        ['a document that is no event', EVENT_ID, { kind: 'job.failed' }],
    ])('badPath_%s_isLoggedAndNotFannedOut', (_name, eventId, data) => {
        const deps = m4Deps(NOW);

        expect(eventOf(deps, eventId, data)).toBeUndefined();
        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'error', message: 'notification event refused' });
    });
});

describe('notify.onEvent: the audience of each kind (M13)', () => {
    it('happyPath_eachKindReachesItsAudience @S-A90-HAPPY-NOTIFIED', async () => {
        const deps = await world();
        await seedAdmin(deps, 'u-moderator', { cities: { 'assist-city': 'moderator' } });
        await seedAdmin(deps, 'u-uploader', { cities: { 'assist-city': 'uploader' } });
        const told = async (kind: 'review.waiting' | 'role.requested' | 'job.failed' | 'budget.paused', cityId?: string) => {
            const id = `${kind}~x`;
            const event = notificationEvent(
                { kind, parts: ['x'], link: '#/review', ...(cityId === undefined ? {} : { cityId }) },
                'ops',
                new Date(NOW),
            );
            await fanOut(deps, id, event);
            return Promise.all(['u-moderator', 'u-uploader'].map(async (uid) => (await item(deps, uid, id)) !== undefined));
        };
        await expect(told('review.waiting', 'assist-city')).resolves.toEqual([true, false]);
        await expect(told('role.requested', 'assist-city')).resolves.toEqual([false, false]);
        await expect(told('job.failed', 'assist-city')).resolves.toEqual([false, false]);
        await expect(told('budget.paused')).resolves.toEqual([false, false]);
    });
});
