/**
 * The Cloud Storage adapter against the Storage emulator through the real Admin SDK (`npm test` runs Vitest under
 * `firebase emulators:exec`, which sets FIREBASE_STORAGE_EMULATOR_HOST). Its own bucket names keep it apart from every
 * other test file. The emulator does not enforce `ifGenerationMatch`, so the conflict status is checked through the
 * error mapping, with the statuses Cloud Storage answers.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStorageBlobStore, storageFailure } from '../../src/adapters/storage.js';
import type { BlobStore } from '../../src/ports/blob-store.js';
import { UpstreamError } from '../../src/ports/errors.js';

const BUCKETS = { private: 'hcm-test-storage-private', public: 'hcm-test-storage-public' };

let app: App;
let blobs: BlobStore;

beforeAll(() => {
    if (!process.env['FIREBASE_STORAGE_EMULATOR_HOST']) {
        throw new Error('FIREBASE_STORAGE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-storage-adapter');
    blobs = createStorageBlobStore(getStorage(app), BUCKETS);
});

afterAll(async () => {
    await deleteApp(app);
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('createStorageBlobStore', () => {
    it('happyPath_writesStatsReadsAndDeletesAnObject', async () => {
        await blobs.write('public', 'photos/adapter/a1/12345678/web.webp', bytes('webp bytes'), {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
            ifGenerationMatch: 0,
            customMetadata: { writtenAt: '2026-10-12T08:30:00.000Z' },
        });

        const metadata = await blobs.stat('public', 'photos/adapter/a1/12345678/web.webp');
        expect(metadata).toMatchObject({ size: 10, contentType: 'image/webp', customMetadata: { writtenAt: '2026-10-12T08:30:00.000Z' } });
        expect(metadata?.generation).toMatch(/^\d+$/);
        expect(new TextDecoder().decode(await blobs.read('public', 'photos/adapter/a1/12345678/web.webp'))).toBe('webp bytes');

        await blobs.delete('public', 'photos/adapter/a1/12345678/web.webp');
        await expect(blobs.stat('public', 'photos/adapter/a1/12345678/web.webp')).resolves.toBeUndefined();
    });

    it('happyPath_aGzipManifestIsStoredAsGivenAndReadDecompressed', async () => {
        await blobs.write('public', 'cities/adapter/manifest.json', gzipSync('{"version":1}'), {
            contentType: 'application/json',
            contentEncoding: 'gzip',
            cacheControl: 'public, max-age=60',
        });

        const [metadata] = await getStorage(app).bucket(BUCKETS.public).file('cities/adapter/manifest.json').getMetadata();
        const [raw] = await getStorage(app).bucket(BUCKETS.public).file('cities/adapter/manifest.json').download({ decompress: false });

        expect([metadata.contentEncoding, metadata.cacheControl, gunzipSync(raw).toString()]).toEqual([
            'gzip',
            'public, max-age=60',
            '{"version":1}',
        ]);
        expect(new TextDecoder().decode(await blobs.read('public', 'cities/adapter/manifest.json'))).toBe('{"version":1}');
    });

    it('happyPath_copiesBetweenBucketsAndListsByPrefix', async () => {
        await blobs.write('private', 'uploads/photos/adapter/u1/p1/abcdefgh.jpg', bytes('jpeg'), {
            contentType: 'image/jpeg',
            customMetadata: { originalName: 'Calea Victoriei 1936.jpg' },
        });

        await blobs.copy(
            { bucket: 'private', path: 'uploads/photos/adapter/u1/p1/abcdefgh.jpg' },
            { bucket: 'private', path: 'originals/photos/adapter/p1/original.jpg' },
        );
        await blobs.copy(
            { bucket: 'private', path: 'uploads/photos/adapter/u1/p1/abcdefgh.jpg' },
            { bucket: 'public', path: 'listing/adapter/one.jpg' },
        );

        await expect(blobs.stat('private', 'originals/photos/adapter/p1/original.jpg')).resolves.toMatchObject({
            contentType: 'image/jpeg',
            customMetadata: { originalName: 'Calea Victoriei 1936.jpg' },
        });
        await expect(blobs.list('public', 'listing/adapter/')).resolves.toEqual(['listing/adapter/one.jpg']);
        await expect(blobs.list('public', 'listing/nothing-here/')).resolves.toEqual([]);
    });

    it('happyPath_aCopyCarriesTheCacheControlItIsGiven @S-A70-HAPPY-PUBLISH', async () => {
        const archive = new TextEncoder().encode('PMTiles');
        await blobs.write('private', 'rasters/m12/tiles.pmtiles', archive, { contentType: 'application/vnd.pmtiles' });

        const immutable = 'public, max-age=31536000, immutable';
        await blobs.copy(
            { bucket: 'private', path: 'rasters/m12/tiles.pmtiles' },
            { bucket: 'public', path: 'tiles/m12/v.pmtiles' },
            { cacheControl: immutable },
        );

        const [metadata] = await getStorage(app).bucket(BUCKETS.public).file('tiles/m12/v.pmtiles').getMetadata();
        expect(metadata.cacheControl).toBe(immutable);
        expect(metadata.contentType).toBe('application/vnd.pmtiles');
        await expect(blobs.read('public', 'tiles/m12/v.pmtiles')).resolves.toEqual(archive);
    });

    it('badPath_aMissingObjectIsNotFound', async () => {
        await expect(blobs.read('public', 'missing/object.webp')).rejects.toMatchObject({ failure: 'notFound', status: 404 });
        await expect(blobs.copy({ bucket: 'public', path: 'missing/a' }, { bucket: 'public', path: 'missing/b' })).rejects.toMatchObject({
            failure: 'notFound',
        });
        await expect(blobs.stat('private', 'missing/object.jpg')).resolves.toBeUndefined();
        await expect(blobs.delete('public', 'missing/object.webp')).resolves.toBeUndefined();
    });

    it('badPath_aStatThatFailsOtherwiseIsAnUpstreamError', async () => {
        const failing = createStorageBlobStore(
            {
                bucket: () => ({ file: () => ({ getMetadata: () => Promise.reject(Object.assign(new Error('boom'), { code: 503 })) }) }),
            } as unknown as Parameters<typeof createStorageBlobStore>[0],
            BUCKETS,
        );

        await expect(failing.stat('public', 'any')).rejects.toMatchObject({ failure: 'unavailable', status: 503 });
    });
});

describe('createStorageBlobStore: metadata', () => {
    function withMetadata(metadata: object) {
        return createStorageBlobStore(
            { bucket: () => ({ file: () => ({ getMetadata: () => Promise.resolve([metadata]) }) }) } as unknown as Parameters<
                typeof createStorageBlobStore
            >[0],
            BUCKETS,
        );
    }

    it('badPath_metadataWithoutItsFieldsGetsDefaults', async () => {
        await expect(withMetadata({}).stat('public', 'any')).resolves.toEqual({
            size: 0,
            contentType: 'application/octet-stream',
            generation: '',
            customMetadata: {},
        });
    });

    it('badPath_customMetadataThatIsNoTextIsLeftOut', async () => {
        await expect(
            withMetadata({ size: '12', generation: 7, metadata: { writtenAt: 'x', flag: true, empty: null } }).stat('public', 'any'),
        ).resolves.toEqual({
            size: 12,
            contentType: 'application/octet-stream',
            generation: '7',
            customMetadata: { writtenAt: 'x' },
        });
    });

    it('happyPath_theMd5CloudStorageRecordsIsSaid', async () => {
        await expect(withMetadata({ size: 3, generation: '9', md5Hash: 'q83vEjRWeJA=' }).stat('private', 'any')).resolves.toEqual({
            size: 3,
            contentType: 'application/octet-stream',
            generation: '9',
            customMetadata: {},
            md5Hash: 'q83vEjRWeJA=',
        });
    });
});

describe('storageFailure', () => {
    it.each([
        [400, 'invalid'],
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'notFound'],
        [409, 'conflict'],
        [412, 'conflict'],
        [429, 'rateLimited'],
        [500, 'unavailable'],
        [503, 'unavailable'],
    ] as const)('badPath_status_%s_is_%s', (status, failure) => {
        const error = storageFailure(Object.assign(new Error('Precondition Failed'), { code: status }));

        expect(error).toBeInstanceOf(UpstreamError);
        expect([error.service, error.failure, error.status, error.message]).toEqual([
            'cloud-storage',
            failure,
            status,
            `cloud-storage call failed: ${failure} (HTTP ${String(status)})`,
        ]);
    });

    it.each([
        ['a network error', new Error('ECONNRESET')],
        ['a string code', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
        ['a thrown value', 'boom'],
    ])('badPath_%s_isUnavailableWithoutAStatus', (_name, thrown) => {
        expect(storageFailure(thrown)).toMatchObject({ failure: 'unavailable', status: undefined });
    });
});
