/**
 * The large-object reader (`functions/src/adapters/storage-reader.ts`) against the Storage emulator through the real
 * Admin SDK: an object streamed with its size and type (the publisher's COG), a byte range (the upload sniff), and a
 * missing object. Its own bucket names keep it apart from every other test file.
 */
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStorageBlobReader, objectFacts } from '../../src/adapters/storage-reader.js';
import type { BlobReader } from '../../src/ports/blob-reader.js';

const BUCKETS = { private: 'hcm-test-reader-private', public: 'hcm-test-reader-public' };
const PATH = 'rasters/reader/layer/v1/cog.tif';
const BYTES = new Uint8Array(Array.from({ length: 300 }, (_, index) => index % 251));

let app: App;
let reader: BlobReader;

beforeAll(async () => {
    if (!process.env['FIREBASE_STORAGE_EMULATOR_HOST']) {
        throw new Error('FIREBASE_STORAGE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-storage-reader');
    const storage = getStorage(app);
    reader = createStorageBlobReader(storage, BUCKETS);
    await storage.bucket(BUCKETS.private).file(PATH).save(Buffer.from(BYTES), { resumable: false, contentType: 'image/tiff' });
});

afterAll(async () => {
    await deleteApp(app);
});

async function drained(body: AsyncIterable<unknown>): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
        chunks.push(chunk as Buffer);
    }
    return new Uint8Array(Buffer.concat(chunks));
}

describe('createStorageBlobReader', () => {
    it('happyPath_openStreamsTheObjectWithItsSizeAndType', async () => {
        const opened = await reader.open('private', PATH);

        expect([opened.bytes, opened.contentType]).toEqual([300, 'image/tiff']);
        expect(await drained(opened.body)).toEqual(BYTES);
    });

    it('happyPath_rangeReadsTheFirstBytesAndStopsAtTheEnd', async () => {
        await expect(reader.range('private', PATH, 0, 4)).resolves.toEqual(BYTES.slice(0, 4));
        await expect(reader.range('private', PATH, 296, 400)).resolves.toEqual(BYTES.slice(296));
        await expect(reader.range('private', PATH, 10, 10)).resolves.toEqual(new Uint8Array(0));
    });

    it('badPath_aMissingObjectIsNotFound', async () => {
        await expect(reader.open('private', 'rasters/reader/gone.tif')).rejects.toMatchObject({
            service: 'cloud-storage',
            failure: 'notFound',
        });
        await expect(reader.range('private', 'rasters/reader/gone.tif', 0, 16)).rejects.toMatchObject({ failure: 'notFound' });
    });

    it('badPath_metadataWithoutSizeOrTypeReadsAsAnEmptyUntypedObject', () => {
        expect(objectFacts({})).toEqual({ bytes: 0, contentType: 'application/octet-stream' });
        expect(objectFacts({ size: '42', contentType: 'image/tiff' })).toEqual({ bytes: 42, contentType: 'image/tiff' });
    });
});
