/**
 * The finalize step (`functions/src/imagery/finalize.ts`, `docs/research/M3-interfaces.md` §2.2): a first published
 * version creates its layer with the kind, attribution and provenance its source says (a USGS frame, an uploaded plan or
 * photograph, a rendition without a source of its own), and nothing happens when the job or its render is gone.
 */
import { DEM_ATTRIBUTION, USGS_ATTRIBUTION, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { finalizeVersion } from '../../src/imagery/finalize.js';
import {
    CITY,
    MAPBOX_USER,
    NOW,
    at,
    goldenGeoref,
    readLayer,
    readUsage,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedVersion,
} from './world.js';

const JOB = 'up-plan1911';
const LAYER = 'planul-bucurestilor-1911';
const TILESET = `${MAPBOX_USER}.hcm-${CITY}-${LAYER}`;

function job(): JobDoc {
    return {
        type: 'geotiff-import',
        status: 'mts_processing',
        params: { uploadPath: 'uploads/rasters/bucharest/u/up-plan1911/Qx7mP2rT9w.tif', replaces: false },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        mapboxJobId: 'mts-1',
        updatedBy: 'system:imagery',
        updatedAt: at(NOW),
    };
}

function uploaded(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        layerId: LAYER,
        jobId: JOB,
        origin: 'upload',
        state: 'publishing',
        approval: { auto: false, by: 'u-admin', at: at(NOW) },
        source: {
            kind: 'upload',
            uploadPath: 'uploads/rasters/bucharest/u/up-plan1911/Qx7mP2rT9w.tif',
            originalName: 'Planul Bucureștilor 1911.tif',
            bytes: 10,
        },
        label: { ro: 'Planul Bucureștilor 1911' },
        year: 1911,
        date: undefined,
        sensor: undefined,
        georef: { method: 'embedded', transform: 'affine', gcps: [] },
        ...overrides,
    });
}

async function finish(version: LayerVersionDoc) {
    const world = await readyWorld();
    await seedJob(world, JOB, job());
    await seedVersion(world, JOB, version);
    const done = await finalizeVersion(world.deps, {
        cityId: CITY,
        jobId: JOB,
        versionId: JOB,
        origin: 'mts',
        tilesetId: TILESET,
        sourceId: `hcm-${CITY}-${LAYER}`,
    });
    return { world, done };
}

describe('finalizeVersion', () => {
    it('happyPath_anUploadedPlanBecomesAMapLayerCreditedToItsFile', async () => {
        const { world, done } = await finish(uploaded());

        expect(done).toBe(true);
        const layer = await readLayer(world, LAYER);
        expect(layer).toMatchObject({
            kind: 'map',
            attribution: 'Planul Bucureștilor 1911.tif',
            year: 1911,
            provenance: { georef: { method: 'embedded' } },
        });
        expect(layer?.provenance?.georef?.gcpCount).toBeUndefined();
        expect(layer?.sensor).toBeUndefined();
        expect(layer?.date).toBeUndefined();
        expect(await readUsage(world, '2026-10')).toMatchObject({ computeUnits: 0, publishes: 1, computeUnitBudget: 20 });
    });

    it('happyPath_anUploadWithoutItsNameIsAnAerialCreditedToItsLabel', async () => {
        const { world } = await finish(
            uploaded({
                source: { kind: 'upload', uploadPath: 'uploads/rasters/bucharest/u/up-plan1911/Qx7mP2rT9w.tif', bytes: 10 },
                label: { ro: 'Zbor deasupra Cotrocenilor' },
                georef: undefined,
                estimate: { computeUnits: 2, precision: '30cm', areaKm2: 50, at: at(NOW) },
            }),
        );

        const layer = await readLayer(world, LAYER);
        expect(layer).toMatchObject({ kind: 'aerial', attribution: 'Zbor deasupra Cotrocenilor' });
        expect(layer?.provenance).toEqual({});
        expect((await readUsage(world, '2026-10'))?.computeUnits).toBe(2);
    });

    it('happyPath_aRenditionWithoutASourceKeepsTheLayersProvenance', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, job());
        await seedLayer(world, LAYER, { provenance: { usgsEntityId: 'DS1', usgsDataset: 'corona2', georef: { method: 'auto' } } });
        await seedVersion(
            world,
            JOB,
            uploaded({ source: undefined, origin: 'crop', georef: renderedVersion().georef, label: { ro: 'Harta 1911' } }),
        );

        await finalizeVersion(world.deps, { cityId: CITY, jobId: JOB, versionId: JOB, origin: 'mts', tilesetId: TILESET });

        expect((await readLayer(world, LAYER))?.provenance).toEqual({
            usgsEntityId: 'DS1',
            usgsDataset: 'corona2',
            georef: { method: 'auto', gcpCount: 6, checkpointRmseM: 8.9 },
        });
    });

    it('happyPath_aRenditionWithoutASourceOrACameraIsALayerOfItsLabel', async () => {
        const { world } = await finish(uploaded({ source: undefined, origin: 'regeoref', label: { ro: 'Harta orașului' } }));

        expect(await readLayer(world, LAYER)).toMatchObject({
            kind: 'map',
            attribution: 'USGS EROS, declassified imagery (public domain)',
        });
    });

    it('happyPath_aFrameFittedOverTerrainCreditsTheSurfaceModel @S-P06-HAPPY-TERRAIN', async () => {
        const axes = { line: 400, samp: 600, lat: 44.43, lng: 26.1, height: 90 };
        const set = Array.from({ length: 20 }, (_, index) => (index === 0 ? 1 : 0));
        const rpc = { offset: axes, scale: axes, lineNum: set, lineDen: set, sampNum: set, sampDen: set };
        const heights = { left: 2.9e6, top: 5.5e6, cell: 420, columns: 2, rows: 2, baseDm: 512, valuesDm: 'AAAAAAAAAAA=' };
        const georef = { ...goldenGeoref(), terrain: { source: 'glo30' as const, reliefM: 6.45, rpc, heights } };

        const { world } = await finish(uploaded({ source: undefined, origin: 'regeoref', georef }));

        expect((await readLayer(world, LAYER))?.attribution).toBe(`${USGS_ATTRIBUTION}; ${DEM_ATTRIBUTION}`);
    });

    it('badPath_nothingIsFinalizedWhenTheJobOrItsRenderIsGone', async () => {
        const world = await readyWorld();
        await seedVersion(world, JOB, uploaded());

        const withoutJob = await finalizeVersion(world.deps, {
            cityId: CITY,
            jobId: JOB,
            versionId: JOB,
            origin: 'mts',
            tilesetId: TILESET,
        });
        await seedJob(world, JOB, job());
        const withoutRender = await finalizeVersion(world.deps, {
            cityId: CITY,
            jobId: JOB,
            versionId: 'none',
            origin: 'mts',
            tilesetId: TILESET,
        });

        expect([withoutJob, withoutRender]).toEqual([false, false]);
        expect(await readLayer(world, LAYER)).toBeUndefined();
    });
});
