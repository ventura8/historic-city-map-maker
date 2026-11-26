/**
 * `publish.buildManifest`: the serialized build with the in-memory documents and buckets. What the public bucket gets
 * (gzip JSON the engine validates, 60-second cache), what `manifests/{city}` records, the race guard, the size
 * warning, and every failure: recorded for the admin, retried by Cloud Tasks only when it is transient.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
    FIRESTORE_PATHS,
    MANIFEST_SPLIT_BYTES,
    STORAGE_PATHS,
    manifestStateDocSchema,
    photoDocSchema,
    timestampFromDate,
    validateManifest,
    type ManifestStateDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { buildManifest, buildManifestFunction } from '../../src/publish/build-manifest.js';
import { CITY_ID, photoDoc, seedCity } from './city.js';
import { contentDeps, publicUrl, type ContentDeps } from './fakes.js';

const NOW = '2026-10-12T08:31:00.000Z';
const MANIFEST = STORAGE_PATHS.manifest(CITY_ID);
const TASK = { cityId: CITY_ID, requestedVersion: 1, full: false } as const;
const EARLIER = timestampFromDate(new Date('2026-10-11T08:00:00.000Z'));

async function state(deps: ContentDeps): Promise<ManifestStateDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema);
}

function served(deps: ContentDeps): string {
    return gunzipSync(deps.blobs.object('public', MANIFEST)?.bytes ?? new Uint8Array()).toString('utf8');
}

const LAST_GOOD: ManifestStateDoc = {
    requestedVersion: 3,
    builtVersion: 3,
    status: 'idle',
    builtAt: EARLIER,
    url: publicUrl(MANIFEST),
    sha256: 'f'.repeat(64),
    bytes: 1234,
    counts: { layers: 1, photos: 1, pois: 0, poiCategories: 0 },
    updatedBy: 'system:publish',
    updatedAt: EARLIER,
};

describe('buildManifest: published', () => {
    it('happyPath_theManifestIsUploadedAndRecorded @S-A10-HAPPY-MANIFEST-BUILT', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);

        await expect(buildManifest(deps, TASK)).resolves.toBe('published');

        const json = served(deps);
        const manifest = validateManifest(JSON.parse(json));
        expect(manifest.ok && manifest.value.photos.map((photo) => photo.id)).toEqual(['p1', 'p2']);
        expect(deps.blobs.object('public', MANIFEST)?.options).toEqual({
            contentType: 'application/json',
            contentEncoding: 'gzip',
            cacheControl: 'public, max-age=60',
        });
        expect(await state(deps)).toEqual({
            requestedVersion: 1,
            builtVersion: 1,
            status: 'idle',
            builtAt: timestampFromDate(new Date(NOW)),
            url: publicUrl(MANIFEST),
            sha256: createHash('sha256').update(json).digest('hex'),
            bytes: deps.blobs.object('public', MANIFEST)?.bytes.length,
            counts: { layers: 1, photos: 2, unplaced: 0, pois: 1, poiCategories: 1, stories: 0 },
            updatedBy: 'system:publish',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
    });

    it('happyPath_documentsLeftOutAreListedAndAFormerErrorCleared @S-A10-BAD-DOCUMENT-SKIPPED', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        await deps.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'rights'), photoDocSchema, photoDoc('rights', { license: 'unknown' }));
        await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, {
            ...LAST_GOOD,
            status: 'failed',
            error: 'apiError.internal',
        });

        await buildManifest(deps, { ...TASK, requestedVersion: 2 });

        expect(await state(deps)).toMatchObject({
            requestedVersion: 3,
            builtVersion: 3,
            skipped: [{ entity: 'photo', id: 'rights', code: 'validation.value', path: 'license' }],
        });
        expect((await state(deps))?.error).toBeUndefined();
    });

    it('happyPath_aRequestDuringTheBuildQueuesTheNextOne @S-A10-BAD-WRITE-DURING-BUILD', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        const blobs = {
            ...deps.blobs,
            write: async (...args: Parameters<typeof deps.blobs.write>) => {
                await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, {
                    requestedVersion: 2,
                    builtVersion: 0,
                    status: 'building',
                    updatedBy: 'system:publish',
                    updatedAt: EARLIER,
                });
                return deps.blobs.write(...args);
            },
        };

        await buildManifest({ ...deps, blobs }, TASK);

        expect(await state(deps)).toMatchObject({ requestedVersion: 2, builtVersion: 1, status: 'queued' });
        expect(deps.tasks.queued).toEqual([
            {
                queue: 'publish-buildManifest',
                payload: { cityId: CITY_ID, requestedVersion: 2, full: true },
                options: { id: `manifest-${CITY_ID}-${String(Math.floor(Date.parse(NOW) / 60_000))}`, delaySeconds: 60 },
            },
        ]);
    });

    it('badPath_aStateRemovedDuringTheBuildIsWrittenAgain', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        const blobs = {
            ...deps.blobs,
            write: async (...args: Parameters<typeof deps.blobs.write>) => {
                await deps.documents.delete(FIRESTORE_PATHS.manifestState(CITY_ID));
                return deps.blobs.write(...args);
            },
        };

        await buildManifest({ ...deps, blobs }, TASK);

        expect(await state(deps)).toMatchObject({ requestedVersion: 1, builtVersion: 1, status: 'idle' });
    });

    it('badPath_aStateRemovedBeforeAFailureRecordsNothingBuilt', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps, { mapbox: {} });
        const documents = {
            ...deps.documents,
            query: async (...args: Parameters<typeof deps.documents.query>) => {
                await deps.documents.delete(FIRESTORE_PATHS.manifestState(CITY_ID));
                return deps.documents.query(...args);
            },
        };

        await buildManifest({ ...deps, documents } as typeof deps, TASK);

        expect(await state(deps)).toMatchObject({ requestedVersion: 1, builtVersion: 0, status: 'failed' });
    });

    it('badPath_aManifestAboveTheSplitSizeIsPublishedWithAWarning', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        /** Text gzip cannot shrink (hash output), deterministic: 1,200 characters per photo. */
        const noise = (index: number) =>
            Array.from({ length: 28 }, (_, part) =>
                createHash('sha256')
                    .update(`${String(index)}-${String(part)}`)
                    .digest('base64url'),
            )
                .join('')
                .slice(0, 1200);
        for (let index = 0; index < 3000; index += 1) {
            deps.documents.seed(
                FIRESTORE_PATHS.photo(CITY_ID, `n${String(index)}`),
                photoDoc(`n${String(index)}`, { description: { ro: noise(index) } }),
            );
        }

        await expect(buildManifest(deps, TASK)).resolves.toBe('published');

        expect(deps.recording.records.find((record) => record.message === 'manifest above the split size')?.data).toMatchObject({
            limit: MANIFEST_SPLIT_BYTES,
        });
        expect((await state(deps))?.counts?.photos).toBe(3002);
    }, 60_000);
});

