/**
 * M4's notifications and assists (`docs/research/M4-interfaces.md` §4.2, §5.6; owner: assists-notify): an admin reads
 * and marks read only their own inbox (the read time is the server's), writes only their own push settings (known kinds,
 * each once, the one `settings` document), reads only their own devices; no client creates or deletes an item or a
 * device or touches `notificationEvents`; admins read the geocoding cache the editors listen to.
 */
import { DEFAULT_PUSH_KINDS, FIRESTORE_PATHS, NOTIFICATION_KINDS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inboxItemDoc, notificationEventDoc, notifySettingsDoc, pushDeviceDoc } from './support/documents.js';
import { createWorld, later, past, serverTime, stampedBy, systemStamp, verdict, type Data, type World } from './support/world.js';

const GOOGLE = { email_verified: true, firebase: { sign_in_provider: 'google.com' }, admin: true } as const;
const OTHER = 'notify-other-admin';
const ITEM = 'job.failed~rules-notify~j1~0';

let world: World;
let sequence = 0;

const own = (): string => world.uid('admin');

/** The other admin's Firestore: a second verified Google admin with the claim and the document. */
function other() {
    return world.env.authenticatedContext(OTHER, { ...GOOGLE, email: `${OTHER}@example.test` }).firestore();
}

async function freshItem(uid: string, changes: Data = {}): Promise<string> {
    sequence += 1;
    const path = FIRESTORE_PATHS.inboxItem(uid, `job.failed~rules-notify~i${String(sequence)}~0`);
    await world.seed(path, { ...inboxItemDoc(), read: false, ...changes });
    return path;
}

function markRead(path: string, changes: Data = {}) {
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ read: true, readAt: serverTime(), ...stampedBy(own()), ...changes }),
    );
}

function saveSettings(path: string, data: Data) {
    return verdict(world.db('admin').doc(path).set(data));
}

beforeAll(async () => {
    world = await createWorld('notify');
    await world.seed(FIRESTORE_PATHS.admin(OTHER), { role: 'admin', createdAt: past(), ...systemStamp('admins') });
    await world.seed(FIRESTORE_PATHS.inboxItem(OTHER, ITEM), inboxItemDoc());
    await world.seed(FIRESTORE_PATHS.notifySettings(OTHER), notifySettingsDoc(OTHER));
    await world.seed(FIRESTORE_PATHS.pushDevice(OTHER, 'cd'.repeat(16)), pushDeviceDoc(OTHER));
    await world.seed(FIRESTORE_PATHS.notificationEvent(ITEM), notificationEventDoc());
});

afterAll(async () => {
    await world.close();
});

describe('another admin', () => {
    it('badPath_anAdminReadsOrMarksOnlyTheirOwnInboxSettingsAndDevices @S-A46-BAD-OTHER-ADMIN', async () => {
        const db = world.db('admin');
        const results = {
            readItem: await verdict(db.doc(FIRESTORE_PATHS.inboxItem(OTHER, ITEM)).get()),
            listInbox: await verdict(db.collection(FIRESTORE_PATHS.inbox(OTHER)).get()),
            markItem: await verdict(
                db.doc(FIRESTORE_PATHS.inboxItem(OTHER, ITEM)).update({ read: true, readAt: serverTime(), ...stampedBy(own()) }),
            ),
            readSettings: await verdict(db.doc(FIRESTORE_PATHS.notifySettings(OTHER)).get()),
            writeSettings: await verdict(
                db.doc(FIRESTORE_PATHS.notifySettings(OTHER)).set({ push: false, pushKinds: [], ...stampedBy(own()) }),
            ),
            listDevices: await verdict(db.collection(FIRESTORE_PATHS.pushDevices(OTHER)).get()),
        };

        expect(results).toEqual({
            readItem: 'deny',
            listInbox: 'deny',
            markItem: 'deny',
            readSettings: 'deny',
            writeSettings: 'deny',
            listDevices: 'deny',
        });
        await expect(verdict(other().collection(FIRESTORE_PATHS.inbox(OTHER)).get())).resolves.toBe('allow');
    });
});

describe('the own inbox', () => {
    it('happyPath_anUnreadItemIsMarkedReadAtTheServersTime', async () => {
        expect(await markRead(await freshItem(own()))).toBe('allow');
    });

    it.each([
        ['marking it unread', { read: false }],
        ['a read time of its own', { readAt: later() }],
        ['another field', { link: '#/jobs' }],
        ['without the stamp', { updatedBy: 'someone-else' }],
    ])('badPath_%s_isDenied', async (_name, changes) => {
        expect(await markRead(await freshItem(own()), changes)).toBe('deny');
    });

    it('badPath_noClientCreatesOrDeletesAnItemADeviceOrAnEvent', async () => {
        const db = world.db('admin');
        const item = await freshItem(own());

        const results = {
            createItem: await verdict(db.doc(FIRESTORE_PATHS.inboxItem(own(), 'job.failed~rules-notify~forged~0')).set(inboxItemDoc())),
            deleteItem: await verdict(db.doc(item).delete()),
            createDevice: await verdict(db.doc(FIRESTORE_PATHS.pushDevice(own(), 'ef'.repeat(16))).set(pushDeviceDoc(own()))),
            readEvent: await verdict(db.doc(FIRESTORE_PATHS.notificationEvent(ITEM)).get()),
            createEvent: await verdict(
                db.doc(FIRESTORE_PATHS.notificationEvent('job.failed~rules-notify~x~0')).set(notificationEventDoc()),
            ),
        };

        expect(results).toEqual({ createItem: 'deny', deleteItem: 'deny', createDevice: 'deny', readEvent: 'deny', createEvent: 'deny' });
    });
});

