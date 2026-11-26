/**
 * `imagery.search` and the harvest (`functions/src/imagery/{search,harvest,scene-record,usgs-session}.ts`,
 * `docs/research/M3-interfaces.md` §3): every dataset searched over the city's bounds, each frame kept with its camera,
 * footprint, coverage and rank, the best browse images copied; a failing dataset spares the others; an address outside
 * USGS's browse host is never fetched; USGS's failures become the Imagery area's codes, and the key is always logged out.
 */
import { BROWSE_PREFETCH, FIRESTORE_PATHS, RANKING_VERSION, RASTER_PATHS, USGS_DATASETS, harvestStateDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { SEARCH_BUDGET_MS } from '../../src/imagery/harvest-target.js';
import { searchFunction } from '../../src/imagery/search.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { JPEG_BYTES, sceneRecord, type SceneRecord } from '../support/imagery-fakes.js';
import {
    CITY,
    NOW,
    at,
    imageryWorld,
    readScene,
    readyWorld,
    renderedVersion,
    seedCity,
    seedLayer,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const KH4B = 'DS1105-1071DF075';
const ORDER_ONLY = 'DS1105-1071DF076';
const MAPPING = 'D3C1213-200346A003';
const PANORAMIC = 'D3C1216-401178F016';

const CORNERS = {
    'NW Corner Lat dec': '44.52',
    'NW Corner Long dec': '25.95',
    'NE Corner Lat dec': '44.52',
    'NE Corner Long dec': '26.25',
    'SE Corner Lat dec': '44.35',
    'SE Corner Long dec': '26.25',
    'SW Corner Lat dec': '44.35',
    'SW Corner Long dec': '25.95',
};

function records(): Readonly<Record<string, readonly SceneRecord[]>> {
    return {
        corona2: [
            sceneRecord(KH4B, { metadata: { 'Camera Type': 'KH-4B', ...CORNERS }, displayId: 'DS1105-1071DF075-F' }),
            sceneRecord(ORDER_ONLY, { downloadAvailable: false, cloudCover: 20, acquisitionDate: '1968-12-11' }),
        ],
        declassii: [sceneRecord(MAPPING, { metadata: { 'Camera Type': 'KH-9 Mapping Camera' }, acquisitionDate: '1978-03-30' })],
        declassiii: [sceneRecord(PANORAMIC, { acquisitionDate: '1980-07-16', cloudCover: -1 })],
    };
}

function serveBrowse(world: ImageryWorld, entityIds: readonly string[]): void {
    for (const entityId of entityIds) {
        world.remote.serve(`https://ims.cr.usgs.gov/browse/declass1/${entityId}.jpg`, JPEG_BYTES);
    }
}

function search(world: ImageryWorld, data: unknown = { cityId: CITY }) {
    return searchFunction(() => world.deps).run(adminCall(data));
}

/** The measured KH-9 panoramic frame's outline (D3C1202-200149F039): a strip over Bucharest, as M2M closes its ring. */
const PANORAMIC_RING: [number, number][] = [
    [22.169, 45.112],
    [29.158, 44.205],
    [29.2, 43.887],
    [21.965, 44.824],
    [22.169, 45.112],
];

const PANORAMIC_CORNERS = {
    'NW Corner Lat dec': '45.112',
    'NW Corner Long dec': '22.169',
    'NE Corner Lat dec': '44.205',
    'NE Corner Long dec': '29.158',
    'SE Corner Lat dec': '43.887',
    'SE Corner Long dec': '29.2',
    'SW Corner Lat dec': '44.824',
    'SW Corner Long dec': '21.965',
};

describe('imagery.search: the years the city shows', () => {
    it.each([
        ['an unfinished version counts', 'processing', { code: 'sameYear', params: { year: '1966' } }],
        ['a failed version does not: its id is held, nothing is shown', 'failed', { code: 'noLayers' }],
    ] as const)('happyPath_%s', async (_case, state, reason) => {
        // M8: another day of the year; a neighbour of the very date is `sameDate` (join-plan.test.ts).
        const world = await readyWorld(NOW, { corona2: [sceneRecord(KH4B, { acquisitionDate: '1966-07-13' })] });
        serveBrowse(world, [KH4B]);
        const error = { code: 'apiError.imagery.cityNotFound' } as const;
        await seedVersion(world, 'v-1', renderedVersion({ jobId: 'v-1', layerId: 'another-layer', year: 1966, state, error }));

        await search(world);

        expect((await readScene(world, KH4B))?.rank.reasons).toContainEqual(reason);
    });
});

describe('imagery.search: how much of the city a frame covers', () => {
    const FRAME = 'D3C1202-200149F039';

    it('happyPath_aKh9PanoramicFrameCoversItsBowTie_theFootprintStaysUsgss @S-A11-HAPPY-PANORAMIC-COVERAGE', async () => {
        const frame = sceneRecord(FRAME, { footprint: PANORAMIC_RING, metadata: PANORAMIC_CORNERS, acquisitionDate: '1972-05-20' });
        const world = await readyWorld(NOW, { declassiii: [frame] });
        serveBrowse(world, [FRAME]);
        // Harvested before this model: the next search reads it again, the admin's own fields kept.
        await seedScene(world, FRAME, { dataset: 'declassiii', sensor: 'KH-9-pan', coverage: 0.97, note: 'Bună.' });

        await search(world);

        const scene = await readScene(world, FRAME);
        expect(scene?.coverage).toBeCloseTo(0.53, 2);
        expect(scene).toMatchObject({ note: 'Bună.' });
        expect(scene?.rank.reasons).toContainEqual({ code: 'coverage', params: { percent: '53' } });
        expect(scene?.footprint).toHaveLength(4);
        expect(scene?.footprint[0]).toEqual({ lat: 45.112, lng: 22.169 });
    });

    it('badPath_aCoronaFrameOfTheSameOutlineKeepsItsWholeFootprint @S-A11-BAD-CORONA-COVERAGE-UNCHANGED', async () => {
        const frame = sceneRecord(KH4B, { footprint: PANORAMIC_RING, metadata: { 'Camera Type': 'KH-4B', ...PANORAMIC_CORNERS } });
        const world = await readyWorld(NOW, { corona2: [frame] });
        serveBrowse(world, [KH4B]);

        await search(world);

        const scene = await readScene(world, KH4B);
        expect(scene?.sensor).toBe('KH-4B');
        expect(scene?.coverage).toBeCloseTo(0.975, 3);
    });
});

describe('imagery.search', () => {
    it('happyPath_everyDatasetIsHarvestedRankedAndItsBrowseImagesCopied @S-A11-HAPPY-HARVEST', async () => {
        const world = await readyWorld(NOW, records());
        serveBrowse(world, [KH4B, ORDER_ONLY, MAPPING, PANORAMIC]);

        const response = await search(world);

        expect(response).toEqual({
            found: 4,
            added: 4,
            updated: 0,
            failedDatasets: [],
            searchedAt: NOW,
            datasets: {
                corona2: { state: 'done', found: 2 },
                declassii: { state: 'done', found: 1 },
                declassiii: { state: 'done', found: 1 },
                landsat_tm_c2_l1: { state: 'done', found: 0 },
                landsat_etm_c2_l1: { state: 'done', found: 0 },
                landsat_ot_c2_l1: { state: 'done', found: 0 },
            },
        });
        const kh4b = await readScene(world, KH4B);
        expect(kh4b).toMatchObject({
            entityId: KH4B,
            displayId: 'DS1105-1071DF075-F',
            dataset: 'corona2',
            sensor: 'KH-4B',
            status: 'candidate',
            downloadAvailable: true,
            resolutionM: 1.8,
            corners: { nw: { lat: 44.52, lng: 25.95 }, se: { lat: 44.35, lng: 26.25 } },
            browse: { state: 'copied', path: RASTER_PATHS.browse('corona2', KH4B) },
            rank: { version: RANKING_VERSION },
            harvestedAt: at(NOW),
            updatedBy: 'system:imagery',
        });
        expect(kh4b?.footprint).toHaveLength(4);
        expect(kh4b?.coverage).toBeCloseTo(0.425, 6);
        // Under half the city: the reason that explains the lower rank comes first, then what adds most.
        expect(kh4b?.rank.reasons.slice(0, 2)).toEqual([{ code: 'coverage', params: { percent: '42' } }, { code: 'free' }]);
        expect(await readScene(world, MAPPING)).toMatchObject({ sensor: 'KH-9-mapping', resolutionM: 7.5 });
        expect(await readScene(world, PANORAMIC)).toMatchObject({ sensor: 'KH-9-pan' });
        expect((await readScene(world, PANORAMIC))?.cloudCover).toBeUndefined();
        expect((await readScene(world, ORDER_ONLY))?.rank.reasons).toContainEqual({ code: 'needsOrder' });
        expect(world.deps.blobs.paths('private', 'usgs-browse/')).toHaveLength(4);
        expect(world.usgs.sessions.size).toBe(0);
        expect(world.scenes.recorder.argsOf('search').map(([, request]) => (request as { dataset: string }).dataset)).toEqual([
            'corona2',
            'declassii',
            'declassiii',
            'landsat_tm_c2_l1',
            'landsat_etm_c2_l1',
            'landsat_ot_c2_l1',
        ]);
        // M25: a Landsat dataset is searched in its summer months under its cloud cap.
        expect(world.scenes.recorder.argsOf('search').at(-1)?.[1]).toMatchObject({ months: [5, 6, 7, 8, 9], maxCloud: 40 });
    });

    it('happyPath_aSecondSearchUpdatesKeepsTheAdminsTriageAndNeverDuplicates @S-A11-HAPPY-HARVEST', async () => {
        const world = await readyWorld(NOW, records());
        serveBrowse(world, [KH4B, ORDER_ONLY, MAPPING, PANORAMIC]);
        await search(world);
        const first = await readScene(world, ORDER_ONLY);
        await seedScene(world, ORDER_ONLY, { ...first, status: 'rejected', note: 'Prea mult nor.' });
        world.deps.clock.set('2026-11-23T08:00:00.000Z');

        const response = await search(world);

        expect(response).toMatchObject({ found: 4, added: 0, updated: 4 });
        expect(world.deps.documents.paths(`cities/${CITY}/usgsScenes/`)).toHaveLength(4);
        expect(await readScene(world, ORDER_ONLY)).toMatchObject({
            status: 'rejected',
            note: 'Prea mult nor.',
            harvestedAt: at('2026-11-23T08:00:00.000Z'),
        });
        expect((await readScene(world, KH4B))?.browse.state).toBe('copied');
        expect(world.remote.fetched).toHaveLength(4);
    });

    it('happyPath_aDatasetIsReadPageByPageWithinTheWindow', async () => {
        const many = Array.from({ length: 130 }, (_, index) => sceneRecord(`DS1105-${String(index).padStart(4, '0')}`));
        const world = await readyWorld(NOW, { corona2: many });

        const response = await search(world, { cityId: CITY, datasets: ['corona2'], from: '1960-01-01', to: '1972-12-31' });

        expect(response.found).toBe(130);
        expect(world.scenes.recorder.argsOf('search').map(([, request]) => request)).toEqual([
            expect.objectContaining({ dataset: 'corona2', startingNumber: 1, maxResults: 100, from: '1960-01-01', to: '1972-12-31' }),
            expect.objectContaining({ startingNumber: 101 }),
        ]);
        expect(world.remote.fetched).toHaveLength(BROWSE_PREFETCH);
    });

    it('happyPath_scenesNotSeenAgainAreRankedAgainstTodaysLayers', async () => {
        const world = await readyWorld(NOW, {});
        await seedScene(world, 'DS-OLD', { acquisitionDate: '1970-05-01' });
        await seedLayer(world, 'plan-1970', { year: 1970 });

        await search(world);

        expect((await readScene(world, 'DS-OLD'))?.rank.reasons).toContainEqual({ code: 'sameYear', params: { year: '1970' } });
    });
});

describe('imagery.search: failures', () => {
    it('badPath_oneDatasetInMaintenanceDoesNotStopTheOthers @S-A11-BAD-PARTIAL-DATASETS', async () => {
        const world = await readyWorld(NOW, records());
        world.scenes.failing.set('declassiii', new UpstreamError('usgs', 'maintenance', { status: 503 }));

        const response = await search(world);

        expect(response).toMatchObject({ found: 3, added: 3, failedDatasets: ['declassiii'] });
        expect(await readScene(world, MAPPING)).toBeDefined();
        expect(await readScene(world, PANORAMIC)).toBeUndefined();
        expect(world.usgs.sessions.size).toBe(0);
    });

    it.each([
        ['every dataset in maintenance', 'maintenance', 'apiError.usgs.maintenance'],
        ['every dataset failing', 'unavailable', 'apiError.usgs.unavailable'],
    ] as const)('badPath_noDatasetAnsweringIsNotAnEmptyArea_%s @S-A11-BAD-USGS-UNAVAILABLE', async (_case, failure, code) => {
        const world = await readyWorld(NOW, records());
        for (const dataset of USGS_DATASETS) {
            world.scenes.failing.set(dataset, new UpstreamError('usgs', failure, { status: 503 }));
        }

        expect(await failureOf(search(world))).toMatchObject({ details: { code } });

        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toEqual([]);
        expect(await world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema)).toMatchObject({
            outcome: 'failed',
            failures: 1,
            error: code,
        });
        expect(world.usgs.sessions.size).toBe(0);
    });

    it.each([
        ['the rate limit on every dataset', new UpstreamError('usgs', 'rateLimited', { status: 429 }), 'apiError.rateLimited'],
        ['answers nobody can read', new UpstreamError('usgs', 'invalid', { status: 500 }), 'apiError.usgs.unavailable'],
    ])('badPath_whatNoDatasetAnsweringSays_%s @S-A11-BAD-USGS-UNAVAILABLE', async (_case, error, code) => {
        const world = await readyWorld(NOW, records());
        for (const dataset of USGS_DATASETS) {
            world.scenes.failing.set(dataset, error);
        }

        expect(await failureOf(search(world))).toMatchObject({ details: { code } });
    });

    it('badPath_aFailureOfNoApiIsRecordedAsInternal', async () => {
        const world = await readyWorld(NOW, records());
        world.usgs.recorder.failNext('login', new Error('socket hang up'));

        await failureOf(search(world));

        expect(await world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema)).toMatchObject({
            outcome: 'failed',
            error: 'apiError.internal',
        });
    });
});

