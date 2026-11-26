/**
 * `imagery.deleteVersion` (`functions/src/imagery/delete-version.ts`, `docs/research/M3-interfaces.md` §7.1; S-A125-*): a version that
 * never reached the map goes with its job, the job's log and the files only it uses; a published or approved one, one still under way,
 * one another version is built on and a caller who is not an editor are refused, and nothing is touched.
 */
import { FIRESTORE_PATHS, jobLogDocSchema, layerVersionDocSchema, type ArchiveDoc, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { archiveImportFunction } from '../../src/imagery/archive-import.js';
import { deleteVersionFunction } from '../../src/imagery/delete-version.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { fakeAdmins } from '../support/fakes.js';
import { ARCHIVE, archiveDoc, archiveJob, archiveVersion, readArchive, seedArchive, seriesIdOf } from './archive-world.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readScene,
    readVersion,
    readyWorld,
    renderedVersion,
    seedJob,
    seedScene,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';
const SCENE = 'DS1035-1057DA023';
const REQUEST = { cityId: CITY, versionId: JOB };
const FAILURE = { code: 'apiError.imagery.cityNotFound' } as const;
const MAPBOX = { tilesetId: 'e2e-mapbox.x', origin: 'mts' } as const;
/** The version's own files and scratch, and what is never its own: another version's folder, a delivery, an upload's original. */
const OWN = [`rasters/${CITY}/${LAYER}/${JOB}/tiles.pmtiles`, `rasters/${CITY}/${LAYER}/${JOB}/scan.tif`, `work/${CITY}/${JOB}/frame.json`];
const KEPT = [
    `rasters/${CITY}/${LAYER}/job-other/scan.tif`,
    'usgs-raw/corona2/DS1035-1057DA023/a.tgz',
    `uploads/rasters/${CITY}/u-admin/up-1/original.tif`,
    `work/${CITY}/${JOB}0/frame.json`,
];

function failedJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'failed',
        params: { entityId: SCENE, dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        error: { code: 'apiError.imagery.cityNotFound', message: 'x' },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

async function world(version: LayerVersionDoc, job: JobDoc | null = failedJob()): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedVersion(ready, JOB, version);
    if (job !== null) {
        await seedJob(ready, JOB, job);
    }
    await ready.deps.documents.set(FIRESTORE_PATHS.jobLogs(CITY, JOB) + '/0001', jobLogDocSchema, {
        seq: 1,
        level: 'info',
        message: 'started',
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    });
    for (const path of [...OWN, ...KEPT]) {
        ready.deps.blobs.put('private', path, new Uint8Array([1]));
    }
    return ready;
}

/** Deps whose first transaction finds `change` made just before it (another click between the check and the deletion). */
function meanwhile(target: ImageryWorld, change: () => Promise<void>): ImageryWorld['deps'] {
    const store = target.deps.documents;
    let pending = true;
    const transaction: typeof store.transaction = async (work) => {
        if (pending) {
            pending = false;
            await change();
        }
        return store.transaction(work);
    };
    return { ...target.deps, documents: { ...store, transaction } };
}

function remove(target: ImageryWorld, deps = target.deps) {
    return deleteVersionFunction(() => deps).run(adminCall(REQUEST));
}

async function logCount(target: ImageryWorld): Promise<number> {
    const lines = await target.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, JOB), jobLogDocSchema);
    return lines.documents.length;
}

function sorted(paths: readonly string[]): string[] {
    return [...paths].sort((left, right) => left.localeCompare(right));
}

async function expectUntouched(target: ImageryWorld): Promise<void> {
    expect(await readVersion(target, JOB)).toBeDefined();
    expect(await logCount(target)).toBe(1);
    expect(sorted(target.deps.blobs.paths('private', ''))).toEqual(sorted([...OWN, ...KEPT]));
}

