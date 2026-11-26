/**
 * The M3 upstreams of `createUpstreamFakes()` (docs/research/M3-interfaces.md §13): USGS's scenes over Bucharest, their
 * downloads and browse images, the Sentinel-2 STAC catalogue and its COG, Overpass, the MTS publish of a raster layer
 * with its tiles, the Cloud Run runner hook, and the server's imagery world.
 */
import { inflateSync } from 'node:zlib';

import { rasterRecipe } from '@hcm/shared';
import {
    createUpstreamFakes,
    GOOGLE_TOKENS,
    MAPBOX_TOKENS,
    publishedTileColour,
    SERVER_ONLY_HOSTS,
    STAC_VISUAL_PATH,
    upstreamHosts,
    USGS_CREDENTIALS,
    type PipelineExecution,
    type UpstreamFakes,
} from '@hcm/test-support/fakes';
import { createUpstreamExtension } from '@hcm/test-support/fakes/http';
import { describe, expect, it } from 'vitest';

const M2M = 'https://m2m.cr.usgs.gov/api/api/json/stable';
const TILESETS = 'https://api.mapbox.com/tilesets/v1';
const RUN = 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs';
/** The e2e city's bounds (e2e/admin/specs/settings/world.ts). */
const CITY = { lowerLeft: { latitude: 44.3, longitude: 25.9 }, upperRight: { latitude: 44.6, longitude: 26.3 } };

interface Answer {
    readonly status: number;
    readonly headers: Headers;
    readonly body: unknown;
    readonly bytes: Uint8Array;
}