describe('imagery.search: a slow USGS', () => {
    it('badPath_aSearchPastItsBudgetKeepsWhatItFoundAndAnswersInTime @S-A11-BAD-SEARCH-CUT-OFF', async () => {
        const many = Array.from({ length: 130 }, (_, index) => sceneRecord(`DS1105-${String(index).padStart(4, '0')}`));
        const world = await readyWorld(NOW, { ...records(), corona2: many });
        const scenes = world.deps.scenes;
        // Each page takes longer than the whole budget: the first pages arrive, nothing more is asked for.
        const slow = {
            ...scenes,
            search: async (...args: Parameters<typeof scenes.search>) => {
                const page = await scenes.search(...args);
                world.deps.clock.set(new Date(world.deps.clock.now().getTime() + SEARCH_BUDGET_MS).toISOString());
                return page;
            },
        };

        const response = await searchFunction(() => ({ ...world.deps, scenes: slow })).run(adminCall({ cityId: CITY }));

        // Two datasets at a time (M2M's rate limit): corona2 and declassii answer, the rest wait and run out of time, recorded partial.
        expect(response).toMatchObject({ found: 101 });
        expect(response.datasets?.declassiii).toMatchObject({ state: 'failed', reason: 'outOfTime', next: 1 });
        expect(
            world.scenes.recorder.argsOf('search').map(([, request]) => (request as { startingNumber: number }).startingNumber),
        ).not.toContain(101);
        expect(await readScene(world, MAPPING)).toBeDefined();
    });
});

