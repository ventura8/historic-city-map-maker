/**
 * The nightly `manifests` step: a full rebuild per published city, then the sweep of public photo files no document
 * and no served manifest names any more (only once every cached manifest has expired).
 */
import { FIRESTORE_PATHS, STORAGE_PATHS, cityDocSchema, manifestStateDocSchema, photoDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { isNightlyDue, nightlyManifests } from '../../src/ops/manifests.js';
import { CITY_ID, cityDoc, photoDoc } from '../publish/city.js';
import { publicUrl } from '../publish/fakes.js';
import { hoursBefore, opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-12T02:15:00.000Z';
const YESTERDAY = new Date('2026-10-11T02:20:00.000Z');

const path = (photo: string, sha8: string, variant: string) => `photos/${CITY_ID}/${photo}/${sha8}/${variant}.webp`;

async function seedSweep(deps: OpsTestDeps): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc());
    await deps.documents.set(FIRESTORE_PATHS.city('ghost-town'), cityDocSchema, cityDoc({ published: false }));
    await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, {
        requestedVersion: 2,
        builtVersion: 2,
        status: 'idle',
        builtAt: hoursBefore(NOW, 1),
        updatedBy: 'system:publish',
        updatedAt: hoursBefore(NOW, 1),
    });
    const image = (photo: string, sha8: string) => ({
        web: publicUrl(path(photo, sha8, 'web')),
        thumb: publicUrl(path(photo, sha8, 'thumb')),
        sha256: sha8.padEnd(64, '0'),
        w: 10,
        h: 10,
    });
    await deps.documents.set(
        FIRESTORE_PATHS.photo(CITY_ID, 'kept'),
        photoDocSchema,
        photoDoc('kept', { image: image('kept', 'aaaaaaaa') }),
    );
    await deps.documents.set(
        FIRESTORE_PATHS.photo(CITY_ID, 'hidden'),
        photoDocSchema,
        photoDoc('hidden', { published: false, image: image('hidden', 'bbbbbbbb') }),
    );
    await deps.documents.set(
        FIRESTORE_PATHS.photo(CITY_ID, 'raw'),
        photoDocSchema,
        photoDoc('raw', { processing: 'pending', image: undefined }),
    );
    deps.documents.seed(FIRESTORE_PATHS.photo(CITY_ID, 'broken'), { title: 'not localized' });
    const served = { photos: [{ image: { web: publicUrl(path('deleted', 'cccccccc', 'web')), thumb: 'derived/relative.webp' } }, {}] };
    deps.blobs.put('public', STORAGE_PATHS.manifest(CITY_ID), new TextEncoder().encode(JSON.stringify(served)));
    const old = { customMetadata: { writtenAt: '2026-10-12T01:00:00.000Z' } };
    for (const object of [
        path('kept', 'aaaaaaaa', 'web'),
        path('hidden', 'bbbbbbbb', 'thumb'),
        path('deleted', 'cccccccc', 'web'),
        path('broken', 'dddddddd', 'web'),
        path('kept', '99999999', 'web'),
    ]) {
        deps.blobs.put('public', object, new Uint8Array([1]), old);
    }
    deps.blobs.put('public', path('kept', 'eeeeeeee', 'web'), new Uint8Array([1]), {
        customMetadata: { writtenAt: '2026-10-12T02:10:00.000Z' },
    });
    deps.blobs.put('public', path('legacy', 'ffffffff', 'web'), new Uint8Array([1]));
}

describe('isNightlyDue', () => {
    it.each([
        ['the first tick after 02:00 of a new day', '2026-10-12T02:00:00.000Z', YESTERDAY, true],
        ['a project that never ran it', '2026-10-12T02:00:00.000Z', undefined, true],
        ['before 02:00', '2026-10-12T01:59:59.000Z', YESTERDAY, false],
        ['a second time the same day', '2026-10-12T23:45:00.000Z', new Date('2026-10-12T02:05:00.000Z'), false],
    ])('%s', (_name, now, last, due) => {
        expect(isNightlyDue(new Date(now), last)).toBe(due);
    });
});