async function call(
    fakes: UpstreamFakes,
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<Answer> {
    const response = await fakes.fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const json = response.headers.get('content-type')?.includes('json') === true && text !== '' ? (JSON.parse(text) as unknown) : undefined;
    return { status: response.status, headers: response.headers, body: json ?? text, bytes };
}

/** A logged-in M2M call of the approved account. */
async function m2m(fakes: UpstreamFakes): Promise<(endpoint: string, body: unknown) => Promise<Answer>> {
    const login = await call(fakes, 'POST', `${M2M}/login-token`, {
        username: USGS_CREDENTIALS.approved.username,
        token: USGS_CREDENTIALS.approved.applicationToken,
    });
    const apiKey = (login.body as { data: string }).data;
    return (endpoint, body) => call(fakes, 'POST', `${M2M}/${endpoint}`, body, { 'X-Auth-Token': apiKey });
}

interface SearchData {
    readonly results: { entityId: string; metadata: { fieldName: string; value: string }[] }[];
    readonly totalHits: number;
    readonly recordsReturned: number;
    readonly nextRecord: number;
}

/** The `data` of an M2M envelope. */
const dataOf = (answer: Answer): unknown => (answer.body as { data: unknown }).data;

describe('USGS scenes over Bucharest', () => {
    it('happyPath_theThreeDatasetsListTheTargetFramesWithFullMetadata', async () => {
        const keyed = await m2m(createUpstreamFakes());
        const search = (dataset: string, extra: Record<string, unknown> = {}) =>
            keyed('scene-search', { datasetName: dataset, sceneFilter: { spatialFilter: { filterType: 'mbr', ...CITY } }, ...extra });

        const corona = dataOf(await search('corona2', { metadataType: 'full' })) as SearchData;
        const declassii = dataOf(await search('declassii', { metadataType: 'full' })) as SearchData;
        const declassiii = dataOf(await search('declassiii', { metadataType: 'full' })) as SearchData;
        const summary = dataOf(await search('corona2')) as SearchData;

        expect(corona.results.map((scene) => scene.entityId)).toEqual(['DS1035-1057DA023', 'DS1105-1071DF075', 'DS1105-1071DF076']);
        expect(declassii.results.map((scene) => scene.entityId)).toEqual([
            'DZB1211-500043L007001',
            'DZB1213-500159L010001',
            'DZB1214-500094L005001',
        ]);
        expect([declassiii.totalHits, declassiii.results[0]?.entityId]).toEqual([2, 'D3C1216-200467A021']);
        const fields = Object.fromEntries((corona.results[0]?.metadata ?? []).map((field) => [field.fieldName, field.value]));
        expect(fields).toMatchObject({ 'Camera Type': 'KH-4A', 'NW Corner Lat dec': '44.630000', 'SE Corner Long dec': '26.268000' });
        expect(corona.results[2]?.metadata.map((field) => field.fieldName)).not.toContain('NW Corner Lat dec');
        expect(summary.results[0]?.metadata).toEqual([]);
    });

    it('happyPath_theSearchFiltersByWindowAndPlaceAndPages', async () => {
        const keyed = await m2m(createUpstreamFakes());

        const window = dataOf(
            await keyed('scene-search', {
                datasetName: 'declassii',
                sceneFilter: { acquisitionFilter: { start: '1976-01-01', end: '1977-12-31' } },
            }),
        ) as SearchData;
        const second = dataOf(await keyed('scene-search', { datasetName: 'declassii', maxResults: 1, startingNumber: 2 })) as SearchData;
        const paris = dataOf(
            await keyed('scene-search', {
                datasetName: 'corona2',
                sceneFilter: {
                    spatialFilter: {
                        filterType: 'mbr',
                        lowerLeft: { latitude: 48.8, longitude: 2.2 },
                        upperRight: { latitude: 48.9, longitude: 2.4 },
                    },
                },
            }),
        ) as SearchData;

        expect(window.results.map((scene) => scene.entityId)).toEqual(['DZB1211-500043L007001', 'DZB1213-500159L010001']);
        expect(second).toMatchObject({ totalHits: 3, recordsReturned: 1, nextRecord: 3, results: [{ entityId: 'DZB1213-500159L010001' }] });
        expect(paris.totalHits).toBe(0);
    });

    it('badPath_noScenesAndADatasetThatFailsWhileTheOthersAnswer', async () => {
        const fakes = createUpstreamFakes();
        const keyed = await m2m(fakes);
        fakes.scenario('usgs.declassiiiUnavailable');

        const failed = await keyed('scene-search', { datasetName: 'declassiii' });
        const answered = dataOf(await keyed('scene-search', { datasetName: 'corona2' })) as SearchData;
        fakes.scenario('usgs.noScenes');
        const none = dataOf(await keyed('scene-search', { datasetName: 'corona2' })) as SearchData;

        expect([failed.status, failed.body]).toEqual([502, expect.stringContaining('Bad Gateway')]);
        expect([answered.totalHits, none.totalHits]).toEqual([3, 0]);
    });
});

describe('USGS downloads', () => {
    const SCENE = 'DS1035-1057DA023';
    const FILE = Uint8Array.from({ length: 1000 }, (_unused, index) => index % 251);

    it('happyPath_aPreparedDownloadArrivesSignedAndReadsWithRanges', async () => {
        const fakes = createUpstreamFakes();
        const keyed = await m2m(fakes);
        fakes.scenario('usgs.downloadsPreparing');
        fakes.state.usgs.deliveries.set(SCENE, () => FILE);

        const options = dataOf(await keyed('download-options', { datasetName: 'corona2', entityIds: [SCENE] })) as {
            available: boolean;
            filesize: number;
            productName: string;
        }[];
        const requested = dataOf(await keyed('download-request', { downloads: [{ entityId: SCENE }], label: 'hcm-job-1' })) as {
            preparingDownloads: { downloadId: number }[];
        };
        const preparing = dataOf(await keyed('download-retrieve', { label: 'hcm-job-1' })) as { requested: { statusCode: string }[] };
        const ready = dataOf(await keyed('download-retrieve', { label: 'hcm-job-1' })) as { available: { url: string }[] };
        const url = String(ready.available[0]?.url);
        const ranged = await call(fakes, 'GET', url, undefined, { range: 'bytes=10-19' });
        const head = await call(fakes, 'HEAD', url);
        const again = dataOf(await keyed('download-request', { downloads: [{ entityId: SCENE }], label: 'hcm-job-1' })) as {
            availableDownloads: { downloadId: number }[];
        };
        await keyed('download-order-remove', { label: 'hcm-job-1' });
        const removed = dataOf(await keyed('download-retrieve', { label: 'hcm-job-1' })) as { available: unknown[] };

        expect(options).toEqual([expect.objectContaining({ available: true, filesize: 1000, productName: 'Declass 1 Product' })]);
        expect(requested.preparingDownloads).toEqual([{ downloadId: 300000001, eulaCode: null, url: null }]);
        expect(preparing.requested).toEqual([expect.objectContaining({ statusCode: 'P', entityId: SCENE })]);
        expect(url).toMatch(/^https:\/\/dds\.cr\.usgs\.gov\/e2e\/download\/300000001\?sig=e2e-sig-\d{4}&expires=\d+$/);
        expect([ranged.status, ranged.headers.get('content-range'), [...ranged.bytes]]).toEqual([
            206,
            'bytes 10-19/1000',
            [...FILE.slice(10, 20)],
        ]);
        expect([head.status, head.headers.get('content-length'), head.headers.get('accept-ranges')]).toEqual([200, '1000', 'bytes']);
        expect(again.availableDownloads[0]?.downloadId).toBe(300000001);
        expect(removed.available).toEqual([]);
    });

    it('badPath_anExpiredSignatureAShortFileACorruptArchiveNoRangesAndAnUnscannedScene', async () => {
        const fakes = createUpstreamFakes();
        const keyed = await m2m(fakes);
        fakes.state.usgs.deliveries.set(SCENE, () => FILE);
        fakes.scenario('usgs.signedUrlExpiresOnce');
        const first = dataOf(
            await keyed('download-request', { downloads: [{ entityId: SCENE }, { entityId: 'DS1105-1071DF076' }], label: 'job' }),
        ) as { availableDownloads: { url: string }[]; failed: { entityId: string }[] };
        const expired = await call(fakes, 'GET', String(first.availableDownloads[0]?.url));
        const fresh = String(
            (dataOf(await keyed('download-retrieve', { label: 'job' })) as { available: { url: string }[] }).available[0]?.url,
        );
        fakes.scenario('usgs.shortDelivery');
        const short = await call(fakes, 'GET', fresh);
        fakes.state.usgs.delivery.truncated = false;
        fakes.scenario('usgs.corruptArchive');
        const corrupt = await call(fakes, 'GET', fresh);
        fakes.state.usgs.delivery.corrupt = false;
        fakes.scenario('usgs.deliveryWithoutRanges');
        const whole = await call(fakes, 'GET', fresh, undefined, { range: 'bytes=10-19' });

        expect([expired.status, expired.body]).toEqual([403, expect.stringContaining('Request has expired')]);
        expect(first.failed).toEqual([expect.objectContaining({ entityId: 'DS1105-1071DF076' })]);
        expect(short.bytes.length).toBeLessThan(FILE.length);
        expect(new Set(corrupt.bytes)).toEqual(new Set([0xab]));
        expect([whole.status, whole.bytes.length, whole.headers.get('accept-ranges')]).toEqual([200, 1000, null]);
        expect((await call(fakes, 'GET', 'https://dds.cr.usgs.gov/e2e/download/300000001')).status).toBe(403);
    });

    it('happyPath_theSignedAddressesCanPointAtALoopbackForward', async () => {
        const fakes = createUpstreamFakes();
        const keyed = await m2m(fakes);
        fakes.state.usgs.deliveries.set(SCENE, () => FILE);
        // The e2e mock APIs forward the delivery host on loopback, so the pipeline under the emulators stays on the machine.
        fakes.state.usgs.delivery.origin = 'http://127.0.0.1:4311/h/dds.cr.usgs.gov';
        const ready = dataOf(await keyed('download-request', { downloads: [{ entityId: SCENE }], label: 'hcm-job-2' })) as {
            availableDownloads: { url: string }[];
        };
        const url = String(ready.availableDownloads[0]?.url);
        const canonical = url.replace('http://127.0.0.1:4311/h/dds.cr.usgs.gov', 'https://dds.cr.usgs.gov');

        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4311\/h\/dds\.cr\.usgs\.gov\/e2e\/download\/300000001\?sig=e2e-sig-\d{4}&expires=\d+$/);
        expect((await call(fakes, 'GET', canonical)).bytes).toEqual(FILE);
    });

    it('badPath_aSearchOnlyAccountCannotRequestADownload', async () => {
        const fakes = createUpstreamFakes();
        const login = await call(fakes, 'POST', `${M2M}/login-token`, {
            username: USGS_CREDENTIALS.pending.username,
            token: USGS_CREDENTIALS.pending.applicationToken,
        });
        const apiKey = (login.body as { data: string }).data;

        const refused = await call(
            fakes,
            'POST',
            `${M2M}/download-request`,
            { downloads: [{ entityId: SCENE }] },
            { 'X-Auth-Token': apiKey },
        );

        expect(refused).toMatchObject({ status: 500, body: { errorCode: 'AUTH_UNAUTHROIZED' } });
    });
});

