/**
 * USGS M2M scene search and download options (`createUsgsScenes` of `functions/src/adapters/usgs.ts`,
 * `docs/research/M3-interfaces.md` §3.1–§3.2) against a fake `fetch` answering the shared M2M fixtures: the city's bounds
 * as an `mbr` filter with the full metadata, the results mapped (footprint, cloud cover, browse, metadata fields), the
 * next page, and whether a frame is already scanned. The API key travels in `X-Auth-Token` only.
 */
import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { fixtureBody, fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable, type RouteAnswer } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { USGS_M2M_API, createUsgsScenes } from '../../src/adapters/usgs.js';

const KEY = 'e2e-usgs-api-key-0001';
const BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };

function scenes(endpoint: string, answer: RouteAnswer) {
    const upstream = createFakeFetch(routeTable([route('POST', `${USGS_M2M_API}/${endpoint}`, `usgs.${endpoint}`, answer)]));
    const recording = createRecordingSink();
    return { upstream, scenes: createUsgsScenes({ fetch: upstream.fetch, log: createLogger('functions', { sink: recording.sink }) }) };
}

/** The acquisition window a `scene-search` request sent. */
function acquisitionFilterOf(body: string | undefined): unknown {
    return (JSON.parse(String(body)) as { sceneFilter: { acquisitionFilter?: unknown } }).sceneFilter.acquisitionFilter;
}

function m2m(data: unknown): Response {
    return fixtureResponse('usgs/logout.ok', { merge: { data } });
}

describe('search', () => {
    it('happyPath_theCitysBoundsAreSearchedWithTheFullMetadata', async () => {
        const { upstream, scenes: usgs } = scenes('scene-search', () => fixtureResponse('usgs/scene-search.two-scenes'));

        const page = await usgs.search(KEY, { dataset: 'corona2', bounds: BOUNDS, maxResults: 100 });

        expect(page.totalHits).toBe(2);
        expect(page.next).toBeUndefined();
        expect(page.records[0]).toEqual({
            entityId: 'DS1105-1071DF075',
            displayId: 'DS1105-1071DF075',
            acquisitionDate: '1968-12-11',
            footprint: [
                [25.95, 44.35],
                [26.25, 44.35],
                [26.25, 44.52],
                [25.95, 44.52],
                [25.95, 44.35],
            ],
            cloudCover: null,
            downloadAvailable: true,
            browseUrl: 'https://ims.cr.usgs.gov/browse/declass1/DS1105-1071DF075.jpg',
            metadata: {},
        });
        expect(upstream.calls[0]?.headers['x-auth-token']).toBe(KEY);
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({
            datasetName: 'corona2',
            sceneFilter: {
                spatialFilter: {
                    filterType: 'mbr',
                    lowerLeft: { latitude: 44.3, longitude: 25.9 },
                    upperRight: { latitude: 44.6, longitude: 26.3 },
                },
            },
            metadataType: 'full',
            maxResults: 100,
            startingNumber: 1,
        });
    });

    it('happyPath_aWindowAPageAndTheMetadataFields', async () => {
        const [first] = (fixtureBody('usgs/scene-search.two-scenes') as { data: { results: Record<string, unknown>[] } }).data.results;
        const result = {
            ...first,
            cloudCover: 12,
            browse: [],
            metadata: [
                { fieldName: 'Camera Type', value: 'KH-4A' },
                { fieldName: 'NW Corner Lat dec', value: 44.52 },
                { fieldName: 'Empty', value: null },
                { value: 'nameless' },
            ],
            spatialCoverage: {
                type: 'Polygon',
                coordinates: [
                    [
                        [25.95, 44.35],
                        ['x', 1],
                        [26.25, 44.52],
                    ],
                ],
            },
        };
        const { upstream, scenes: usgs } = scenes('scene-search', () =>
            m2m({ results: [result, { entityId: 'no-date' }, 'junk'], totalHits: 250, nextRecord: 101 }),
        );

        const page = await usgs.search(KEY, { dataset: 'corona2', bounds: BOUNDS, maxResults: 100, startingNumber: 1, from: '1960-01-01' });

        expect(page).toMatchObject({ totalHits: 250, next: 101 });
        expect(page.records).toEqual([
            expect.objectContaining({
                cloudCover: 12,
                metadata: { 'Camera Type': 'KH-4A', 'NW Corner Lat dec': '44.52' },
                footprint: [
                    [25.95, 44.35],
                    [26.25, 44.52],
                ],
            }),
        ]);
        expect(page.records[0]?.browseUrl).toBeUndefined();
        expect(acquisitionFilterOf(upstream.calls[0]?.body)).toEqual({
            start: '1960-01-01',
            end: '2100-12-31',
        });
    });

    it('happyPath_aLandsatSearchSendsItsMonthsAndItsCloudCap @S-A130-HAPPY', async () => {
        const { upstream, scenes: usgs } = scenes('scene-search', () => m2m({ results: [] }));

        await usgs.search(KEY, { dataset: 'landsat_tm_c2_l1', bounds: BOUNDS, maxResults: 100, months: [6, 7, 8], maxCloud: 40 });
        await usgs.search(KEY, { dataset: 'corona2', bounds: BOUNDS, maxResults: 100 });

        const [landsat, corona] = upstream.calls.map(
            (call) => (JSON.parse(call.body) as { sceneFilter: Record<string, unknown> }).sceneFilter,
        );
        expect(landsat).toMatchObject({ seasonalFilter: [6, 7, 8], cloudCoverFilter: { min: 0, max: 40, includeUnknown: false } });
        expect(Object.keys(corona ?? {})).toEqual(['spatialFilter']);
    });

    it('happyPath_aWindowWithOnlyItsEnd', async () => {
        const { upstream, scenes: usgs } = scenes('scene-search', () => m2m({ results: [] }));

        const page = await usgs.search(KEY, { dataset: 'declassii', bounds: BOUNDS, maxResults: 10, to: '1980-12-31' });

        expect(page).toEqual({ records: [], totalHits: 0 });
        expect(acquisitionFilterOf(upstream.calls[0]?.body)).toEqual({
            start: '1950-01-01',
            end: '1980-12-31',
        });
    });

    it.each([
        ['an unreadable cloud cover', 'cloudy', null],
        ['a missing one', undefined, null],
    ])('badPath_aCloudCoverThatIsNotANumberIsNone_%s', async (_case, cloudCover, expected) => {
        const [first] = (fixtureBody('usgs/scene-search.two-scenes') as { data: { results: Record<string, unknown>[] } }).data.results;
        const { scenes: usgs } = scenes('scene-search', () => m2m({ results: [{ ...first, cloudCover }], totalHits: 1, nextRecord: 2 }));

        const page = await usgs.search(KEY, { dataset: 'corona2', bounds: BOUNDS, maxResults: 100 });

        expect(page.records[0]?.cloudCover).toBe(expected);
        expect(page.next).toBeUndefined();
    });

    it('badPath_theMaintenancePageIsMaintenance', async () => {
        const { scenes: usgs } = scenes('scene-search', () => fixtureResponse('usgs/maintenance.html-503'));

        await expect(usgs.search(KEY, { dataset: 'declassiii', bounds: BOUNDS, maxResults: 100 })).rejects.toMatchObject({
            service: 'usgs',
            failure: 'maintenance',
        });
    });
});

