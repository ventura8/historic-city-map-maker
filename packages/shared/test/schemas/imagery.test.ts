import { describe, expect, it } from 'vitest';

import { cityDocSchema, layerDocSchema } from '../../src/schemas/firestore.js';
import { enabledGcps, gcpSchema, georefSchema, MIN_GCPS, type Gcp } from '../../src/schemas/georef.js';
import { cityImagerySchema, DEFAULT_RMSE_THRESHOLD_M, imagerySettingsOf } from '../../src/schemas/imagery-settings.js';
import {
    JOB_PARAMS_SCHEMAS,
    JOB_STEPS,
    PIPELINE_STEPS,
    PUBLISH_STEPS,
    isSideJob,
    layerVersionDocSchema,
    runsOnPipeline,
} from '../../src/schemas/imagery.js';
import { JOB_TYPES } from '../../src/schemas/firestore-ops.js';
import { STORAGE_PATHS } from '../../src/schemas/paths.js';
import { SENSOR_SPECS, SENSORS } from '../../src/schemas/usgs-scene.js';
import { validate } from '../../src/schemas/validation.js';

const now = { seconds: 1_792_000_000, nanoseconds: 0 };
const stamp = { updatedBy: 'system:pipeline', updatedAt: now };

function pair(id: string, x: number, enabled = true): Gcp {
    return { id, pixel: { x, y: x / 2 }, geo: { lat: 44.4 + x / 100_000, lng: 26 + x / 100_000 }, enabled, origin: 'manual' };
}

const gcps = [pair('g1', 0), pair('g2', 1000), pair('g3', 2000), pair('g4', 3000, false)];
const output = {
    cogPath: 'rasters/bucharest/l1/v1/cog.tif',
    cogBytes: 10,
    cogSha256: 'c'.repeat(64),
    previewPath: 'rasters/bucharest/l1/v1/preview.png',
    bounds: { west: 25.95, south: 44.33, east: 26.25, north: 44.55 },
    minzoom: 10,
    maxzoom: 16,
    areaKm2: 600,
};
const version = {
    layerId: 'l1',
    jobId: 'v1',
    origin: 'usgs',
    state: 'processing',
    label: { ro: 'KH-4A Corona, 12 iulie 1966' },
    year: 1966,
    createdBy: 'uid-owner',
    createdAt: now,
    ...stamp,
};