describe('USGS browse images', () => {
    it('happyPath_aSceneBrowseAndThumbnailAreJpegs', async () => {
        const fakes = createUpstreamFakes();

        const browse = await call(fakes, 'GET', 'https://ims.cr.usgs.gov/browse/declass1/DS1035-1057DA023.jpg');
        const thumbnail = await call(fakes, 'GET', 'https://ims.cr.usgs.gov/thumbnail/declass2/DZB1211-500043L007001.jpg');

        expect([browse.status, browse.headers.get('content-type'), [...browse.bytes.slice(0, 3)]]).toEqual([
            200,
            'image/jpeg',
            [0xff, 0xd8, 0xff],
        ]);
        expect(thumbnail.bytes).toEqual(browse.bytes);
    });

    it('badPath_thePaidTwinAnUnknownSceneAndAFailingServer', async () => {
        const fakes = createUpstreamFakes();

        const twin = await call(fakes, 'GET', 'https://ims.cr.usgs.gov/browse/declass1/DS1105-1071DF076.jpg');
        const unknown = await call(fakes, 'GET', 'https://ims.cr.usgs.gov/browse/declass1/DS0000-0000XX000.jpg');
        fakes.fail('usgs-browse', 'unavailable');
        const failing = await call(fakes, 'GET', 'https://ims.cr.usgs.gov/browse/declass1/DS1035-1057DA023.jpg');
        const login = await call(fakes, 'POST', `${M2M}/login-token`, {
            username: USGS_CREDENTIALS.approved.username,
            token: USGS_CREDENTIALS.approved.applicationToken,
        });

        expect([twin.status, unknown.status, failing.status, login.status]).toEqual([503, 404, 503, 200]);
        expect(() => {
            fakes.fail('usgs-browse', 'maintenance');
        }).toThrow('usgs-browse has no failure mode maintenance');
    });
});

