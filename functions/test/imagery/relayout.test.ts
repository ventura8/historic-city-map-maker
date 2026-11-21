/**
 * `imagery.relayout` (`functions/src/imagery/relayout.ts`, M20 §19.13): Fix the tiles of an archive series on the map or waiting for
 * approval, a new version of the same layer reopened at its tile layout, the version on the map left there.
 */
import type { JobDoc, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { relayoutFunction, seededHelp } from '../../src/imagery/relayout.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    renderedVersion,
    readJob,
    readLayer,
    readVersion,
    readyWorld,
    seedGuard,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const BASE = 'ar-mwgcdw8s-s-b250f2e03a5f';
const LAYER = 'bucuresti-actual-1-500';
const DONE = 'done' as const;
const PARAMS = { archiveId: 'ar-0123456789abcdef', seriesId: 's-b250f2e03a5f', class: 'grid', sheets: 120, encoding: 'grey', order: 0 };
const ANSWER = {
    revision: 3,
    sheets: [{ index: 0, row: 0, col: 1, turn: 90 as const, flip: false }],
    seams: [],
    preview: false,
    accepted: true as const,
    by: 'u-admin',
    at: at(NOW),
};

function placedJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'archive-series',
        status: 'succeeded',
        params: { ...PARAMS, referenceLayerIds: [], restitch: true },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: BASE,
        runOn: 'local',
        localOnly: true,
        steps: { gather: { status: DONE }, place: { status: DONE }, export: { status: DONE } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function placedVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        layerId: LAYER,
        jobId: BASE,
        state: 'published',
        origin: 'archive',
        own: {
            path: `tiles/${CITY}/${LAYER}/${BASE}.pmtiles`,
            url: 'https://example.test/t.pmtiles',
            bytes: 26678170,
            publishedAt: at(NOW),
        },
        source: { kind: 'archive', archiveId: PARAMS.archiveId, seriesId: PARAMS.seriesId, sheetCount: 120, placedCount: 96 },
        rights: { state: 'clear', licence: 'PD', year: '1960' },
        georef: { ...goldenGeoref(), method: 'gcps' },
        ...overrides,
    });
}

async function world(
    version: Partial<LayerVersionDoc> = {},
    job: Partial<JobDoc> = {},
    layer: Record<string, unknown> = {},
): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedJob(ready, BASE, placedJob(job));
    await seedVersion(ready, BASE, placedVersion(version));
    await seedLayer(ready, LAYER, { currentVersion: BASE, ...layer });
    return ready;
}

function relayout(ready: ImageryWorld, versionId = BASE) {
    return relayoutFunction(() => ready.deps).run(adminCall({ cityId: CITY, versionId }));
}

describe('imagery.relayout: Fix the tiles', () => {
    it('happyPath_aPublishedSeriesGetsANewVersionAtItsTileLayoutAndStaysOnTheMap @S-A-HAPPY-FIX-TILES', async () => {
        const ready = await world({ help: { reason: 'layout-check', note: 'n', at: at(NOW), layoutAnswer: ANSWER } });

        const answer = await relayout(ready);

        const layer = await readLayer(ready, LAYER);
        expect(answer).toEqual({ jobId: layer?.pendingVersion, versionId: layer?.pendingVersion });
        const job = await readJob(ready, answer.jobId);
        expect(job).toMatchObject({ type: 'archive-series', status: 'queued', layerId: LAYER, runOn: 'local', localOnly: true });
        expect(job?.params).toMatchObject({ ...PARAMS, relayout: true });
        expect(job?.params).not.toHaveProperty('restitch');
        const version = await readVersion(ready, answer.jobId);
        expect(version).toMatchObject({ state: 'processing', origin: 'archive', basedOn: BASE, layerId: LAYER });
        expect(version?.georef).toBeUndefined();
        expect(version?.help?.layoutAnswer).toMatchObject({ revision: 3, sheets: ANSWER.sheets, preview: true });
        expect(version?.help?.layoutAnswer).not.toHaveProperty('accepted');
        expect((await readVersion(ready, BASE))?.state).toBe('published');
        expect(layer?.currentVersion).toBe(BASE);
    });

    it('happyPath_aSeriesWaitingForApprovalIsReplacedAndNeverAnsweredStartsFresh @S-A-HAPPY-FIX-TILES', async () => {
        const ready = await world({ state: 'awaiting_approval' }, { status: 'awaiting_approval' }, { pendingVersion: BASE });

        const { jobId } = await relayout(ready);

        expect((await readVersion(ready, jobId))?.help).toBeUndefined();
        expect((await readVersion(ready, BASE))?.state).toBe('cancelled');
        expect((await readJob(ready, BASE))?.status).toBe('cancelled');
        expect((await readLayer(ready, LAYER))?.pendingVersion).toBe(jobId);
    });

    it('badPath_aVersionNotOnTheMapOrNotASeriesIsRefused @S-A-BAD-FIX-TILES-STATE', async () => {
        const cases: [Partial<LayerVersionDoc>, Partial<JobDoc>][] = [
            [{ state: 'needs_gcps', help: { reason: 'no-scale', note: 'n', at: at(NOW) } }, {}],
            [{ origin: 'usgs' }, {}],
            [{}, { type: 'regeoref' }],
        ];
        for (const [version, job] of cases) {
            const ready = await world(version, job);
            expect(await failureOf(relayout(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
            expect((await readLayer(ready, LAYER))?.pendingVersion).toBeUndefined();
        }
        const empty = await readyWorld();
        expect(await failureOf(relayout(empty, 'none'))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_aLayerWithAnotherVersionOnItsWayIsBusy @S-A-BAD-FIX-TILES-STATE', async () => {
        const ready = await world({}, {}, { pendingVersion: 'rg-other' });

        expect(await failureOf(relayout(ready))).toMatchObject({ details: { code: 'apiError.layers.busy' } });
        expect((await readVersion(ready, BASE))?.state).toBe('published');
    });

    it('badPath_theBudgetGuardStopsIt', async () => {
        const ready = await world();
        await seedGuard(ready, 'red');

        expect(await failureOf(relayout(ready))).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('happyPath_aLayerNotWrittenYetGetsNoPendingMark', async () => {
        const ready = await readyWorld();
        await seedJob(ready, BASE, placedJob());
        await seedVersion(ready, BASE, placedVersion());

        await relayout(ready);
        expect(await readLayer(ready, LAYER)).toBeUndefined();
    });

    it('seededHelp_keepsNoHelpWithoutAnAnswer', () => {
        const stamp = at(NOW);
        expect(seededHelp(placedVersion(), 'u', stamp)).toBeUndefined();
        expect(seededHelp(placedVersion({ help: { reason: 'no-scale', note: 'n', at: stamp } }), 'u', stamp)).toBeUndefined();
    });
});
