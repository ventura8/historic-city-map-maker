/**
 * `worker.urls` (`functions/src/worker/{urls,usgs-proxy,allow-list}.ts`, `docs/research/M7-local-worker.md` §2.4, §2.5):
 * while its worker runs the job, a signed address per object of its version (a `PUT` bound to its content type) and its
 * inputs, with each object's metadata, valid `WORKER_URL_SECONDS`; or one M2M call of its `fetch` step made with the
 * server's USGS key. The delivery, the scratch, another version's files and another scene are never signed or called.
 */
import { WORKER_URL_SECONDS, type CallableResponse } from '@hcm/shared';
import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { urlsFunction } from '../../src/worker/urls.js';
import { failureOf } from '../admin/world.js';
import { renderedVersion, seedGuard, seedVersion } from '../imagery/world.js';
import { CITY, ENTITY, FOLDER, JOB, LAYER, NOW, WORKER, callAs, seedHeld, workerWorld, type WorkerWorld } from './world.js';

const EXPIRES = new Date(Date.parse(NOW) + WORKER_URL_SECONDS * 1000).toISOString();
const SCAN = `${FOLDER}/scan.tif`;
const PREVIEW = `${FOLDER}/scan-preview.jpg`;

type UrlsAnswer = CallableResponse<'worker.urls'>;

function urls(world: WorkerWorld, request: Record<string, unknown>): Promise<UrlsAnswer> {
    return callAs<UrlsAnswer>(world, urlsFunction, { workerId: WORKER, jobId: JOB, request });
}

function objects(world: WorkerWorld, list: readonly Record<string, unknown>[]): Promise<UrlsAnswer> {
    return urls(world, { kind: 'objects', objects: list });
}

function usgs(world: WorkerWorld, endpoint: string, payload: Record<string, unknown>): Promise<UrlsAnswer> {
    return urls(world, { kind: 'usgs', endpoint, payload });
}

async function held(job: Parameters<typeof seedHeld>[1] = {}): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedHeld(world, job);
    return world;
}

function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return failureOf(promise).then((failure) => (failure.details as { code?: unknown } | undefined)?.code);
}

describe('worker.urls objects of a join (M8)', () => {
    const BASE_SCAN = `rasters/${CITY}/layer-f039/im-f039/scan.tif`;
    const parts = [
        { versionId: 'rg-f039', layerId: 'layer-f039' },
        { versionId: 'im-f040', layerId: 'layer-f040' },
    ];

    async function joining(): Promise<WorkerWorld> {
        const world = await held({ type: 'layer-join', params: { parts, sensor: 'KH-9-pan' } });
        const scan = { path: BASE_SCAN, width: 10, height: 10, sha256: 'a'.repeat(64), previewPath: 'p', previewScale: 1 };
        await seedVersion(world, 'rg-f039', renderedVersion({ jobId: 'rg-f039', layerId: 'layer-f039', scan }));
        return world;
    }

    it('happyPath_aFrameWithNewPointsIsReadFromTheFolderItsScanLivesIn @S-A65-HAPPY-NEW-POINTS-SCAN', async () => {
        const world = await joining();
        world.deps.blobs.put('private', BASE_SCAN, new Uint8Array([1]), { contentType: 'image/tiff' });

        const answer = await objects(world, [{ path: BASE_SCAN, method: 'GET' }]);

        expect(answer.objects).toMatchObject([{ path: BASE_SCAN, method: 'GET', exists: true }]);
    });

    it('badPath_aFrameCanNotHaveItsBasesFolderWritten_norAnyOtherFileRead', async () => {
        const world = await joining();

        await expect(codeOf(objects(world, [{ path: BASE_SCAN, method: 'PUT', contentType: 'image/tiff' }]))).resolves.toBe(
            'apiError.worker.refused',
        );
        await expect(codeOf(objects(world, [{ path: `rasters/${CITY}/layer-f039/im-f039/cog.tif`, method: 'GET' }]))).resolves.toBe(
            'apiError.worker.refused',
        );
    });
});