describe('georeferencing as stored', () => {
    it('happyPath_aFitNeedsEnoughEnabledPairsForItsTransform', () => {
        expect(enabledGcps(gcps)).toBe(3);
        expect(validate(georefSchema, { method: 'gcps', transform: 'affine', gcps }).ok).toBe(true);
        expect(validate(georefSchema, { method: 'embedded', transform: 'affine', gcps: [] }).ok).toBe(true);
        expect(MIN_GCPS).toEqual({ affine: 3, poly2: 6, tps: 10 });
    });

    it.each([
        ['too few pairs for a polynomial', { method: 'auto', transform: 'poly2', gcps }, 'gcps', 'validation.tooSmall'],
        [
            'two pairs of one id',
            { method: 'gcps', transform: 'affine', gcps: [...gcps, pair('g1', 4000)] },
            'gcps',
            'validation.duplicateId',
        ],
        [
            'a pixel past the largest scan',
            { method: 'gcps', transform: 'affine', gcps: [{ ...pair('g9', 0), pixel: { x: 300_000, y: 1 } }] },
            'gcps[0].pixel.x',
            'validation.tooBig',
        ],
    ])('badPath_%s', (_name, georef, path, code) => {
        const result = validate(georefSchema, georef);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    /** M15 §1: a panoramic camera's map, sampled for the warp. */
    function lattice(count: number, model = 'panoramic'): unknown {
        const nodes = Array.from({ length: count }, (_, index) => ({
            pixel: { x: index * 10, y: 0 },
            geo: { lat: 44.4, lng: 26 + index * 0.001 },
        }));
        return { model, nodes };
    }

    it('happyPath_aPanoramicMapCarriesTheLatticeTheWarpRendersThrough @S-P06-HAPPY-PANORAMIC-CAMERA', () => {
        const georef = { method: 'auto', transform: 'affine', gcps, lattice: lattice(289) };

        expect(validate(georefSchema, georef).ok).toBe(true);
    });

    it.each([
        ['a model no pipeline writes', lattice(9, 'poly3'), 'lattice.model', 'validation.value'],
        ['more nodes than the 17 x 17 the pipeline samples', lattice(290), 'lattice.nodes', 'validation.tooBig'],
        ['fewer nodes than the 17 x 17 the pipeline samples', lattice(288), 'lattice.nodes', 'validation.tooSmall'],
    ])('badPath_aLatticeWith_%s @S-P06-BAD-RENDERED-OWN-POINTS', (_name, value, path, code) => {
        const result = validate(georefSchema, { method: 'auto', transform: 'affine', gcps, lattice: value });

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    /** M15, *Terrain*: the RPC a frame over terrain is read through, and the heights under its scan (3 x 2 cells). */
    function terrain(coefficients = 20, valuesDm = 'AAAAAAAAAAAAAAAA'): unknown {
        const axes = { line: 400, samp: 600, lat: 44.43, lng: 26.1, height: 90 };
        const set = Array.from({ length: coefficients }, (_, index) => (index === 0 ? 1 : 0));
        return {
            source: 'glo30',
            reliefM: 6.45,
            rpc: { offset: axes, scale: axes, lineNum: set, lineDen: set, sampNum: set, sampDen: set },
            heights: { left: 2.9e6, top: 5.5e6, cell: 420, columns: 3, rows: 2, baseDm: 512, valuesDm },
        };
    }

    it('happyPath_aFrameOverTerrainCarriesItsRpc @S-P06-HAPPY-TERRAIN', () => {
        const georef = { method: 'auto', transform: 'affine', gcps, lattice: lattice(289), terrain: terrain() };

        expect(validate(georefSchema, georef).ok).toBe(true);
    });

    it.each([
        ['nineteen coefficients a set', terrain(19), 'terrain.rpc.lineNum', 'validation.tooSmall'],
        ['another surface model', { ...(terrain() as object), source: 'srtm' }, 'terrain.source', 'validation.value'],
        ['heights short of their cells', terrain(20, 'AAAA'), 'terrain.heights.valuesDm', 'validation.format'],
        ['no heights', { ...(terrain() as object), heights: undefined }, 'terrain.heights', 'validation.required'],
    ])('badPath_aTerrainWith_%s @S-P06-BAD-TERRAIN-UNAVAILABLE', (_name, value, path, code) => {
        const result = validate(georefSchema, { method: 'auto', transform: 'affine', gcps, terrain: value });

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    it('badPath_aPairWithAnUnknownOriginIsRefused', () => {
        expect(gcpSchema.safeParse({ ...pair('g1', 0), origin: 'guess' }).success).toBe(false);
    });
});

describe('city imagery settings', () => {
    it('happyPath_absentSettingsTakeTheirDefaults', () => {
        expect(imagerySettingsOf(undefined)).toEqual({
            autoPublish: true,
            rmseThresholdM: DEFAULT_RMSE_THRESHOLD_M,
            targetYears: [],
            publishThroughMapbox: false,
            mapThresholdMaxM: 60,
            mapAutoPublish: true,
            landsatAuto: true,
            landsatFrom: 1984,
            landsatTo: undefined,
        });
        expect(imagerySettingsOf({ autoPublish: false, rmseThresholdM: 8, targetYears: [1966], publishThroughMapbox: true })).toEqual({
            autoPublish: false,
            rmseThresholdM: 8,
            targetYears: [1966],
            publishThroughMapbox: true,
            mapThresholdMaxM: 60,
            mapAutoPublish: true,
            landsatAuto: true,
            landsatFrom: 1984,
            landsatTo: undefined,
        });
    });

    it('badPath_aRepeatedTargetYearOrAThresholdOutOfRangeIsRefused', () => {
        expect(validate(cityImagerySchema, { targetYears: [1966, 1966] })).toEqual({
            ok: false,
            issues: [{ path: 'targetYears', code: 'validation.duplicateId' }],
        });
        expect(validate(cityImagerySchema, { rmseThresholdM: 0.5 }).ok).toBe(false);
    });

    it('happyPath_theCityAndLayerDocumentsCarryTheM3Fields', () => {
        expect(cityDocSchema.shape.imagery.safeParse({ autoPublish: true }).success).toBe(true);
        expect(layerDocSchema.shape.pendingVersion.safeParse('v2').success).toBe(true);
        expect(layerDocSchema.shape.mapbox.safeParse({ tilesetId: 'u.t', origin: 'studio' }).success).toBe(true);
    });
});

describe('layer versions', () => {
    it('happyPath_eachStateCarriesWhatItNeeds', () => {
        expect(validate(layerVersionDocSchema, version).ok).toBe(true);
        expect(validate(layerVersionDocSchema, { ...version, state: 'awaiting_approval', output }).ok).toBe(true);
        expect(
            validate(layerVersionDocSchema, {
                ...version,
                state: 'failed',
                error: { code: 'apiError.imagery.noMatch', params: { pairs: '2' } },
            }).ok,
        ).toBe(true);
    });

    it.each([
        ['awaiting approval without an output', { ...version, state: 'awaiting_approval' }],
        ['published without its tileset', { ...version, state: 'published', output }],
        ['waiting for points without a scan', { ...version, state: 'needs_gcps' }],
        ['failed without a reason', { ...version, state: 'failed' }],
    ])('badPath_%s', (_name, doc) => {
        expect(validate(layerVersionDocSchema, doc)).toEqual({ ok: false, issues: [{ path: 'state', code: 'validation.required' }] });
    });

    const scene = (item: string, northM: number, kept: boolean) => ({
        items: [item],
        date: '2026-08-17',
        cloud: 0,
        eastM: 0,
        northM,
        kept,
    });
    const reference = (s2Check: object) => ({
        ...version,
        reference: { bounds: output.bounds, s2Item: 'S2C_35TMK_20260817_0_L2A', s2Check },
    });
    const shifted = {
        status: 'agreed',
        boundM: 7.5,
        chosen: 1,
        scenes: [scene('a', -11.2, false), scene('b', 0.8, true), scene('c', 2.6, true)],
    };

    it('happyPath_theReferenceRecordsWhichSceneTheGuardChoseAndItsOffset @S-P06-HAPPY-REFERENCE-AGREEMENT', () => {
        expect(validate(layerVersionDocSchema, reference(shifted)).ok).toBe(true);
        const lone = { status: 'unchecked', boundM: 7.5, chosen: 0, scenes: [{ items: ['a'], date: '2026-08-17', cloud: 3, kept: true }] };
        expect(validate(layerVersionDocSchema, reference(lone)).ok).toBe(true);
    });

    it.each([
        ['a chosen scene it does not list', { ...shifted, chosen: 3 }],
        ['an unknown verdict', { ...shifted, status: 'probably' }],
        ['no scene at all', { ...shifted, chosen: 0, scenes: [] }],
    ])('badPath_aGuardRecordWith%sIsRefused @S-P06-BAD-REFERENCE-SHIFTED-DATE', (_name, check) => {
        expect(validate(layerVersionDocSchema, reference(check)).ok).toBe(false);
    });

    it('badPath_anErrorThatIsNotAnApiCodeIsRefused', () => {
        expect(validate(layerVersionDocSchema, { ...version, state: 'failed', error: { code: 'it broke' } }).ok).toBe(false);
    });
});

describe('jobs', () => {
    it('happyPath_everyTypeHasItsParamsAndSteps', () => {
        const byName = (left: string, right: string): number => left.localeCompare(right);
        expect(Object.keys(JOB_PARAMS_SCHEMAS).toSorted(byName)).toEqual([...JOB_TYPES].toSorted(byName));
        expect(JOB_PARAMS_SCHEMAS['usgs-import'].safeParse({ entityId: 'DS1035', dataset: 'corona2', sensor: 'KH-4A' }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS['geotiff-import'].safeParse({ uploadPath: 'uploads/rasters/x', replaces: false }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS.regeoref.safeParse({ basedOn: 'v1' }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS.republish.safeParse({ versionId: 'v1' }).success).toBe(true);
        expect(JOB_STEPS['usgs-import'].slice(-PUBLISH_STEPS.length)).toEqual(PUBLISH_STEPS);
        const known: readonly string[] = [...PIPELINE_STEPS, ...PUBLISH_STEPS];
        expect(JOB_STEPS.regeoref.every((step) => known.includes(step))).toBe(true);
    });

    it.each([
        ['usgs-import', true],
        ['geotiff-import', true],
        ['regeoref', true],
        ['republish', false],
        ['layer-delete', false],
        ['layer-join', true],
    ] as const)('runsOnPipeline_%s', (type, expected) => {
        expect(runsOnPipeline(type)).toBe(expected);
    });

    it('badPath_paramsOfAnotherTypeAreRefused', () => {
        expect(JOB_PARAMS_SCHEMAS['usgs-import'].safeParse({ basedOn: 'v1' }).success).toBe(false);
    });
});

describe('sensors', () => {
    it('happyPath_eachSensorBelongsToADatasetWithItsZoomRange', () => {
        expect(SENSORS.map((sensor) => SENSOR_SPECS[sensor].dataset)).toEqual([
            'corona2',
            'corona2',
            'corona2',
            'corona2',
            'declassii',
            'declassii',
            'declassiii',
            'landsat_tm_c2_l1',
            'landsat_tm_c2_l1',
            'landsat_etm_c2_l1',
            'landsat_ot_c2_l1',
            'landsat_ot_c2_l1',
        ]);
        expect(SENSOR_SPECS['L9-OLI']).toMatchObject({ resolutionM: 15, maxzoom: 14 });
        expect(SENSOR_SPECS['KH-9-pan']).toMatchObject({ maxzoom: 17, machine: 'xl' });
        expect(SENSORS.every((sensor) => SENSOR_SPECS[sensor].minzoom < SENSOR_SPECS[sensor].maxzoom)).toBe(true);
    });
});

describe('a version on its own tiles (M12)', () => {
    const OWN = {
        path: 'tiles/c/l/v.pmtiles',
        url: 'https://storage.googleapis.com/p-public/tiles/c/l/v.pmtiles',
        bytes: 7,
        publishedAt: now,
    };
    const TILES = {
        path: 'rasters/c/l/v/tiles.pmtiles',
        bytes: 7,
        count: 1,
        sha256: 'd'.repeat(64),
        thumbPath: 'rasters/c/l/v/thumb.webp',
    };
    const outputOnly = { previewPath: output.previewPath, bounds: output.bounds, minzoom: 10, maxzoom: 16, areaKm2: 600 };

    it('happyPath_aPublishedVersionNeedsMapboxOrItsOwnTiles', () => {
        const base = { ...version, state: 'published', output };
        expect(layerVersionDocSchema.safeParse({ ...base, own: OWN }).success).toBe(true);
        expect(layerVersionDocSchema.safeParse({ ...base, state: 'superseded', own: { ...OWN, removedAt: now } }).success).toBe(true);
    });

    it('badPath_aPublishedVersionWithNeitherIsRefused', () => {
        expect(layerVersionDocSchema.safeParse({ ...version, state: 'published', output }).success).toBe(false);
    });

    it('happyPath_anOutputMayHaveTilesAndNoCog', () => {
        const own = { ...version, state: 'awaiting_approval', output: { ...outputOnly, tiles: TILES } };
        expect(layerVersionDocSchema.safeParse(own).success).toBe(true);
    });

    it('badPath_tilesWithoutTheirCountAreRefused', () => {
        const partial = { path: TILES.path, bytes: TILES.bytes, sha256: TILES.sha256, thumbPath: TILES.thumbPath };
        expect(
            layerVersionDocSchema.safeParse({ ...version, state: 'awaiting_approval', output: { ...output, tiles: partial } }).success,
        ).toBe(false);
    });

    it('happyPath_theJobThatMakesThemIsASideJobOfOneStep', () => {
        expect(JOB_STEPS['layer-tiles']).toEqual(['pyramid']);
        expect(isSideJob('layer-tiles')).toBe(true);
        expect(isSideJob('usgs-import')).toBe(false);
        expect(runsOnPipeline('layer-tiles')).toBe(true);
        expect(JOB_PARAMS_SCHEMAS['layer-tiles'].safeParse({ versionId: 'v1' }).success).toBe(true);
        expect(JOB_PARAMS_SCHEMAS['layer-tiles'].safeParse({ versionId: 'v1', more: 1 }).success).toBe(false);
    });

    it('happyPath_thePublicArchivesPathsAreSpelledOnce', () => {
        expect(STORAGE_PATHS.layerTiles('bucharest', 'l1', 'v1')).toBe('tiles/bucharest/l1/v1.pmtiles');
        expect(STORAGE_PATHS.layerTilesPrefix('bucharest', 'l1')).toBe('tiles/bucharest/l1/');
        expect(() => STORAGE_PATHS.layerTiles('bucharest', '../l', 'v1')).toThrow(RangeError);
    });
});