describe('imagery.search: USGS not answering and the harvest record', () => {
    it('badPath_mixedFailuresOfEveryDatasetAreUsgsNotAnswering @S-A11-BAD-USGS-UNAVAILABLE', async () => {
        const world = await readyWorld(NOW, records());
        world.scenes.failing.set('corona2', new UpstreamError('usgs', 'maintenance', { status: 503 }));
        world.scenes.failing.set('declassii', new UpstreamError('usgs', 'unavailable', { status: 502 }));

        expect(await failureOf(search(world, { cityId: CITY, datasets: ['corona2', 'declassii'] }))).toMatchObject({
            details: { code: 'apiError.usgs.unavailable' },
        });
    });

    it('happyPath_aSearchThatAnsweredRecordsWhenTheNextIsDue', async () => {
        const world = await readyWorld(NOW, records());

        await search(world);

        expect(await world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema)).toMatchObject({
            outcome: 'ok',
            failures: 0,
            attemptedAt: at(NOW),
            nextAt: at('2026-11-22T08:00:00.000Z'),
        });
    });

    it('happyPath_aDailyCheckThatFoundUsgsInMaintenanceLeavesTheSearchOn @S-A11-BAD-USGS-UNAVAILABLE', async () => {
        const world = imageryWorld(NOW, records());
        await seedCity(world);
        await seedSetup(world, { usgs: { state: 'unavailable', role: 'download', detail: 'apiError.usgs.maintenance' } });

        await expect(search(world)).resolves.toMatchObject({ found: 4 });
    });
});