describe('worker.urls objects', () => {
    it('happyPath_theVersionsFilesAreSignedForUploadAndItsInputsForDownload @S-A62-HAPPY-SIGNED-URLS', async () => {
        const world = await held();
        world.deps.blobs.put('private', PREVIEW, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });

        const answer = await objects(world, [
            { path: SCAN, method: 'PUT', contentType: 'image/tiff' },
            { path: PREVIEW, method: 'GET' },
        ]);

        expect(answer.objects).toEqual([
            {
                path: SCAN,
                url: expect.stringContaining(SCAN) as unknown,
                method: 'PUT',
                headers: { 'Content-Type': 'image/tiff' },
                expiresAt: EXPIRES,
                exists: false,
            },
            {
                path: PREVIEW,
                url: expect.stringContaining(PREVIEW) as unknown,
                method: 'GET',
                headers: {},
                expiresAt: EXPIRES,
                exists: true,
                size: 3,
                generation: expect.stringMatching(/^\d+$/) as unknown,
            },
        ]);
        expect(world.signer.signed.map(({ bucket, request }) => [bucket, request.method, request.expiresAt.toISOString()])).toEqual([
            ['private', 'PUT', EXPIRES],
            ['private', 'GET', EXPIRES],
        ]);
    });

    it('happyPath_theObjectsMD5AndGenerationAreSaidWhenCloudStorageHasThem', async () => {
        const world = await held();
        const blobs = {
            ...world.deps.blobs,
            stat: () =>
                Promise.resolve({ size: 9, contentType: 'image/tiff', generation: 'x', customMetadata: {}, md5Hash: 'q83vEjRWeJA=' }),
        };
        const changed: WorkerWorld = { ...world, deps: { ...world.deps, blobs } };

        const answer = await objects(changed, [{ path: SCAN, method: 'GET' }]);

        expect(answer.objects?.[0]).toMatchObject({ exists: true, size: 9, md5: 'q83vEjRWeJA=' });
        expect(answer.objects?.[0]).not.toHaveProperty('generation');
    });

    it.each([
        [
            'a re-georeference: its base version’s scan',
            { type: 'regeoref' as const, params: { basedOn: 'job-1965' } },
            `rasters/${CITY}/${LAYER}/job-1965/scan.tif`,
        ],
        [
            'a GeoTIFF import: its upload',
            {
                type: 'geotiff-import' as const,
                params: { uploadPath: `uploads/rasters/${CITY}/u-admin/${JOB}/abcdefgh.tif`, replaces: false },
            },
            `uploads/rasters/${CITY}/u-admin/${JOB}/abcdefgh.tif`,
        ],
    ])('happyPath_%sIsRead @S-A62-HAPPY-SIGNED-URLS', async (_name, job, path) => {
        const world = await held(job);

        await expect(objects(world, [{ path, method: 'GET' }])).resolves.toMatchObject({ objects: [{ path, method: 'GET' }] });
    });

    it.each([
        ['the USGS delivery', { path: `usgs-raw/corona2/${ENTITY}/${ENTITY}.tgz`, method: 'GET' }],
        ['the job’s scratch', { path: `work/${CITY}/${JOB}/frame.tif`, method: 'GET' }],
        ['the reference cache', { path: `reference/${CITY}/s2/0f3c9a2e.tif`, method: 'GET' }],
        ['another version’s file', { path: `rasters/${CITY}/${LAYER}/job-1965/cog.tif`, method: 'GET' }],
        ['a file in a folder of the version', { path: `${FOLDER}/old/cog.tif`, method: 'GET' }],
        ['an upload of a file that is not the version’s', { path: `${FOLDER}/notes.txt`, method: 'PUT', contentType: 'text/plain' }],
        ['an upload into another version', { path: `rasters/${CITY}/${LAYER}/job-1965/cog.tif`, method: 'PUT', contentType: 'image/tiff' }],
        ['an upload without its content type', { path: SCAN, method: 'PUT' }],
    ])('badPath_%sIsNeverSigned @S-A62-BAD-PATH-REFUSED', async (_name, object) => {
        const world = await held();

        await expect(codeOf(objects(world, [{ path: PREVIEW, method: 'GET' }, object]))).resolves.toBe('apiError.worker.refused');
        expect(world.signer.signed).toEqual([]);
    });

    it('badPath_moreThanTwentyObjectsAreAnInvalidRequest @S-A62-BAD-PATH-REFUSED', async () => {
        const world = await held();
        const many = Array.from({ length: 21 }, () => ({ path: PREVIEW, method: 'GET' }));

        await expect(codeOf(objects(world, many))).resolves.toBe('apiError.invalidRequest');
        expect(world.signer.signed).toEqual([]);
    });

    it.each([
        ['a job waiting for points', { status: 'awaiting_gcps' as const }, 'apiError.worker.refused'],
        [
            'another worker’s job',
            { worker: { id: 'w-fedcba9876543210', uid: 'u-other', claimedAt: { seconds: 1, nanoseconds: 0 } } },
            'apiError.worker.notHolder',
        ],
    ])('badPath_%sGetsNoAddress', async (_name, job, code) => {
        const world = await held(job);

        await expect(codeOf(objects(world, [{ path: PREVIEW, method: 'GET' }]))).resolves.toBe(code);
        expect(world.signer.signed).toEqual([]);
    });

    it('badPath_aJobWhoseVersionIsGoneGetsNoAddress', async () => {
        const world = await held();
        await world.deps.documents.delete(`cities/${CITY}/layerVersions/${JOB}`);

        await expect(codeOf(objects(world, [{ path: PREVIEW, method: 'GET' }]))).resolves.toBe('apiError.notFound');
    });

    it('badPath_nothingIsSignedWhileTheGuardIsRed', async () => {
        const world = await held();
        await seedGuard(world, 'red');

        await expect(codeOf(objects(world, [{ path: PREVIEW, method: 'GET' }]))).resolves.toBe('apiError.guardPaused');
        expect(world.signer.signed).toEqual([]);
    });
});

