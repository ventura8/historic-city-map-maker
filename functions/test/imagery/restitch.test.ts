/**
 * `imagery.locateAgain` on a placed archive series with pieces left out of its overview mosaic (`functions/src/imagery/restitch.ts`,
 * DECISIONS-for-review.md §216): a new version of the same layer lays it on its overview again, the owner's pairs kept.
 */
import type { JobDoc, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { locateAgainFunction } from '../../src/imagery/locate-again.js';
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

const BASE = 'ar-mw993zri-s-4054e55659a3';
const LAYER = '1895-1899';
const DONE = 'done' as const;
const PARAMS = { archiveId: 'ar-0123456789abcdef', seriesId: 's-4054e55659a3', class: 'pieces', sheets: 60, encoding: 'colour', order: 0 };

function placedJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'archive-series',
        status: 'succeeded',
        params: { ...PARAMS, referenceLayerIds: [] },
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

function stitched(leftOutCount: number, method: 'overview' | 'pieces' = 'overview') {
    const leftOut = ['img366.jpg', 'img390.jpg', 'img418.jpg'].slice(0, leftOutCount).map((name) => ({ name, reason: 'no-join' as const }));
    return {
        previewPath: 'rasters/x/stitched.jpg',
        previewScale: 0.24,
        width: 16963,
        height: 14298,
        method,
        parts: 60,
        joined: 60 - leftOutCount,
        leftOut,
        leftOutCount,
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
        source: { kind: 'archive', archiveId: PARAMS.archiveId, seriesId: PARAMS.seriesId, sheetCount: 60, placedCount: 60 },
        rights: { state: 'clear', licence: 'PD', year: '1895' },
        georef: { ...goldenGeoref(), method: 'gcps' },
        help: { reason: 'no-scale', note: 'Add about four points.', at: at(NOW), stitched: stitched(3) },
        ...overrides,
    });
}

async function world(version: Partial<LayerVersionDoc> = {}, layer: Record<string, unknown> = {}): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedJob(ready, BASE, placedJob());
    await seedVersion(ready, BASE, placedVersion(version));
    await seedLayer(ready, LAYER, { currentVersion: BASE, ...layer });
    return ready;
}

function locateAgain(ready: ImageryWorld) {
    return locateAgainFunction(() => ready.deps).run(adminCall({ cityId: CITY, versionId: BASE }));
}

describe('imagery.locateAgain: a placed series with pieces left out of its overview mosaic', () => {
    it('happyPath_aNewVersionOfTheSameLayerLaysItOnItsOverviewAgainWithThePairs @S-A122-HAPPY-RESTITCH', async () => {
        const ready = await world();

        await expect(locateAgain(ready)).resolves.toEqual({ status: 'queued', attempt: 0 });

        const layer = await readLayer(ready, LAYER);
        const id = layer?.pendingVersion ?? '';
        expect(id).toMatch(/^ar-[0-9a-z]+-1895-1899$/);
        const job = await readJob(ready, id);
        expect(job).toMatchObject({ type: 'archive-series', status: 'queued', layerId: LAYER, runOn: 'local', localOnly: true });
        expect(job?.params).toMatchObject({ ...PARAMS, restitch: true });
        const version = await readVersion(ready, id);
        expect(version).toMatchObject({ state: 'processing', origin: 'archive', basedOn: BASE, layerId: LAYER });
        expect(version?.georef?.gcps).toEqual(placedVersion().georef?.gcps);
        expect(version?.help?.stitched?.leftOutCount).toBe(3);
        expect((await readVersion(ready, BASE))?.state).toBe('published');
        expect(layer?.currentVersion).toBe(BASE);
    });

    it('badPath_aSeriesWithNothingLeftOutOrNotOnAnOverviewIsNotStitchedAgain @S-A122-BAD-RESTITCH-NOTHING-LEFT', async () => {
        for (const help of [{ stitched: stitched(0) }, { stitched: stitched(3, 'pieces') }, {}]) {
            const ready = await world({ help: { reason: 'no-scale', note: 'n', at: at(NOW), ...help } });

            expect(await failureOf(locateAgain(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
            expect((await readLayer(ready, LAYER))?.pendingVersion).toBeUndefined();
        }
    });

    it('badPath_aLayerWithAVersionOnItsWayIsBusy @S-A122-BAD-RESTITCH-NOTHING-LEFT', async () => {
        const ready = await world({}, { pendingVersion: 'rg-other' });

        expect(await failureOf(locateAgain(ready))).toMatchObject({ details: { code: 'apiError.layers.busy' } });
    });

    it('happyPath_aLayerNotWrittenYetGetsNoPendingMark @S-A122-HAPPY-RESTITCH', async () => {
        const ready = await readyWorld();
        await seedJob(ready, BASE, placedJob());
        await seedVersion(ready, BASE, placedVersion());

        await expect(locateAgain(ready)).resolves.toEqual({ status: 'queued', attempt: 0 });
        expect(await readLayer(ready, LAYER)).toBeUndefined();
    });

    it('badPath_theBudgetGuardStopsIt', async () => {
        const ready = await world();
        await seedGuard(ready, 'red');

        expect(await failureOf(locateAgain(ready))).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('a series placed on its own is stitched again too, and an unknown version is refused', async () => {
        const automatic = await world({ georef: goldenGeoref() });
        await expect(locateAgain(automatic)).resolves.toEqual({ status: 'queued', attempt: 0 });
        const unknown = await readyWorld();
        expect(await failureOf(locateAgainFunction(() => unknown.deps).run(adminCall({ cityId: CITY, versionId: 'none' })))).toMatchObject({
            details: { code: 'apiError.imagery.versionState' },
        });
    });
});
