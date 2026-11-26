/**
 * The Firestore adapters against the Firestore emulator through the real Admin SDK (npm test runs
 * every Vitest project under `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST). This
 * file uses its own named database, so its writes never race with the setup-status trigger test,
 * which reads setup/status in the (default) database from another worker.
 */
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { firestoreAdminDirectory, firestoreSetupRecords } from '../../src/adapters/firestore.js';

let app: App;
let db: Firestore;

beforeAll(async () => {
    if (!process.env['FIRESTORE_EMULATOR_HOST']) {
        throw new Error('FIRESTORE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-firestore-adapter');
    db = getFirestore(app, 'functions-adapters');
    await db.collection('admins').doc('functions-adapter-admin').set({ addedBy: 'bootstrap' });
    await db
        .collection('admins')
        .doc('functions-adapter-owner')
        .set({ role: 'owner', cities: { bucharest: 'owner', cluj: 'editor' } });
    await db
        .collection('admins')
        .doc('functions-adapter-broken')
        .set({ role: 'admin', cities: { cluj: 'viewer' } });
});

afterAll(async () => {
    await deleteApp(app);
});

describe('firestoreAdminDirectory', () => {
    it('happyPath_anAdminHasADocument', async () => {
        await expect(firestoreAdminDirectory(db).isAdmin('functions-adapter-admin')).resolves.toBe(true);
    });

    it('badPath_anyoneElseHasNone', async () => {
        await expect(firestoreAdminDirectory(db).isAdmin('functions-adapter-stranger')).resolves.toBe(false);
        await expect(firestoreAdminDirectory(db).membership('functions-adapter-stranger')).resolves.toBeNull();
    });

    it('happyPath_oneReadTellsTheProjectRoleAndEachCitysRole', async () => {
        const membership = await firestoreAdminDirectory(db).membership('functions-adapter-owner');

        expect(membership?.projectRole).toBe('owner');
        expect(['bucharest', 'cluj', 'bacau'].map((city) => membership?.roleIn(city))).toEqual(['owner', 'editor', null]);
    });

    it('badPath_aDocumentFromBeforeM5OrWithAnInvalidMembershipBelongsToNoCity', async () => {
        const legacy = await firestoreAdminDirectory(db).membership('functions-adapter-admin');
        const broken = await firestoreAdminDirectory(db).membership('functions-adapter-broken');

        expect([legacy?.projectRole, legacy?.roleIn('bucharest')]).toEqual(['admin', null]);
        expect([broken?.projectRole, broken?.roleIn('cluj')]).toEqual(['admin', null]);
    });
});

describe('firestoreSetupRecords', () => {
    it('happyPath_readsTheStoredStatus', async () => {
        await db
            .collection('setup')
            .doc('status')
            .set({ mapbox: { state: 'ok' }, secretsRev: 1 });

        await expect(firestoreSetupRecords(db).readStatus()).resolves.toEqual({ mapbox: { state: 'ok' }, secretsRev: 1 });
    });

    it('badPath_aFreshProjectHasNoStatus', async () => {
        await db.collection('setup').doc('status').delete();

        await expect(firestoreSetupRecords(db).readStatus()).resolves.toBeUndefined();
    });
});
