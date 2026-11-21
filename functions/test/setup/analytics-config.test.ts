/**
 * `setup.analyticsConfig` (PLAN Addendum 2; scenario A22) against the fake Firebase Management API: the web app's GA4
 * measurement id and public identifiers reach the city (and so the manifest); every missing step is named and nothing
 * is written.
 */
import { FIRESTORE_PATHS, cityDocSchema } from '@hcm/shared';
import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { describe, expect, it } from 'vitest';

import type { DocumentStore } from '../../src/ports/documents.js';
import { analyticsConfig } from '../../src/setup/analytics-config.js';
import { ADMIN, CITY, cityDoc, createWorld, rejection, type World } from './world.js';

const MEASUREMENT_ID = String(FIXTURE_VALUES['measurementId']);
const IDS = { apiKey: String(FIXTURE_VALUES['apiKey']), appId: String(FIXTURE_VALUES['appId']), projectId: 'demo-hcm' };

function linked(): World {
    const world = createWorld();
    world.upstream.scenario('firebase-management.analyticsLinked');
    return world;
}

function configure(world: World, cityId = CITY) {
    return analyticsConfig(world.deps, ADMIN, { cityId });
}

function cityOf(world: World) {
    return cityDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.city(CITY)));
}

describe('setup.analyticsConfig', () => {
    it('happyPath_theMeasurementIdAndThePublicIdsReachTheCity', async () => {
        const world = linked();

        const response = await configure(world);

        expect(response).toEqual({
            analytics: { state: 'ok', checkedAt: '2026-10-11T08:30:00.000Z', measurementId: MEASUREMENT_ID },
            measurementId: MEASUREMENT_ID,
            firebase: IDS,
            manifestQueued: true,
        });
        expect(cityOf(world)).toMatchObject({ analytics: { measurementId: MEASUREMENT_ID, firebase: IDS }, updatedBy: ADMIN.uid });
        expect(world.status()?.analytics).toMatchObject({ state: 'ok', measurementId: MEASUREMENT_ID, appId: IDS.appId });
        expect(world.upstream.callsTo('firebase-management').map((call) => call.operation)).toEqual([
            'firebase-management.webApps.list',
            'firebase-management.webApps.getConfig',
        ]);
    });

    it('happyPath_theCrashEndpointAlreadyThereIsKept', async () => {
        const world = linked();
        const errorEndpoint = 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError';
        world.documents.seed(FIRESTORE_PATHS.city(CITY), cityDoc({ analytics: { errorEndpoint, measurementId: MEASUREMENT_ID } }));

        await expect(configure(world)).resolves.toMatchObject({ manifestQueued: true });
        expect(cityOf(world).analytics).toEqual({ errorEndpoint, measurementId: MEASUREMENT_ID, firebase: IDS });
    });

    it('happyPath_aSecondCallChangesNothingAndQueuesNoRebuild', async () => {
        const world = linked();
        await configure(world);

        await expect(configure(world)).resolves.toMatchObject({ manifestQueued: false });
    });

    it('happyPath_anotherMeasurementIdIsAChange', async () => {
        const world = linked();
        world.documents.seed(FIRESTORE_PATHS.city(CITY), cityDoc({ analytics: { measurementId: 'G-OLD0000', firebase: IDS } }));

        await expect(configure(world)).resolves.toMatchObject({ manifestQueued: true });
    });

    it('happyPath_anUnpublishedCityQueuesNoRebuild', async () => {
        const world = linked();
        world.documents.seed(FIRESTORE_PATHS.city(CITY), cityDoc({ published: false }));

        await expect(configure(world)).resolves.toMatchObject({ manifestQueued: false });
    });

    it.each([
        ['no web app', 'firebase-management.noWebApp', 'apiError.analytics.noWebApp'],
        ['analytics not enabled', undefined, 'apiError.analytics.notEnabled'],
    ])('badPath_%s_namesTheStepAndWritesNothing', async (_label, scenario, code) => {
        const world = createWorld();
        if (scenario !== undefined) {
            world.upstream.scenario(scenario);
        }

        await expect(rejection(configure(world))).resolves.toMatchObject({ code });
        expect(world.documents.writes).toEqual([]);
    });

    it.each([
        ['forbidden', { code: 'apiError.cloud.permission', params: { role: 'roles/firebase.viewer' } }],
        ['apiDisabled', { code: 'apiError.cloud.apiDisabled', params: { api: 'firebase.googleapis.com' } }],
        ['unavailable', { code: 'apiError.unavailable' }],
    ] as const)('badPath_firebaseManagement_%s_isNamedAndWritesNothing', async (mode, expected) => {
        const world = linked();
        world.upstream.fail('firebase-management', mode);

        await expect(rejection(configure(world))).resolves.toMatchObject(expected);
        expect(world.documents.writes).toEqual([]);
    });

    it('badPath_aCityDeletedMeanwhileIsNotFoundAndNothingIsWritten', async () => {
        const world = linked();
        const documents: DocumentStore = {
            ...world.documents,
            transaction: async (work) => {
                await world.documents.delete(FIRESTORE_PATHS.city(CITY));
                return world.documents.transaction(work);
            },
        };

        await expect(rejection(analyticsConfig({ ...world.deps, documents }, ADMIN, { cityId: CITY }))).resolves.toMatchObject({
            code: 'apiError.notFound',
        });
        expect(world.status()).toBeUndefined();
    });

    it('badPath_anUnknownCityIsNotFound', async () => {
        const world = linked();

        await expect(rejection(configure(world, 'nowhere'))).resolves.toMatchObject({ code: 'apiError.notFound' });
        expect(world.upstream.calls).toEqual([]);
    });
});