describe('worker.urls usgs', () => {
    it('happyPath_theJobsSceneOptionsAreAskedWithTheServersKey @S-A62-HAPPY-SIGNED-URLS', async () => {
        const world = await held();
        const data = [{ entityId: ENTITY, id: '5e83a1b2c3', available: true, filesize: 734003200 }];
        world.usgs.answers.set('download-options', data);

        await expect(usgs(world, 'download-options', { datasetName: 'corona2', entityIds: [ENTITY] })).resolves.toEqual({ usgs: data });
        expect(world.usgs.recorder.argsOf('login')).toEqual([[USGS_CREDENTIALS.approved.username]]);
        expect(world.usgs.recorder.argsOf('request')).toEqual([
            ['e2e-usgs-api-key-0001', 'download-options', { datasetName: 'corona2', entityIds: [ENTITY] }],
        ]);
        expect(world.usgs.sessions.size).toBe(0);
    });

    it.each([
        ['download-request', { downloads: [{ entityId: ENTITY, productId: '5e83a1b2c3' }], label: `hcm-${JOB}` }],
        ['download-retrieve', { label: `hcm-${JOB}` }],
        ['download-order-remove', { label: `hcm-${JOB}` }],
    ])('happyPath_%sOfTheJobsLabelIsCalled @S-A62-HAPPY-SIGNED-URLS', async (endpoint, payload) => {
        const world = await held();

        await expect(usgs(world, endpoint, payload)).resolves.toEqual({ usgs: null });
        expect(world.usgs.recorder.argsOf('request').map(([, called]) => called)).toEqual([endpoint]);
    });

    it.each([
        ['options of another scene', 'download-options', { datasetName: 'corona2', entityIds: ['DS1035-1057DA024'] }],
        ['options of another dataset', 'download-options', { datasetName: 'declassii', entityIds: [ENTITY] }],
        ['options of two scenes', 'download-options', { datasetName: 'corona2', entityIds: [ENTITY, 'DS1035-1057DA024'] }],
        [
            'a request under another label',
            'download-request',
            { downloads: [{ entityId: ENTITY, productId: '5e83a1b2c3' }], label: 'hcm-other' },
        ],
        [
            'a request of two downloads',
            'download-request',
            {
                downloads: [
                    { entityId: ENTITY, productId: 'a' },
                    { entityId: ENTITY, productId: 'b' },
                ],
                label: `hcm-${JOB}`,
            },
        ],
        ['a request without its product', 'download-request', { downloads: [{ entityId: ENTITY }], label: `hcm-${JOB}` }],
        [
            'a request of a malformed product',
            'download-request',
            { downloads: [{ entityId: ENTITY, productId: '../x' }], label: `hcm-${JOB}` },
        ],
        ['a request with no downloads list', 'download-request', { downloads: 'all', label: `hcm-${JOB}` }],
        ['a retrieval of another label', 'download-retrieve', { label: 'hcm-other' }],
        ['a payload with more in it', 'download-order-remove', { label: `hcm-${JOB}`, extra: true }],
    ])('badPath_%sIsRefusedAndNeverCalled @S-A62-BAD-PATH-REFUSED', async (_name, endpoint, payload) => {
        const world = await held();

        await expect(codeOf(usgs(world, endpoint, payload))).resolves.toBe('apiError.worker.refused');
        expect(world.usgs.recorder.calls).toEqual([]);
    });

    it('badPath_anEndpointOffTheListIsAnInvalidRequest @S-A62-BAD-PATH-REFUSED', async () => {
        const world = await held();

        await expect(codeOf(usgs(world, 'scene-search', {}))).resolves.toBe('apiError.invalidRequest');
        expect(world.usgs.recorder.calls).toEqual([]);
    });

    it('badPath_aJobThatIsNotAUsgsImportCallsNothing @S-A62-BAD-PATH-REFUSED', async () => {
        const world = await held({ type: 'regeoref', params: { basedOn: 'job-1965' } });

        await expect(codeOf(usgs(world, 'download-retrieve', { label: `hcm-${JOB}` }))).resolves.toBe('apiError.worker.refused');
        expect(world.usgs.recorder.calls).toEqual([]);
    });
});
