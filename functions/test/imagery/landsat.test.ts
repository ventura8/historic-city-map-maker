/**
 * M25 (`docs/research/M25-landsat.md`): Landsat in the functions. The harvest's search of a Landsat dataset (summer months, a cloud cap,
 * ETM+ before its failure), the camera a record names, the tick's own import of the best scene of each wanted year within the daily
 * cap, the approval policy over the pipeline's `landsat` report, and the layer's credit.
 */
import {
    FIRESTORE_PATHS,
    LANDSAT_ATTRIBUTION,
    LANDSAT_MONTHS,
    LANDSAT_SEARCH_MAX_CLOUD,
    jobDocSchema,
    type JobDoc,
    type LandsatReport,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { finalizeVersion } from '../../src/imagery/finalize.js';
import { searchOf } from '../../src/imagery/harvest-landsat.js';
import { importLandsat, landsatPicks } from '../../src/imagery/landsat-auto.js';
import { sceneFields } from '../../src/imagery/scene-record.js';
import { sceneRecord } from '../support/imagery-fakes.js';
import {
    BOUNDS,
    CITY,
    NOW,
    at,
    goldenOutput,
    readLayer,
    readScene,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedGuard,
    seedJob,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const TM_1989 = 'LT51830291989193MTI00';
const TM_1989_CLOUDY = 'LT51830291989209MTI00';
const TM_1990 = 'LT51830291990180MTI00';
const JOB = 'im-landsat-1989';
const LAYER = 'landsat-5-tm-1989';

function landsat(overrides: Partial<UsgsSceneDoc> = {}): Partial<UsgsSceneDoc> {
    return {
        dataset: 'landsat_tm_c2_l1',
        sensor: 'L5-TM',
        acquisitionDate: '1989-07-12',
        resolutionM: 30,
        coverage: 1,
        cloudCover: 2,
        rank: { score: 70, reasons: [{ code: 'free' }], version: 4 },
        ...overrides,
    };
}

async function seedLandsat(world: ImageryWorld): Promise<void> {
    await seedScene(world, TM_1989, landsat());
    await seedScene(
        world,
        TM_1989_CLOUDY,
        landsat({ acquisitionDate: '1989-07-28', cloudCover: 35, rank: { score: 75, reasons: [], version: 4 } }),
    );
    await seedScene(world, TM_1990, landsat({ acquisitionDate: '1990-06-29', cloudCover: 5 }));
}

async function landsatJobs(world: ImageryWorld): Promise<JobDoc[]> {
    const jobs = await world.deps.documents.query(FIRESTORE_PATHS.jobs(CITY), jobDocSchema);
    return jobs.documents.map((job) => job.data).filter((job) => String(job.params['dataset']).startsWith('landsat'));
}

describe('the harvest of a Landsat dataset', () => {
    it('happyPath_summerMonthsUnderTheCloudCapAndEtmBeforeItsFailure @S-A130-HAPPY', () => {
        expect(searchOf('landsat_tm_c2_l1', { from: '1984-01-01' })).toEqual({
            from: '1984-01-01',
            months: LANDSAT_MONTHS,
            maxCloud: LANDSAT_SEARCH_MAX_CLOUD,
        });
        expect(searchOf('landsat_etm_c2_l1', {})).toMatchObject({ to: '2003-05-30' });
        expect(searchOf('landsat_etm_c2_l1', { to: '2001-12-31' })).toMatchObject({ to: '2001-12-31' });
        expect(searchOf('landsat_etm_c2_l1', { to: '2010-12-31' })).toMatchObject({ to: '2003-05-30' });
    });

    it('badPath_aDeclassifiedDatasetsSearchIsUnchanged @S-A130-BAD-CLOUDY', () => {
        expect(searchOf('corona2', { to: '1980-12-31' })).toEqual({ to: '1980-12-31' });
    });

    it('happyPath_theSatelliteIsReadFromTheEntityId @S-A130-HAPPY', () => {
        const sensor = (dataset: 'landsat_tm_c2_l1' | 'landsat_etm_c2_l1', id: string) =>
            sceneFields(sceneRecord(id), dataset, BOUNDS)?.sensor;

        expect([sensor('landsat_tm_c2_l1', 'LT41830291988200XXX01'), sensor('landsat_tm_c2_l1', TM_1989)]).toEqual(['L4-TM', 'L5-TM']);
        expect([sensor('landsat_tm_c2_l1', 'X1'), sensor('landsat_etm_c2_l1', 'LE71830292000197SGS00')]).toEqual(['L5-TM', 'L7-ETM']);
        expect(sceneFields(sceneRecord(TM_1989), 'landsat_tm_c2_l1', BOUNDS)?.resolutionM).toBe(30);
    });
});

describe('the tick’s Landsat imports', () => {
    it('happyPath_theBestClearSceneOfTheOldestWantedYearIsImportedOneATick @S-A130-HAPPY-AUTO', async () => {
        const world = await readyWorld();
        await seedLandsat(world);

        await importLandsat(world.deps, CITY, new Date(NOW));

        const [first] = await landsatJobs(world);
        expect(first).toMatchObject({ type: 'usgs-import', params: { entityId: TM_1989, sensor: 'L5-TM' }, createdBy: 'system:imagery' });
        expect((await readScene(world, TM_1989))?.status).toBe('imported');
        expect((await readScene(world, TM_1989_CLOUDY))?.status).toBe('candidate');

        world.deps.clock.set('2026-10-23T08:05:00.000Z');
        await importLandsat(world.deps, CITY, new Date('2026-10-23T08:05:00.000Z'));
        expect((await landsatJobs(world)).map((job) => String(job.params['entityId'])).sort((a, b) => a.localeCompare(b))).toEqual([
            TM_1989,
            TM_1990,
        ]);
    });

    it('happyPath_aYearsBestIsTheHigherRankThenTheClearerAndAYearWithAnImportIsDone @S-A130-HAPPY-AUTO', () => {
        const base = { status: 'candidate', downloadAvailable: true, coverage: 1 } as const;
        const scene = (entityId: string, score: number, cloudCover: number, date = '1995-07-01') =>
            ({
                ...base,
                ...landsat({ acquisitionDate: date, cloudCover }),
                entityId,
                rank: { score, reasons: [], version: 4 },
            }) as UsgsSceneDoc;

        expect(landsatPicks([scene('B', 60, 1), scene('A', 60, 3), scene('C', 50, 0)], [1995]).map((s) => s.entityId)).toEqual(['B']);
        expect(landsatPicks([scene('B', 60, 1), scene('A', 60, 1)], [1995]).map((s) => s.entityId)).toEqual(['A']);
        expect(landsatPicks([scene('A', 60, 1), { ...scene('D', 10, 1), status: 'imported' }], [1995])).toEqual([]);
        expect(landsatPicks([{ ...scene('E', 90, 1), dataset: 'corona2' }], [1995])).toEqual([]);
    });

    it('badPath_nothingIsImportedWithTheSwitchOffTheGuardRedOrNoUsgsDownloads @S-A130-BAD-AUTO-OFF', async () => {
        const off = await readyWorld();
        await seedCity(off, { imagery: { landsatAuto: false } });
        await seedLandsat(off);
        const red = await readyWorld();
        await seedGuard(red, 'red');
        await seedLandsat(red);
        const searchOnly = await readyWorld();
        await seedSetup(searchOnly, { usgs: { state: 'ok', role: 'search' } });
        await seedLandsat(searchOnly);
        const outOfYears = await readyWorld();
        await seedCity(outOfYears, { imagery: { landsatFrom: 1995, landsatTo: 1999 } });
        await seedLandsat(outOfYears);
        // M28 (@S-A180-BAD-LANDSAT-OFF): Landsat left out of the map's sources imports nothing either.
        const notASource = await readyWorld();
        await seedCity(notASource, { sources: { landsat: false } });
        await seedLandsat(notASource);

        for (const world of [off, red, searchOnly, outOfYears, notASource]) {
            await importLandsat(world.deps, CITY, new Date(NOW));
            expect(await landsatJobs(world)).toEqual([]);
        }
        expect((await readScene(red, TM_1989))?.status).toBe('candidate');
    });
});

const CLEAR: LandsatReport = { checked: true, offsetPx: 0.3, offsetM: 9, cityCloudPct: 1, resolutionM: 30, pansharpened: false };

function landsatVersion(report: LandsatReport, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        layerId: LAYER,
        jobId: JOB,
        source: { kind: 'usgs', entityId: TM_1989, dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM', acquisitionDate: '1989-07-12' },
        sensor: 'L5-TM',
        label: { ro: 'Landsat 5 TM, 12 iulie 1989', en: 'Landsat 5 TM, 12 July 1989' },
        year: 1989,
        date: '1989-07-12',
        georef: undefined,
        calibration: undefined,
        scan: undefined,
        landsat: report,
        output: { ...goldenOutput(), areaKm2: 100, coveragePct: 100, minzoom: 8, maxzoom: 13 },
        ...overrides,
    });
}

function landsatJob(status: JobDoc['status']): JobDoc {
    return {
        type: 'usgs-import',
        status,
        params: { entityId: TM_1989, dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM' },
        createdBy: 'system:imagery',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    };
}

describe('a Landsat version’s approval and credit', () => {
    it('happyPath_withinAPixelOverAClearCityItPublishesItselfCreditedToNasaAndUsgs @S-A130-HAPPY', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, landsatJob('awaiting_approval'));
        await seedVersion(world, JOB, landsatVersion(CLEAR));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(true);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved', approval: { auto: true, checkpointRmseM: 9 } });

        const publishing = await readyWorld();
        await seedJob(publishing, JOB, landsatJob('mts_processing'));
        await seedVersion(
            publishing,
            JOB,
            landsatVersion(CLEAR, { state: 'publishing', approval: { auto: true, by: 'system:imagery', at: at(NOW) } }),
        );
        await finalizeVersion(publishing.deps, {
            cityId: CITY,
            jobId: JOB,
            versionId: JOB,
            origin: 'mts',
            tilesetId: 'e2e-mapbox.hcm-landsat',
        });
        expect(await readLayer(publishing, LAYER)).toMatchObject({
            kind: 'satellite',
            attribution: LANDSAT_ATTRIBUTION,
            sensor: 'Landsat 5 TM',
        });
    });

    it.each([
        ['more than a pixel off', { ...CLEAR, offsetPx: 1.8, offsetM: 54 }],
        ['clouds over the city', { ...CLEAR, cityCloudPct: 30 }],
        ['no shift measured', { checked: false, cityCloudPct: 0, resolutionM: 30, pansharpened: false }],
    ] as const)('badPath_itWaitsForApproveWith_%s @S-A130-BAD-OFFSET', async (_case, report: LandsatReport) => {
        const world = await readyWorld();
        await seedJob(world, JOB, landsatJob('awaiting_approval'));
        await seedVersion(world, JOB, landsatVersion(report));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect((await readVersion(world, JOB))?.state).toBe('awaiting_approval');
    });
});
