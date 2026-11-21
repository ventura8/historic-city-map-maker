/**
 * The streaming object writer (`functions/src/adapters/storage-writer.ts`, M5 §5.3) against the Storage emulator through
 * the real Admin SDK: a stream of chunks becomes one object; a failing source rejects with its own error and leaves
 * nothing; a failing upload is an `UpstreamError` (a fake `Storage`, since the emulator accepts every upload).
 */
import { Writable } from 'node:stream';

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStorageBlobWriter } from '../../src/adapters/storage-writer.js';
import type { BlobWriter } from '../../src/ports/blob-writer.js';

const BUCKETS = { private: 'hcm-test-writer-private', public: 'hcm-test-writer-public' };

let app: App;
let storage: Storage;
let writer: BlobWriter;

beforeAll(() => {
    if (!process.env['FIREBASE_STORAGE_EMULATOR_HOST']) {
        throw new Error('FIREBASE_STORAGE_EMULATOR_HOST is not set: run `npm test` (Vitest under firebase emulators:exec)');
    }
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-storage-writer');
    storage = getStorage(app);
    writer = createStorageBlobWriter(storage, BUCKETS);
});

afterAll(async () => {
    await deleteApp(app);
});

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
    for (const part of parts) {
        yield await Promise.resolve(Buffer.from(part, 'utf8'));
    }
}

async function* breaking(): AsyncGenerator<Uint8Array> {
    yield await Promise.resolve(Buffer.from('PK'));
    throw new Error('the zip writer broke');
}

/** A source that fails with something other than an Error (a library's string, say). */
async function* breakingWithText(): AsyncGenerator<Uint8Array> {
    yield await Promise.resolve(Buffer.from('PK'));
    const thrown: unknown = 'the zip writer broke with a string';
    throw thrown;
}

describe('createStorageBlobWriter', () => {
    it('happyPath_theChunksBecomeOneObjectOfItsType', async () => {
        await writer.stream('private', 'exports/writer/x-1.zip', chunks('PK', '\u0003\u0004', 'rest'), { contentType: 'application/zip' });

        const file = storage.bucket(BUCKETS.private).file('exports/writer/x-1.zip');
        const [bytes] = await file.download();
        const [metadata] = await file.getMetadata();
        expect(bytes.toString('utf8')).toBe('PK\u0003\u0004rest');
        expect(metadata.contentType).toBe('application/zip');
    });

    it('badPath_aFailingSourceRejectsWithItsOwnErrorAndLeavesNoObject', async () => {
        await expect(writer.stream('private', 'exports/writer/x-2.zip', breaking(), { contentType: 'application/zip' })).rejects.toThrow(
            'the zip writer broke',
        );

        const [exists] = await storage.bucket(BUCKETS.private).file('exports/writer/x-2.zip').exists();
        expect(exists).toBe(false);
    });

    it('badPath_aSourceFailingWithoutAnErrorRejectsWithAnErrorOfItsTextAndLeavesNoObject', async () => {
        const writing = writer.stream('private', 'exports/writer/x-4.zip', breakingWithText(), { contentType: 'application/zip' });

        await expect(writing).rejects.toThrow(new Error('the zip writer broke with a string'));
        const [exists] = await storage.bucket(BUCKETS.private).file('exports/writer/x-4.zip').exists();
        expect(exists).toBe(false);
    });

    it('badPath_aFailedUploadIsACloudStorageFailure', async () => {
        const deleted: string[] = [];
        const refusing = {
            bucket: () => ({
                file: (path: string) => ({
                    createWriteStream: () =>
                        new Writable({
                            write: (_chunk, _encoding, done) => {
                                done(Object.assign(new Error('Service Unavailable'), { code: 503 }));
                            },
                        }),
                    delete: () => {
                        deleted.push(path);
                        return Promise.reject(new Error('not there'));
                    },
                }),
            }),
        } as unknown as Storage;

        await expect(
            createStorageBlobWriter(refusing, BUCKETS).stream('public', 'exports/writer/x-3.zip', chunks('PK'), {
                contentType: 'application/zip',
            }),
        ).rejects.toMatchObject({ service: 'cloud-storage', failure: 'unavailable', status: 503 });
        expect(deleted).toEqual(['exports/writer/x-3.zip']);
    });
});