describe('Sentinel-2 STAC and Overpass', () => {
    const SEARCH = 'https://earth-search.aws.element84.com/v1/search';
    const COG = new Uint8Array(4096).fill(7);

    it('happyPath_oneItemWhoseVisualCogReadsWithRanges', async () => {
        const fakes = createUpstreamFakes();
        fakes.state.stac.cog = () => COG;

        const found = (await call(fakes, 'POST', SEARCH, { collections: ['sentinel-2-l2a'] })).body as {
            features: { id: string; assets: { visual: { href: string } } }[];
        };
        const href = String(found.features[0]?.assets.visual.href);
        const window = await call(fakes, 'GET', href, undefined, { range: 'bytes=0-1023' });
        const head = await call(fakes, 'HEAD', href);
        fakes.state.stac.cogOrigin = 'http://127.0.0.1:4311/h/sentinel-cogs.s3.us-west-2.amazonaws.com';
        const forwarded = (await call(fakes, 'GET', `${SEARCH}?collections=sentinel-2-l2a`)).body as {
            features: { assets: { visual: { href: string } } }[];
        };

        expect(found.features.map((feature) => feature.id)).toEqual(['S2B_35TMK_20250803_0_L2A']);
        expect(href).toBe(`https://sentinel-cogs.s3.us-west-2.amazonaws.com${STAC_VISUAL_PATH}`);
        expect([window.status, window.bytes.length, window.headers.get('content-range')]).toEqual([206, 1024, 'bytes 0-1023/4096']);
        expect(head.headers.get('content-length')).toBe('4096');
        expect(forwarded.features[0]?.assets.visual.href).toBe(
            `http://127.0.0.1:4311/h/sentinel-cogs.s3.us-west-2.amazonaws.com${STAC_VISUAL_PATH}`,
        );
    });

    it('badPath_noItemNoCogAndADownCatalogue', async () => {
        const fakes = createUpstreamFakes();

        const missing = await call(fakes, 'GET', `https://sentinel-cogs.s3.us-west-2.amazonaws.com${STAC_VISUAL_PATH}`);
        fakes.scenario('stac.empty');
        const empty = (await call(fakes, 'POST', SEARCH, {})).body as { features: unknown[] };
        fakes.fail('stac', 'unavailable');
        const down = await call(fakes, 'POST', SEARCH, {});

        expect([missing.status, empty.features, down.status]).toEqual([404, [], 503]);
    });

    it('happyPath_overpassAnswersTheLinesOfTheWindow', async () => {
        const fakes = createUpstreamFakes();

        const fixture = (await call(fakes, 'POST', 'https://overpass-api.de/api/interpreter', 'data=[out:json];')).body as {
            elements: { tags: Record<string, string> }[];
        };
        fakes.state.overpass.answer = () => ({ elements: [{ type: 'way', id: 1 }] });
        const synthetic = await call(fakes, 'GET', 'https://overpass-api.de/api/interpreter?data=x');

        expect(fixture.elements.map((element) => Object.keys(element.tags)[0])).toEqual(
            expect.arrayContaining(['highway', 'waterway', 'railway', 'natural']),
        );
        expect(synthetic.body).toEqual({ elements: [{ type: 'way', id: 1 }] });
    });

    it('badPath_overpassRateLimitedAndOverloaded', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('overpass', 'rateLimited');
        const limited = await call(fakes, 'POST', 'https://overpass-api.de/api/interpreter', '');
        fakes.fail('overpass', 'unavailable');
        const overloaded = await call(fakes, 'POST', 'https://overpass-api.de/api/interpreter', '');

        expect([limited.status, limited.headers.get('retry-after'), overloaded.status]).toEqual([429, '30', 504]);
    });
});