describe('imagery.deleteVersion', () => {
    it.each<[string, LayerVersionDoc, JobDoc | null]>([
        ['a failed version', renderedVersion({ state: 'failed', error: FAILURE }), failedJob()],
        ['a cancelled version', renderedVersion({ state: 'cancelled' }), failedJob({ status: 'cancelled', error: undefined })],
        ['a dismissed version', renderedVersion({ state: 'rejected' }), failedJob({ cancelRequested: true })],
        ['a version whose job is gone', renderedVersion({ state: 'cancelled' }), null],
    ])('happyPath_%sGoesWithItsJobLogAndOwnFiles @S-A125-HAPPY-DELETE-VERSION', async (_name, version, job) => {
        const target = await world(version, job);

        await expect(remove(target)).resolves.toEqual({ deleted: true });

        expect(await readVersion(target, JOB)).toBeUndefined();
        expect(await readJob(target, JOB)).toBeUndefined();
        expect(await logCount(target)).toBe(0);
        expect(sorted(target.deps.blobs.paths('private', ''))).toEqual(sorted(KEPT));
    });

    it('happyPath_aFailedFirstImportFreesItsScene @S-A125-HAPPY-DELETE-VERSION', async () => {
        const target = await world(renderedVersion({ state: 'failed', error: FAILURE }));
        await seedScene(target, SCENE, { status: 'imported', layerId: LAYER });

        await remove(target);

        expect(await readScene(target, SCENE)).toMatchObject({ status: 'candidate' });
    });

    it('happyPath_anArchiveSeriesWaitingForPointsStartsOver @S-A125-HAPPY-DELETE-VERSION', async () => {
        const help = { reason: 'low-confidence', note: 'These pieces could not be placed.', at: at(NOW) } as const;
        const version = archiveVersion({ state: 'needs_gcps', layerId: LAYER, jobId: JOB, help });
        const target = await world(version, archiveJob({ status: 'awaiting_gcps', waitReason: 'gcps', layerId: LAYER, versionId: JOB }));

        await expect(remove(target)).resolves.toEqual({ deleted: true });

        expect(await readVersion(target, JOB)).toBeUndefined();
        expect(await readJob(target, JOB)).toBeUndefined();
    });

    it.each<[LayerVersionDoc['state']]>([['published'], ['approved'], ['publishing'], ['superseded'], ['joined']])(
        'badPath_a%sVersionIsRefused @S-A125-BAD-DELETE-PUBLISHED',
        async (state) => {
            const version = renderedVersion({ state, approval: { auto: false, by: 'u-admin', at: at(NOW) }, mapbox: MAPBOX });
            const target = await world(version, failedJob({ status: 'succeeded', error: undefined }));

            await expect(failureOf(remove(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.deletePublished' } });
            await expectUntouched(target);
        },
    );

    it.each<[string, LayerVersionDoc, JobDoc]>([
        ['running', renderedVersion({ state: 'processing' }), failedJob({ status: 'running', error: undefined })],
        ['queued', renderedVersion({ state: 'processing' }), failedJob({ status: 'queued', error: undefined })],
        ['waiting for approval', renderedVersion(), failedJob({ status: 'awaiting_approval', error: undefined })],
        [
            'a USGS frame waiting for points',
            renderedVersion({ state: 'needs_gcps' }),
            failedJob({ status: 'awaiting_gcps', error: undefined }),
        ],
    ])('badPath_aJob%sIsRefused @S-A125-BAD-DELETE-RUNNING', async (_name, version, job) => {
        const target = await world(version, job);

        await expect(failureOf(remove(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.deleteRunning' } });
        await expectUntouched(target);
        expect((await readJob(target, JOB))?.status).toBe(job.status);
    });

    it('badPath_aVersionAnotherIsBuiltOnIsRefused @S-A125-BAD-DELETE-RUNNING', async () => {
        const target = await world(renderedVersion({ state: 'rejected' }));
        await seedVersion(target, 'job-child', renderedVersion({ state: 'failed', jobId: 'job-child', basedOn: JOB, error: FAILURE }));

        await expect(failureOf(remove(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.deleteInUse' } });
        await expectUntouched(target);
    });

    it('badPath_aVersionStillProcessingWithAFinishedJobIsAVersionState', async () => {
        const target = await world(renderedVersion({ state: 'processing' }));

        await expect(failureOf(remove(target))).resolves.toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        await expectUntouched(target);
    });

    it('badPath_aRetryClickedMeanwhileIsNeverDeleted @S-A125-BAD-DELETE-RUNNING', async () => {
        const target = await world(renderedVersion({ state: 'cancelled' }), failedJob({ status: 'cancelled', error: undefined }));
        const retried = meanwhile(target, () => seedJob(target, JOB, failedJob({ status: 'queued', error: undefined })));

        await expect(failureOf(remove(target, retried))).resolves.toMatchObject({ details: { code: 'apiError.imagery.deleteRunning' } });
        await expectUntouched(target);
    });

    it('badPath_aSeriesWhosePointsArrivedMeanwhileIsNotEnded @S-A125-BAD-DELETE-RUNNING', async () => {
        const help = { reason: 'low-confidence', note: 'These pieces could not be placed.', at: at(NOW) } as const;
        const job = archiveJob({ status: 'awaiting_gcps', waitReason: 'gcps', layerId: LAYER, versionId: JOB });
        const target = await world(archiveVersion({ state: 'needs_gcps', layerId: LAYER, jobId: JOB, help }), job);
        const moved = meanwhile(target, () => seedJob(target, JOB, { ...job, status: 'running', waitReason: undefined }));

        await expect(failureOf(remove(target, moved))).resolves.toMatchObject({ details: { code: 'apiError.imagery.deleteRunning' } });
        expect((await readVersion(target, JOB))?.state).toBe('needs_gcps');
    });

    it('badPath_aVersionDeletedMeanwhileIsNotFound', async () => {
        const target = await world(renderedVersion({ state: 'cancelled' }), failedJob({ status: 'cancelled', error: undefined }));
        const gone = meanwhile(target, () => target.deps.documents.delete(FIRESTORE_PATHS.layerVersion(CITY, JOB)));

        await expect(failureOf(remove(target, gone))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
        expect(await readJob(target, JOB)).toBeDefined();
    });

    it('badPath_aVersionThatLeftItsStateMeanwhileIsAVersionState', async () => {
        const target = await world(renderedVersion({ state: 'cancelled' }), failedJob({ status: 'cancelled', error: undefined }));
        const path = FIRESTORE_PATHS.layerVersion(CITY, JOB);
        const moved = meanwhile(target, () =>
            target.deps.documents.set(path, layerVersionDocSchema, renderedVersion({ state: 'processing' })),
        );

        await expect(failureOf(remove(target, moved))).resolves.toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        await expectUntouched(target);
    });

    it('happyPath_filesTheBucketCannotListAreLeftAndTheVersionStillGoes', async () => {
        const target = await world(renderedVersion({ state: 'cancelled' }));
        const blobs = { ...target.deps.blobs, list: () => Promise.reject(new Error('storage down')) };

        await expect(remove(target, { ...target.deps, blobs })).resolves.toEqual({ deleted: true });

        expect(await readVersion(target, JOB)).toBeUndefined();
    });

    it('badPath_aMissingVersionIsNotFound', async () => {
        const target = await readyWorld();

        await expect(failureOf(remove(target))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it.each<['moderator' | 'uploader']>([['moderator'], ['uploader']])(
        'badPath_a%sCannotDelete @S-A125-BAD-DELETE-RUNNING',
        async (role) => {
            const target = await world(renderedVersion({ state: 'cancelled' }));
            const admins = fakeAdmins(['u-admin'], { projectRole: 'admin', cities: { [CITY]: role } });

            await expect(failureOf(remove(target, { ...target.deps, admins }))).resolves.toMatchObject({
                details: { code: 'apiError.city.notEditor' },
            });
            await expectUntouched(target);
        },
    );
});

describe('imagery.deleteVersion, an archive series', () => {
    it('happyPath_aDeletedSeriesLeavesItsArchiveRecordAndIsImportedAgain @S-A125-HAPPY-DELETE-VERSION', async () => {
        const help = { reason: 'low-confidence', note: 'These pieces could not be placed.', at: at(NOW) } as const;
        const version = archiveVersion({ state: 'needs_gcps', layerId: LAYER, jobId: JOB, help });
        const target = await world(version, archiveJob({ status: 'awaiting_gcps', waitReason: 'gcps', layerId: LAYER, versionId: JOB }));
        const jobs = { [seriesIdOf(0)]: 'ar-0', [seriesIdOf(1)]: JOB };
        await seedArchive(target, archiveDoc(2, { jobs, importedBy: 'u-admin', importedAt: at(NOW) }));

        await remove(target);
        expect((await readArchive(target))?.jobs).toEqual({ [seriesIdOf(0)]: 'ar-0' });
        const again = { cityId: CITY, archiveId: ARCHIVE, series: [{ seriesId: seriesIdOf(1), include: true }] };
        const imported = await archiveImportFunction(() => target.deps).run(adminCall(again));

        const record = (await readArchive(target))?.jobs;
        expect(record?.[seriesIdOf(0)]).toBe('ar-0');
        expect(record?.[seriesIdOf(1)]).toBe(imported.jobs[0]?.jobId);
    });

    it('happyPath_theLastSeriesDeletedLeavesTheArchiveUnimported @S-A125-HAPPY-DELETE-VERSION', async () => {
        const target = await world(archiveVersion({ state: 'cancelled', layerId: LAYER, jobId: JOB }), null);
        await seedArchive(target, archiveDoc(2, { jobs: { [seriesIdOf(1)]: JOB }, importedBy: 'u-admin', importedAt: at(NOW) }));

        await remove(target);

        const archive = await readArchive(target);
        expect([archive?.jobs, archive?.importedBy, archive?.importedAt]).toEqual([undefined, undefined, undefined]);
    });

    it.each<[string, Partial<ArchiveDoc>]>([
        ['naming another job', { jobs: { [seriesIdOf(1)]: 'ar-newer' }, importedBy: 'u-admin', importedAt: at(NOW) }],
        ['naming no job', {}],
    ])('happyPath_anArchiveRecord%sIsLeftAsItIs', async (_name, record) => {
        const target = await world(archiveVersion({ state: 'cancelled', layerId: LAYER, jobId: JOB }), null);
        await seedArchive(target, archiveDoc(2, record));

        await remove(target);

        expect((await readArchive(target))?.jobs).toEqual(record.jobs);
        expect(await readVersion(target, JOB)).toBeUndefined();
    });
});
