/**
 * The `photos-onUpload` trigger through firebase-functions' `.run()` (a Storage finalize event as the runtime delivers
 * it, the size an int64 string) and its deploy options; the `photos` group as the integrator exports it.
 */
import type { StorageEvent } from 'firebase-functions/storage';
import { describe, expect, it, vi } from 'vitest';

import { photosFunctions } from '../../src/photos/index.js';
import { onUploadFunction } from '../../src/photos/on-upload.js';
import { contentDeps } from '../publish/fakes.js';
import { jpeg } from './images.js';
import { photo, seedPhoto, uploaded } from './world.js';

const BUCKET = 'demo-hcm.firebasestorage.app';

function finalized(name: string, size: string, metadata?: Record<string, string>, timeCreated?: string): StorageEvent {
    return {
        specversion: '1.0',
        id: 'event-1',
        source: `//storage.googleapis.com/projects/_/buckets/${BUCKET}`,
        type: 'google.cloud.storage.object.v1.finalized',
        time: '2026-10-12T08:30:00.000Z',
        bucket: BUCKET,
        data: {
            bucket: BUCKET,
            name,
            size: size as unknown as number,
            generation: 1,
            metageneration: 1,
            id: `${BUCKET}/${name}/1`,
            storageClass: 'STANDARD',
            ...(metadata === undefined ? {} : { metadata }),
            ...(timeCreated === undefined ? {} : { timeCreated }),
        },
    };
}

describe('photos-onUpload', () => {
    it('happyPath_aFinalizedUploadIsProcessed', async () => {
        const deps = contentDeps();
        await seedPhoto(deps, 'p1');
        const object = uploaded(deps, 'p1', await jpeg(20, 10), { name: 'Hanul lui Manuc.jpg' });

        await onUploadFunction(() => deps, BUCKET).run(finalized(object.name, String(object.size), object.metadata));

        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'done', suggested: { title: 'Hanul lui Manuc' } });
    });

    it('badPath_anEventWithoutCustomMetadataStillProcesses', async () => {
        const deps = contentDeps();
        await seedPhoto(deps, 'p1');
        const object = uploaded(deps, 'p1', await jpeg(20, 10));

        await onUploadFunction(() => deps, BUCKET).run(finalized(object.name, String(object.size)));

        expect((await photo(deps, 'p1'))?.processing).toBe('done');
    });

    it('badPath_anEventWithAnOlderTimeCreatedDoesNotOverwriteANewerUpload', async () => {
        const deps = contentDeps();
        await seedPhoto(deps, 'p1');
        const newer = uploaded(deps, 'p1', await jpeg(32, 24), { file: 'second-0002.jpg' });
        const older = uploaded(deps, 'p1', await jpeg(16, 12), { file: 'first-0001.jpg' });
        const trigger = onUploadFunction(() => deps, BUCKET);

        await trigger.run(finalized(newer.name, String(newer.size), newer.metadata, '2026-10-12T08:30:05.000Z'));
        await trigger.run(finalized(older.name, String(older.size), older.metadata, '2026-10-12T08:30:01.000Z'));

        expect((await photo(deps, 'p1'))?.image?.w).toBe(32);
    });

    it('happyPath_deploysOnThePrivateBucketWithOneGigabyteAndNoRetry', () => {
        const endpoint = onUploadFunction(() => contentDeps(), BUCKET).__endpoint;

        expect(endpoint).toMatchObject({
            availableMemoryMb: 1024,
            concurrency: 1,
            maxInstances: 5,
            timeoutSeconds: 300,
            eventTrigger: { eventFilters: { bucket: BUCKET }, retry: false },
        });
    });

    it('happyPath_withoutABucketItWatchesTheProjectsDefaultBucket', () => {
        vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-hcm', storageBucket: BUCKET }));

        expect(onUploadFunction(() => contentDeps()).__endpoint.eventTrigger?.eventFilters).toEqual({ bucket: BUCKET });
        vi.unstubAllEnvs();
    });

    it('happyPath_theGroupHasTheRegistryNames', () => {
        const group = photosFunctions(() => contentDeps(), BUCKET);

        expect(Object.keys(group).sort((a, b) => a.localeCompare(b))).toEqual(['onUpload', 'reprocess']);
    });
});