describe('buildManifest: no manifest', () => {
    it.each([
        ['an unpublished city', true],
        ['a deleted city', false],
    ])('badPath_%s_hasItsManifestRemoved', async (_name, exists) => {
        const deps = contentDeps(NOW);
        if (exists) {
            await seedCity(deps, { published: false });
        }
        deps.blobs.put('public', MANIFEST, new Uint8Array([1]));
        await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, LAST_GOOD);

        await expect(buildManifest(deps, TASK)).resolves.toBe('unpublished');

        expect(deps.blobs.paths('public')).toEqual([]);
        expect(await state(deps)).toEqual({
            requestedVersion: 3,
            builtVersion: 3,
            status: 'idle',
            builtAt: timestampFromDate(new Date(NOW)),
            updatedBy: 'system:publish',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
    });
});

describe('buildManifest: failures', () => {
    it.each([
        ['a city without its public token @S-A10-BAD-NO-PUBLIC-TOKEN', { mapbox: {} }, 'apiError.mapbox.notConfigured'],
        ['a city without its About text', { about: undefined }, 'apiError.invalidRequest'],
    ] as const)('badPath_%s_keepsTheLastGoodManifest', async (_name, city, error) => {
        const deps = contentDeps(NOW);
        await seedCity(deps, city);
        await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, { ...LAST_GOOD, requestedVersion: 4 });

        await expect(buildManifest(deps, TASK)).resolves.toBe('failed');

        expect(await state(deps)).toEqual({
            ...LAST_GOOD,
            requestedVersion: 4,
            status: 'failed',
            error,
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect(deps.blobs.recorder.argsOf('write')).toEqual([]);
        expect(deps.recording.records.find((record) => record.message === 'manifest refused')).toBeDefined();
    });

    it('badPath_anUnavailableBucketIsRecordedAndRetried', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        deps.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'unavailable', { status: 503 }));

        await expect(buildManifest(deps, TASK)).rejects.toBeInstanceOf(UpstreamError);

        expect(await state(deps)).toMatchObject({ requestedVersion: 1, builtVersion: 0, status: 'failed', error: 'apiError.unavailable' });
        expect((await state(deps))?.url).toBeUndefined();
    });

    it('badPath_anUnexpectedFailureIsRecordedNotRetried', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        deps.documents.recorder.failNext('query', new Error('query failed'));

        await expect(buildManifest(deps, TASK)).resolves.toBe('failed');

        expect(await state(deps)).toMatchObject({ status: 'failed', error: 'apiError.internal' });
        expect(deps.tasks.queued).toEqual([]);
    });
});

describe('publish-buildManifest', () => {
    const request = (data: unknown) => ({
        data,
        queueName: 'publish-buildManifest',
        id: 'task-1',
        retryCount: 0,
        executionCount: 0,
        scheduledTime: NOW,
    });

    it('happyPath_aTaskBuildsTheManifest', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);

        await buildManifestFunction(() => deps).run(request(TASK));

        expect(deps.blobs.paths('public')).toEqual([MANIFEST]);
    });

    it('badPath_aPayloadTheSchemaRefusesIsDropped', async () => {
        const deps = contentDeps(NOW);

        await buildManifestFunction(() => deps).run(request({ cityId: 'Bad City', requestedVersion: 0 }));

        expect(deps.recording.records).toEqual([
            { level: 'error', scope: 'functions', message: 'manifest build task refused', data: { issues: 3 } },
        ]);
        expect(await state(deps)).toBeUndefined();
    });

    it('happyPath_oneDispatchAtATimeWithRetries', () => {
        expect(buildManifestFunction(() => contentDeps()).__endpoint).toMatchObject({
            taskQueueTrigger: { rateLimits: { maxConcurrentDispatches: 1 }, retryConfig: { maxAttempts: 5, minBackoffSeconds: 30 } },
            maxInstances: 1,
        });
    });
});