/** The first pixel of a truecolour PNG (one IDAT, filter 0). */
function firstPixel(png: Uint8Array): number[] {
    const view = new DataView(png.buffer, png.byteOffset);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    return [...raw.subarray(1, 4)];
}

describe('Mapbox MTS: a raster layer', () => {
    const auth = `access_token=${MAPBOX_TOKENS.tiles}`;
    const TILESET = 'e2e-mapbox.hcm-bucharest-kh-4a-1966';

    async function publish(fakes: UpstreamFakes): Promise<string> {
        const job = (await call(fakes, 'POST', `${TILESETS}/${TILESET}/publish?${auth}`, {})).body as { jobId: string };
        let stage = '';
        for (let poll = 0; poll < 3; poll += 1) {
            stage = ((await call(fakes, 'GET', `${TILESETS}/${TILESET}/jobs/${job.jobId}?${auth}`)).body as { stage: string }).stage;
        }
        return stage;
    }

    it('happyPath_aRasterRecipePublishesTilesOfTheTilesetsColour', async () => {
        const fakes = createUpstreamFakes();

        const uploaded = await call(fakes, 'POST', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`, 'COG');
        const source = await call(fakes, 'GET', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`);
        const recipe = rasterRecipe('e2e-mapbox', 'hcm-bucharest-kh-4a-1966', 10, 16);
        const created = await call(fakes, 'POST', `${TILESETS}/${TILESET}?${auth}`, { name: 'hcm-bucharest-kh-4a-1966', recipe });
        const updated = await call(fakes, 'PATCH', `${TILESETS}/${TILESET}/recipe?${auth}`, { ...recipe, maxzoom: 15 });
        const unpublished = await call(fakes, 'GET', `https://api.mapbox.com/v4/${TILESET}.json?access_token=pk.e2e-fake-token`);
        const stage = await publish(fakes);
        const tileJson = await call(fakes, 'GET', `https://api.mapbox.com/v4/${TILESET}.json?secure&access_token=pk.e2e-fake-token`);
        const tile = await call(fakes, 'GET', `https://api.mapbox.com/v4/${TILESET}/12/2340/1489.png?access_token=pk.e2e-fake-token`);
        const retina = await call(fakes, 'GET', `https://api.mapbox.com/v4/${TILESET}/12/2340/1489@2x.webp?access_token=pk.e2e-fake-token`);
        const outside = await call(fakes, 'GET', `https://api.mapbox.com/v4/${TILESET}/16/1/1.png?access_token=pk.e2e-fake-token`);

        expect([uploaded.status, source.body]).toEqual([200, expect.objectContaining({ files: 1, size: 5 })]);
        expect([created.status, updated.status, unpublished.status, stage]).toEqual([200, 204, 404, 'success']);
        expect(tileJson.body).toMatchObject({
            id: TILESET,
            minzoom: 10,
            maxzoom: 15,
            tiles: [`https://api.mapbox.com/v4/${TILESET}/{z}/{x}/{y}.png`],
        });
        expect([tile.headers.get('content-type'), firstPixel(tile.bytes)]).toEqual(['image/png', [...publishedTileColour(TILESET)]]);
        expect(new DataView(retina.bytes.buffer, retina.bytes.byteOffset).getUint32(16)).toBe(512);
        expect(outside.status).toBe(404);
        expect(fakes.snapshot()['mapbox']).toMatchObject({
            accounts: { 'e2e-mapbox': { published: { [TILESET]: { minzoom: 10, maxzoom: 15 } } } },
        });
    });

    it('badPath_aRefusedRecipeAnInternalFailureOnceAndADeletedSource', async () => {
        const fakes = createUpstreamFakes();
        const recipe = rasterRecipe('e2e-mapbox', 'hcm-bucharest-kh-4a-1966', 10, 16);

        const noSource = await call(fakes, 'POST', `${TILESETS}/${TILESET}?${auth}`, { name: 'x', recipe });
        await call(fakes, 'POST', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`, 'COG');
        await call(fakes, 'POST', `${TILESETS}/${TILESET}?${auth}`, { name: 'x', recipe });
        const crossed = await call(fakes, 'PATCH', `${TILESETS}/${TILESET}/recipe?${auth}`, { ...recipe, minzoom: 17 });
        const missing = await call(fakes, 'PATCH', `${TILESETS}/e2e-mapbox.missing/recipe?${auth}`, recipe);
        fakes.scenario('mapbox.internalFailureOnce');
        const failedOnce = await publish(fakes);
        const failedJob = fakes.state.mapbox.accounts.get('e2e-mapbox')?.jobs.get('cle2e00job0000000000000001');
        const succeeded = await publish(fakes);
        const deleted = await call(fakes, 'DELETE', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`);
        const gone = await call(fakes, 'GET', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`);
        const again = await call(fakes, 'DELETE', `${TILESETS}/sources/e2e-mapbox/hcm-bucharest-kh-4a-1966?${auth}`);

        expect(noSource).toMatchObject({
            status: 400,
            body: { errors: ['sources[0].uri must name an existing tileset source of the account'] },
        });
        expect(crossed).toMatchObject({ status: 400, body: { errors: ['minzoom and maxzoom must be zooms 0-22, minzoom first'] } });
        expect(missing.status).toBe(404);
        expect([failedOnce, failedJob?.outcome, succeeded]).toEqual(['failed', 'failed-internal', 'success']);
        expect([deleted.status, gone.status, again.status]).toEqual([204, 404, 404]);
    });

    it('badPath_anInternalFailureSaysToPublishAgain', async () => {
        const fakes = createUpstreamFakes();
        fakes.state.mapbox.jobOutcome = 'failed-internal';
        await call(fakes, 'POST', `${TILESETS}/${TILESET}?${auth}`, { name: 'x', recipe: { version: 1 } });
        const job = (await call(fakes, 'POST', `${TILESETS}/${TILESET}/publish?${auth}`, {})).body as { jobId: string };
        await call(fakes, 'GET', `${TILESETS}/${TILESET}/jobs/${job.jobId}?${auth}`);
        await call(fakes, 'GET', `${TILESETS}/${TILESET}/jobs/${job.jobId}?${auth}`);

        const failed = await call(fakes, 'GET', `${TILESETS}/${TILESET}/jobs/${job.jobId}?${auth}`);

        expect(failed.body).toMatchObject({ stage: 'failed', errors: [expect.stringContaining('publish the tileset again')] });
    });
});

describe('Cloud Run: the pipeline runner', () => {
    const run = (fakes: UpstreamFakes, job: string, env: Record<string, string>) =>
        call(
            fakes,
            'POST',
            `${RUN}/${job}:run`,
            {
                overrides: {
                    containerOverrides: [{ env: Object.entries(env).map(([name, value]) => ({ name, value })), args: ['run'] }],
                    taskCount: 1,
                },
            },
            { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
        );
    const get = (fakes: UpstreamFakes, name: string) =>
        call(fakes, 'GET', `https://run.googleapis.com/v2/${name}`, undefined, { authorization: `Bearer ${GOOGLE_TOKENS.owner}` });

    it('happyPath_aRunIsHandedToTheRunnerWhichEndsIt', async () => {
        const fakes = createUpstreamFakes();
        const runs: PipelineExecution[] = [];
        fakes.state.cloudRun.runner = { start: (execution) => runs.push(execution) };
        fakes.scenario('cloud-run.pipelineJobsProvisioned');

        const started = await run(fakes, 'raster-pipeline', { JOB_ID: 'job-1', CITY_ID: 'bucharest' });
        const [execution] = runs;
        const running = await get(fakes, String(execution?.name));
        execution?.finish('succeeded');
        execution?.finish('failed');
        const done = await get(fakes, String(execution?.name));

        expect(started.body).toMatchObject({ metadata: { name: execution?.name }, done: false });
        expect(execution).toMatchObject({
            job: 'raster-pipeline',
            id: 'raster-pipeline-e2e01',
            env: { JOB_ID: 'job-1', CITY_ID: 'bucharest' },
            args: ['run'],
        });
        expect([running.body, done.body]).toEqual([
            expect.objectContaining({ runningCount: 1 }),
            expect.objectContaining({ succeededCount: 1 }),
        ]);
    });

    it('badPath_cancelIsTheRunnersSigtermAndOutOfMemoryIsExit137', async () => {
        const fakes = createUpstreamFakes();
        const runs: PipelineExecution[] = [];
        const sigterms: string[] = [];
        fakes.state.cloudRun.runner = { start: (execution) => runs.push(execution) };
        fakes.scenario('cloud-run.pipelineJobsProvisioned');
        await run(fakes, 'raster-pipeline', { JOB_ID: 'job-1' });
        await run(fakes, 'raster-pipeline-xl', { JOB_ID: 'job-2' });
        const [cancelled, killed] = runs;
        cancelled?.onCancel(() => sigterms.push(cancelled.name));

        await call(
            fakes,
            'POST',
            `https://run.googleapis.com/v2/${String(cancelled?.name)}:cancel`,
            {},
            { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
        );
        const stopping = await get(fakes, String(cancelled?.name));
        cancelled?.finish('cancelled');
        killed?.finish('failed', 'oom');

        expect([sigterms, cancelled?.cancelRequested, stopping.body]).toEqual([
            [cancelled?.name],
            true,
            expect.objectContaining({ runningCount: 1 }),
        ]);
        expect((await get(fakes, String(cancelled?.name))).body).toMatchObject({ cancelledCount: 1 });
        expect((await get(fakes, String(killed?.name))).body).toMatchObject({
            failedCount: 1,
            conditions: [{ message: expect.stringContaining('exit code 137') as unknown }],
        });
    });

    it('badPath_withoutARunnerAScenarioEndsTheExecutionsOutOfMemory', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('cloud-run.pipelineJobsProvisioned');
        const started = (await run(fakes, 'raster-pipeline', { JOB_ID: 'job-1' })).body as { metadata: { name: string } };

        fakes.scenario('cloud-run.executionsOutOfMemory');

        expect((await get(fakes, started.metadata.name)).body).toMatchObject({
            conditions: [{ message: expect.stringContaining('Memory limit') as unknown }],
        });
    });
});

describe('the imagery world', () => {
    it('happyPath_theImageryReadyPresetHoldsTheSecretsAndTheThreePipelineJobs', () => {
        const fakes = createUpstreamFakes();

        fakes.scenario('imagery.ready');

        expect([fakes.secretValue('usgs-username'), fakes.secretValue('usgs-app-token'), fakes.secretValue('mapbox-sk-tiles')]).toEqual([
            USGS_CREDENTIALS.approved.username,
            USGS_CREDENTIALS.approved.applicationToken,
            MAPBOX_TOKENS.tiles,
        ]);
        expect(fakes.snapshot()['cloud-run']).toMatchObject({
            jobs: ['demo-hcm/us-central1/raster-fetch', 'demo-hcm/us-central1/raster-pipeline', 'demo-hcm/us-central1/raster-pipeline-xl'],
        });
    });

    it('badPath_theServerOnlyHostsAreFakedButNotForTheBrowser', () => {
        expect(upstreamHosts()).toEqual(expect.arrayContaining([...SERVER_ONLY_HOSTS]));
        expect(SERVER_ONLY_HOSTS).not.toContain('api.mapbox.com');
    });

    it('happyPath_aHeadAnswerKeepsItsLengthThroughTheHttpExtension', async () => {
        const extension = createUpstreamExtension();
        extension.partitions.get('t1').state.stac.cog = () => new Uint8Array(77);

        const head = await extension.answer({
            method: 'HEAD',
            host: 'sentinel-cogs.s3.us-west-2.amazonaws.com',
            path: STAC_VISUAL_PATH,
            search: '',
            headers: {},
            body: '',
            test: 't1',
        });

        expect([head?.status, head?.headers?.['content-length'], head?.type]).toEqual([200, '77', 'image/tiff']);
    });
});
