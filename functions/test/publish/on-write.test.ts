/**
 * The `publish.on*Write` triggers: the handler's decision with the in-memory ports, and the five triggers through
 * firebase-functions' `.run()` with real `DocumentSnapshot`s read from the Firestore emulator (its own named database,
 * so no other test file sees these documents).
 */
import { FIRESTORE_PATHS, manifestStateDocSchema } from '@hcm/shared';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { Change, type DocumentSnapshot, type FirestoreEvent } from 'firebase-functions/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { onContentWrite, onWriteFunctions } from '../../src/publish/on-write.js';
import { CITY_ID } from './city.js';
import { contentDeps } from './fakes.js';

let app: App;
let db: Firestore;

beforeAll(() => {
    if (!process.env['FIRESTORE_EMULATOR_HOST']) {
        throw new Error('FIRESTORE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    // The emulator needs no credentials: never probe the GCE metadata server (no network in tests).
    vi.stubEnv('METADATA_SERVER_DETECTION', 'none');
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-publish-on-write');
    db = getFirestore(app, 'functions-publish');
});

afterAll(async () => {
    await deleteApp(app);
});

const PUBLISHED = { published: true, title: { ro: 'Titlu' } };

async function snapshot(path: string, data?: Record<string, unknown>): Promise<DocumentSnapshot> {
    if (data === undefined) {
        return db.doc(`${path}-missing`).get();
    }
    await db.doc(path).set(data);
    return db.doc(path).get();
}

function written<P>(
    document: string,
    change: Change<DocumentSnapshot>,
    params: P,
): FirestoreEvent<Change<DocumentSnapshot> | undefined, P> {
    return {
        specversion: '1.0',
        id: `event-${document}`,
        source: '//firestore.googleapis.com/projects/demo-hcm/databases/(default)',
        type: 'google.cloud.firestore.document.v1.written',
        time: '2026-10-12T08:30:00.000Z',
        location: 'nam5',
        project: 'demo-hcm',
        database: '(default)',
        namespace: '(default)',
        document,
        params,
        data: change,
    };
}

describe('onContentWrite', () => {
    it('happyPath_aManifestChangeRequestsABuild', async () => {
        const deps = contentDeps();

        await expect(onContentWrite(deps, 'photo', CITY_ID, { before: undefined, after: PUBLISHED })).resolves.toBe(true);
        expect(await deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema)).toMatchObject({
            requestedVersion: 1,
            updatedBy: 'system:publish',
        });
    });

    it('badPath_aWriteTheManifestDoesNotCarryRequestsNothing @S-A10-BAD-NOTHING-TO-PUBLISH', async () => {
        const deps = contentDeps();

        await expect(
            onContentWrite(deps, 'photo', CITY_ID, { before: PUBLISHED, after: { ...PUBLISHED, updatedBy: 'u-2' } }),
        ).resolves.toBe(false);
        expect(deps.tasks.queued).toEqual([]);
    });

    it('badPath_aCityIdNoManifestCanHaveIsIgnored', async () => {
        const deps = contentDeps();

        await expect(onContentWrite(deps, 'poi', 'Bucuresti', { before: undefined, after: PUBLISHED })).resolves.toBe(false);
        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'warn', data: { entity: 'poi', cityId: 'Bucuresti' } });
    });
});

describe('the publish triggers', () => {
    it('happyPath_eachTriggerRequestsABuildForItsCity', async () => {
        // Six triggers fire; the first queues the window's build and the rest join it (S-A10-BAD-BURST-JOINS-QUEUED).
        const deps = contentDeps();
        const triggers = onWriteFunctions(() => deps);
        const cityPath = `cities/${CITY_ID}`;

        await triggers.onCityWrite.run(
            written(cityPath, new Change(await snapshot(cityPath), await snapshot(cityPath, PUBLISHED)), { city: CITY_ID }),
        );
        for (const [name, collection] of [
            ['onLayerWrite', 'layers'],
            ['onPhotoWrite', 'photos'],
            ['onPoiWrite', 'pois'],
            ['onPoiCategoryWrite', 'poiCategories'],
            ['onStoryWrite', 'stories'],
        ] as const) {
            const path = `${cityPath}/${collection}/doc-1`;
            await triggers[name].run(
                written(path, new Change(await snapshot(path), await snapshot(path, PUBLISHED)), { city: CITY_ID, id: 'doc-1' }),
            );
        }

        expect(await deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema)).toMatchObject({
            requestedVersion: 1,
        });
        expect(deps.tasks.queued).toHaveLength(1);
    });

    it('badPath_anEventWithoutDataRequestsNothing', async () => {
        const deps = contentDeps();
        const event = {
            ...written('cities/x', new Change(await snapshot('cities/x'), await snapshot('cities/x')), { city: CITY_ID }),
            data: undefined,
        };

        await onWriteFunctions(() => deps).onCityWrite.run(event);

        expect(deps.tasks.queued).toEqual([]);
    });

    it('happyPath_theTriggersWatchTheRegistrysDocuments', () => {
        const triggers = onWriteFunctions(() => contentDeps());

        expect(Object.entries(triggers).map(([name, trigger]) => [name, trigger.__endpoint.eventTrigger?.eventFilterPathPatterns])).toEqual(
            [
                ['onCityWrite', { document: 'cities/{city}' }],
                ['onLayerWrite', { document: 'cities/{city}/layers/{id}' }],
                ['onPhotoWrite', { document: 'cities/{city}/photos/{id}' }],
                ['onPoiWrite', { document: 'cities/{city}/pois/{id}' }],
                ['onPoiCategoryWrite', { document: 'cities/{city}/poiCategories/{id}' }],
                ['onStoryWrite', { document: 'cities/{city}/stories/{id}' }],
            ],
        );
    });
});