describe('imagery.search: browse images and secrets', () => {
    it('badPath_aBrowseAddressOutsideUsgsIsNeverFetched @S-A11-BAD-BROWSE-HOST-REFUSED', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord(KH4B, { browseUrl: 'https://evil.example/browse/declass1/x.jpg' })] });

        await search(world);

        expect(await readScene(world, KH4B)).toMatchObject({ browse: { state: 'failed', error: 'apiError.imagery.browseUnavailable' } });
        expect((await readScene(world, KH4B))?.browse.sourceUrl).toBeUndefined();
        expect(world.remote.recorder.calls).toEqual([]);
    });

    it.each([
        ['an entity id outside the id pattern', sceneRecord('DS 1105/../x')],
        [
            'a footprint of two points',
            sceneRecord('DS-TWO', {
                footprint: [
                    [25, 44],
                    [26, 44],
                ],
            }),
        ],
        ['an unreadable date', sceneRecord('DS-DATE', { acquisitionDate: '1966-13-45' })],
    ])('badPath_aRecordWithIsSkippedAndLogged_%s', async (_case, record) => {
        const world = await readyWorld(NOW, { corona2: [record, sceneRecord(KH4B)] });

        const response = await search(world, { cityId: CITY, datasets: ['corona2'] });

        // Lesson 676: `found` counts the scenes stored; the skipped record is only logged.
        expect(response).toMatchObject({ found: 1, added: 1 });
        expect(world.deps.recording.records.map((entry) => entry.message)).toContain('usgs scene skipped');
    });

    it.each([
        ['USGS was never connected', { usgs: undefined }],
        ['USGS refused the credentials', { usgs: { state: 'invalid' as const } }],
    ])('badPath_withoutAUsableUsgsTheSearchIsRefused_%s', async (_case, setup) => {
        const world = imageryWorld(NOW, records());
        await seedCity(world);
        await seedSetup(world, setup);

        const failure = await failureOf(search(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.usgs.notConfigured' } });
        expect(world.usgs.recorder.calls).toEqual([]);
    });

    it('happyPath_searchWorksWhileTheDownloadRoleIsPending', async () => {
        const world = imageryWorld(NOW, records());
        await seedCity(world);
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });

        await expect(search(world)).resolves.toMatchObject({ found: 4 });
    });

    it('badPath_missingSecretsAreNotConfigured', async () => {
        const world = await readyWorld(NOW, records());
        world.secrets.versions.delete('usgs-app-token');

        const failure = await failureOf(search(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.usgs.notConfigured' } });
    });

    it.each([
        ['an expired token', new UpstreamError('usgs', 'unauthorized', { status: 403 }), 'apiError.usgs.credentials'],
        ['no M2M access', new UpstreamError('usgs', 'forbidden', { status: 500 }), 'apiError.usgs.accessPending'],
        ['maintenance', new UpstreamError('usgs', 'maintenance', { status: 503 }), 'apiError.usgs.maintenance'],
        ['an outage', new UpstreamError('usgs', 'unavailable', { status: 502 }), 'apiError.usgs.unavailable'],
        ['the rate limit', new UpstreamError('usgs', 'rateLimited', { status: 429 }), 'apiError.rateLimited'],
    ])('badPath_aFailedLoginIsExplained_%s', async (_case, error, code) => {
        const world = await readyWorld(NOW, records());
        world.usgs.recorder.failNext('login', error);

        const failure = await failureOf(search(world));

        expect(failure).toMatchObject({ details: { code } });
        expect(world.scenes.recorder.calls).toEqual([]);
    });

    it('badPath_aMissingCityIsNotFound', async () => {
        const world = imageryWorld(NOW, records());
        await seedSetup(world);

        const failure = await failureOf(search(world));

        expect(failure).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
    });
});