describe('nightlyManifests', () => {
    it('happyPath_rebuildsPublishedCitiesAndSweepsWhatNothingNames', async () => {
        const deps = opsDeps(NOW);
        await seedSweep(deps);

        await expect(nightlyManifests(deps, new Date(NOW), YESTERDAY)).resolves.toEqual(new Date(NOW));

        expect(deps.tasks.queued).toEqual([
            {
                queue: 'publish-buildManifest',
                payload: { cityId: CITY_ID, requestedVersion: 1, full: true },
                options: { id: `manifest-${CITY_ID}-${String(Math.floor(Date.parse(NOW) / 60_000))}`, delaySeconds: 60 },
            },
        ]);
        expect(deps.blobs.paths('public', 'photos/')).toEqual(
            [
                path('broken', 'dddddddd', 'web'),
                path('deleted', 'cccccccc', 'web'),
                path('hidden', 'bbbbbbbb', 'thumb'),
                path('kept', 'aaaaaaaa', 'web'),
                path('kept', 'eeeeeeee', 'web'),
            ].sort((a, b) => a.localeCompare(b)),
        );
        expect(deps.recording.records.at(-1)).toMatchObject({
            message: 'nightly manifest work',
            data: { cityId: CITY_ID, deletedObjects: 2 },
        });
    });

    it('badPath_notDueDoesNothing', async () => {
        const deps = opsDeps(NOW);

        await expect(nightlyManifests(deps, new Date(NOW), new Date('2026-10-12T02:00:00.000Z'))).resolves.toBeUndefined();
        expect(deps.documents.recorder.calls).toEqual([]);
    });

    it.each([
        ['a build is running', { status: 'building' as const, builtAt: hoursBefore(NOW, 1) }],
        ['the last build is minutes old', { status: 'idle' as const, builtAt: timestampFromDate(new Date('2026-10-12T02:10:00.000Z')) }],
        ['no build ever finished', { status: 'queued' as const }],
    ])('badPath_noSweepWhile_%s', async (_name, build) => {
        const deps = opsDeps(NOW);
        await seedSweep(deps);
        await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, {
            requestedVersion: 3,
            builtVersion: 2,
            ...build,
            updatedBy: 'system:publish',
            updatedAt: hoursBefore(NOW, 1),
        });

        await nightlyManifests(deps, new Date(NOW), undefined);

        expect(deps.blobs.paths('public', 'photos/')).toHaveLength(7);
    });

    it('badPath_noServedManifestStillSweepsByTheDocuments', async () => {
        const deps = opsDeps(NOW);
        await seedSweep(deps);
        await deps.blobs.delete('public', STORAGE_PATHS.manifest(CITY_ID));

        await nightlyManifests(deps, new Date(NOW), undefined);

        expect(deps.blobs.paths('public', 'photos/')).not.toContain(path('deleted', 'cccccccc', 'web'));
    });

    it('badPath_aServedManifestWithoutPhotosNamesNothing', async () => {
        const deps = opsDeps(NOW);
        await seedSweep(deps);
        deps.blobs.put('public', STORAGE_PATHS.manifest(CITY_ID), new TextEncoder().encode('{"version":1}'));

        await nightlyManifests(deps, new Date(NOW), undefined);

        expect(deps.blobs.paths('public', 'photos/')).not.toContain(path('deleted', 'cccccccc', 'web'));
    });

    it('badPath_anUnreadableManifestFailsTheStep', async () => {
        const deps = opsDeps(NOW);
        await seedSweep(deps);
        deps.blobs.put('public', STORAGE_PATHS.manifest(CITY_ID), new TextEncoder().encode('{not json'));

        await expect(nightlyManifests(deps, new Date(NOW), undefined)).rejects.toBeInstanceOf(SyntaxError);
        expect(deps.blobs.paths('public', 'photos/')).toHaveLength(7);
    });
});