describe('the own push settings', () => {
    /** A fresh admin (the claim and the document), whose settings do not exist yet. */
    async function freshAdmin(): Promise<{ readonly uid: string; readonly db: ReturnType<typeof other> }> {
        sequence += 1;
        const uid = `notify-fresh-${String(sequence)}`;
        await world.seed(FIRESTORE_PATHS.admin(uid), { role: 'admin', createdAt: past(), ...systemStamp('admins') });
        return { uid, db: world.env.authenticatedContext(uid, { ...GOOGLE, email: `${uid}@example.test` }).firestore() };
    }

    it('happyPath_theFirstChangeCreatesTheSettingsAndTheNextUpdatesThem', async () => {
        const { uid, db } = await freshAdmin();
        const path = FIRESTORE_PATHS.notifySettings(uid);

        const created = await verdict(
            db.doc(path).set({ push: false, pushKinds: ['job.failed'], createdAt: serverTime(), ...stampedBy(uid) }),
        );
        const updated = await verdict(db.doc(path).update({ pushKinds: ['job.failed', 'crash.spike'], ...stampedBy(uid) }));

        expect({ created, updated }).toEqual({ created: 'allow', updated: 'allow' });
    });

    it('happyPath_everyKindTheSharedListNamesAndTheDefaultListAreSaved', async () => {
        // The rules spell the kinds out (rules cannot import @hcm/shared): a kind added to NOTIFICATION_KINDS without the
        // rules refused every save of the defaults (the M7 kind job.needsOk, docs/LESSONS.md 340). One fresh admin per write.
        const writes: readonly (readonly [string, readonly string[]])[] = [
            ['all', NOTIFICATION_KINDS],
            ['defaults', DEFAULT_PUSH_KINDS],
            ['defaults but job.failed', DEFAULT_PUSH_KINDS.filter((kind) => kind !== 'job.failed')],
            ...NOTIFICATION_KINDS.map((kind) => [kind, [kind]] as const),
        ];
        const results: Record<string, string> = {};
        for (const [name, kinds] of writes) {
            const { uid, db } = await freshAdmin();
            results[name] = await verdict(
                db
                    .doc(FIRESTORE_PATHS.notifySettings(uid))
                    .set({ push: true, pushKinds: kinds, createdAt: serverTime(), ...stampedBy(uid) }),
            );
        }

        expect(results).toEqual(Object.fromEntries(writes.map(([name]) => [name, 'allow'])));
    });

    it('happyPath_theM7KindJobNeedsOkIsSavedAndAnUnknownKindBesideItIsDenied', async () => {
        const { uid, db } = await freshAdmin();
        const path = FIRESTORE_PATHS.notifySettings(uid);
        await world.seed(path, notifySettingsDoc(uid));

        const withKind = await verdict(db.doc(path).update({ pushKinds: ['job.needsOk', 'job.failed'], ...stampedBy(uid) }));
        const withUnknown = await verdict(db.doc(path).update({ pushKinds: ['job.needsOk', 'job.needsPay'], ...stampedBy(uid) }));

        expect({ withKind, withUnknown }).toEqual({ withKind: 'allow', withUnknown: 'deny' });
    });

    it('badPath_aCreateWithoutItsOwnCreationTimeIsDenied', async () => {
        const { uid, db } = await freshAdmin();

        expect(
            await verdict(
                db.doc(FIRESTORE_PATHS.notifySettings(uid)).set({ push: true, pushKinds: [], createdAt: past(), ...stampedBy(uid) }),
            ),
        ).toBe('deny');
    });

    it.each([
        ['an unknown kind', { pushKinds: ['order.paid'] }],
        ['a kind twice', { pushKinds: ['job.failed', 'job.failed'] }],
        ['kinds that are not a list', { pushKinds: 'job.failed' }],
        ['more kinds than there are', { pushKinds: [...NOTIFICATION_KINDS, 'job.failed'] }],
        ['push that is not a switch', { push: 'yes' }],
        ['an unknown field', { email: 'admin@example.test' }],
        ['its creation time', { createdAt: serverTime() }],
    ])('badPath_anUpdateWith_%s_isDenied', async (_name, changes) => {
        const { uid, db } = await freshAdmin();
        const path = FIRESTORE_PATHS.notifySettings(uid);
        await world.seed(path, notifySettingsDoc(uid));

        expect(await verdict(db.doc(path).update({ ...stampedBy(uid), ...changes }))).toBe('deny');
    });

    it('badPath_anyDocumentButSettingsIsDenied', async () => {
        expect(
            await saveSettings(`admins/${own()}/notify/other`, { push: true, pushKinds: [], createdAt: serverTime(), ...stampedBy(own()) }),
        ).toBe('deny');
        await world.seed(`admins/${own()}/notify/other`, notifySettingsDoc(own()));
        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(`admins/${own()}/notify/other`)
                    .update({ push: false, ...stampedBy(own()) }),
            ),
        ).toBe('deny');
    });
});

describe('the geocoding cache', () => {
    it('happyPath_anAdminListensToACell', async () => {
        await world.seed(FIRESTORE_PATHS.geocodeCell('n444413_e260973'), { state: 'queued', ...systemStamp('assist') });

        expect(await verdict(world.db('admin').doc(FIRESTORE_PATHS.geocodeCell('n444413_e260973')).get())).toBe('allow');
        expect(await verdict(world.db('stranger').doc(FIRESTORE_PATHS.geocodeCell('n444413_e260973')).get())).toBe('deny');
    });
});