describe('downloadOptions', () => {
    it('happyPath_aScannedFrameIsAvailableWithItsSize', async () => {
        const available = (fixtureBody('usgs/download-options.available') as { data: unknown[] }).data;
        const orderOnly = (fixtureBody('usgs/download-options.order-only') as { data: unknown[] }).data;
        const { upstream, scenes: usgs } = scenes('download-options', () => m2m([...available, ...orderOnly]));

        const options = await usgs.downloadOptions(KEY, 'corona2', ['DS1105-1071DF075', 'DS1105-1071DF076', 'DS-UNKNOWN']);

        expect(options).toEqual([
            { entityId: 'DS1105-1071DF075', available: true, bytes: 734_003_200, datasetId: '5e839febdccb64b3' },
            { entityId: 'DS1105-1071DF076', available: false, bytes: 0, datasetId: '5e839febdccb64b3' },
            { entityId: 'DS-UNKNOWN', available: false, bytes: 0 },
        ]);
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({
            datasetName: 'corona2',
            entityIds: ['DS1105-1071DF075', 'DS1105-1071DF076', 'DS-UNKNOWN'],
        });
    });

    it('badPath_anAnswerThatIsNotAListOffersNothing', async () => {
        const { scenes: usgs } = scenes('download-options', () => jsonResponse({ data: null, errorCode: null }));

        await expect(usgs.downloadOptions(KEY, 'corona2', ['DS1'])).resolves.toEqual([{ entityId: 'DS1', available: false, bytes: 0 }]);
    });

    it('happyPath_aProductWithoutASizeCountsAsZero', async () => {
        const { scenes: usgs } = scenes('download-options', () => m2m([{ entityId: 'DS1', available: true }]));

        await expect(usgs.downloadOptions(KEY, 'corona2', ['DS1'])).resolves.toEqual([{ entityId: 'DS1', available: true, bytes: 0 }]);
    });
});

describe('datasets', () => {
    it('happyPath_eachDeclassifiedDatasetHasItsEarthExplorerId', async () => {
        const { upstream, scenes: usgs } = scenes('dataset-search', () => fixtureResponse('usgs/dataset-search.declass'));

        const datasets = await usgs.datasets(KEY);

        expect(datasets).toEqual([
            { alias: 'corona2', datasetId: '5e839febdccb64b3' },
            { alias: 'declassii', datasetId: '5e839ff7d71d4811' },
        ]);
        expect(upstream.calls[0]?.headers['x-auth-token']).toBe(KEY);
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({ datasetName: 'declass' });
    });

    it('badPath_anEntryWithoutItsAliasOrIdIsDropped', async () => {
        const { scenes: usgs } = scenes('dataset-search', () =>
            m2m([
                { datasetAlias: 'corona2' },
                { datasetId: '5e839ff7d71d4811' },
                { datasetAlias: 'declassiii', datasetId: 'abc123def4567890' },
            ]),
        );

        await expect(usgs.datasets(KEY)).resolves.toEqual([{ alias: 'declassiii', datasetId: 'abc123def4567890' }]);
    });

    it('badPath_theMaintenancePageIsMaintenance', async () => {
        const { scenes: usgs } = scenes('dataset-search', () => fixtureResponse('usgs/maintenance.html-503'));

        await expect(usgs.datasets(KEY)).rejects.toMatchObject({ service: 'usgs', failure: 'maintenance' });
    });
});
