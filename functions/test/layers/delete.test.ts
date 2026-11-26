/**
 * `layers.delete` (`functions/src/layers/delete.ts`, M2c §8.4): the layer document goes and a `layer-delete` job waits
 * seven days in the same transaction; a missing layer or one the raster pipeline is working on changes nothing.
 */
import { FIRESTORE_PATHS, jobDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { layerDeleteFunction } from '../../src/layers/delete.js';
import { failureOf } from '../admin/world.js';
import { adminCall, contentDeps, type ContentDeps } from '../publish/fakes.js';
import { CITY, seedJob, seedLayer } from './world.js';

const NOW = '2026-10-17T08:30:00.000Z';
const RUNS_AT = '2026-10-24T08:30:00.000Z';
const JOB_ID = `ld-${Date.parse(NOW).toString(36)}-corona-1968`;

function remove(deps: ContentDeps, data: unknown, uid = 'u-admin') {
    return layerDeleteFunction(() => deps).run(adminCall(data, uid));
}

describe('layers.delete', () => {
    it('happyPath_theLayerGoesAndItsTilesetDeletionWaitsSevenDays @S-A33-HAPPY-DELETE-INDEXED', async () => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'corona-1968');
        await seedJob(deps, 'old', { status: 'succeeded' });

        const response = await remove(deps, { cityId: CITY, layerId: 'corona-1968' });

        expect(response).toEqual({ jobId: JOB_ID, runsAt: RUNS_AT });
        expect(deps.documents.peek(FIRESTORE_PATHS.layer(CITY, 'corona-1968'))).toBeUndefined();
        await expect(deps.documents.get(FIRESTORE_PATHS.job(CITY, JOB_ID), jobDocSchema)).resolves.toEqual({
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'corona-1968', tilesetId: 'e2e-user.corona-1968', sourceSha: 'b'.repeat(64) },
            createdBy: 'u-admin',
            createdAt: timestampFromDate(new Date(NOW)),
            dispatchAt: timestampFromDate(new Date(RUNS_AT)),
            updatedBy: 'u-admin',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect(deps.recording.records.map((record) => record.message)).toContain('layer deleted');
    });

    it('happyPath_aLinkedLayerLeavesItsTilesetInTheAccount', async () => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'plan-1911', { mapbox: undefined, source: { type: 'mapbox', tilesetId: 'e2e-user.plan-1911' } });

        const { jobId } = await remove(deps, { cityId: CITY, layerId: 'plan-1911' });

        expect((await deps.documents.get(FIRESTORE_PATHS.job(CITY, jobId), jobDocSchema))?.params).toEqual({ layerId: 'plan-1911' });
    });

    it('badPath_aMissingLayerIsNotFoundAndQueuesNothing', async () => {
        const deps = contentDeps(NOW);

        const failure = await failureOf(remove(deps, { cityId: CITY, layerId: 'gone' }));

        expect(failure).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
        expect(deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
    });

    it.each([
        ['a running job of the layer', { job: 'running' as const, status: 'ready' as const }],
        ['a queued job of the layer', { job: 'queued' as const, status: 'ready' as const }],
        ['the pipeline processing it', { job: 'succeeded' as const, status: 'processing' as const }],
        ['a tileset awaiting approval', { job: 'failed' as const, status: 'awaiting_approval' as const }],
    ])('badPath_aBusyLayerStays_%s', async (_case, state) => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'corona-1968', { status: state.status });
        await seedJob(deps, 'j1', { status: state.job });

        const failure = await failureOf(remove(deps, { cityId: CITY, layerId: 'corona-1968' }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.layers.busy' } });
        expect(deps.documents.peek(FIRESTORE_PATHS.layer(CITY, 'corona-1968'))).toBeDefined();
        expect(deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([FIRESTORE_PATHS.job(CITY, 'j1')]);
    });

    it.each([
        ['an import of a new version (CR-M3-24)', { status: 'running' as const }, {}],
        ['a re-georeference waiting for points', { status: 'awaiting_gcps' as const }, {}],
        ['a new version waiting for approval', { status: 'succeeded' as const }, { pendingVersion: 'v2' }],
    ])('badPath_aLayerAnM3JobIsWorkingOnStays_%s', async (_case, state, layer) => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'corona-1968', layer);
        await seedJob(deps, 'j2', { type: 'regeoref', params: { basedOn: 'v1' }, layerId: 'corona-1968', ...state });

        const failure = await failureOf(remove(deps, { cityId: CITY, layerId: 'corona-1968' }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.layers.busy' } });
        expect(deps.documents.peek(FIRESTORE_PATHS.layer(CITY, 'corona-1968'))).toBeDefined();
    });

    it('badPath_aNonAdminOrABadIdIsRefusedBeforeAnyRead', async () => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'corona-1968');

        const stranger = await failureOf(remove(deps, { cityId: CITY, layerId: 'corona-1968' }, 'u-stranger'));
        const invalid = await failureOf(remove(deps, { cityId: CITY, layerId: '../x' }));

        expect(stranger).toMatchObject({ code: 'permission-denied' });
        expect(invalid).toMatchObject({ code: 'invalid-argument', details: { code: 'apiError.invalidRequest' } });
        expect(deps.documents.peek(FIRESTORE_PATHS.layer(CITY, 'corona-1968'))).toBeDefined();
    });
});
