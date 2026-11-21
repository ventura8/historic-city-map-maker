/**
 * `imagery.tick`'s `relocate` part (`functions/src/imagery/relocate.ts`, M18 item 3 of `docs/research/M18-improvements.md`): a
 * frame parked for points under an older pipeline image searches again by itself, free, once per image.
 */
import { FIRESTORE_PATHS, JOB_MAX_ATTEMPTS, PLACING_POINTS_HOLD_MS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { relocateParked, RELOCATE_PER_TICK } from '../../src/imagery/relocate.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    needsGcpsVersion,
    readVersion,
    readJob,
    readyWorld,
    seedJob,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const OLD = `sha256:${'ae'.repeat(32)}`;
const NEW = `sha256:${'eb'.repeat(32)}`;
const REPOSITORY = 'us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline';
const SEGMENT = (job: string): string => `work/${CITY}/${job}/segments/a.tif`;

function parked(job: string, overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_gcps',
        waitReason: 'gcps',
        params: { entityId: job, dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: `layer-${job}`,
        versionId: job,
        attempt: JOB_MAX_ATTEMPTS,
        steps: {
            fetch: { status: 'done' },
            extract: { status: 'done', gcsPath: SEGMENT(job) },
            stitch: { status: 'done' },
            locate: { status: 'done' },
        },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

async function world(
    frames: readonly (readonly [id: string, searchedWith?: string, overrides?: Partial<JobDoc>])[],
    installed: string | null = NEW,
): Promise<ImageryWorld> {
    const w = await readyWorld();
    for (const [id, searchedWith, overrides] of frames) {
        await seedJob(w, id, parked(id, { ...(searchedWith === undefined ? {} : { searchedWith }), ...overrides }));
        await seedVersion(w, id, needsGcpsVersion({ origin: 'usgs', layerId: `layer-${id}` }));
        w.deps.blobs.put('private', SEGMENT(id), new Uint8Array([1]));
    }
    if (installed !== null) {
        w.jobs.descriptions.set('raster-pipeline', { image: `${REPOSITORY}@${installed}`, labels: {} });
    }
    return w;
}

describe('relocateParked', () => {
    it('happyPath_aFrameSearchedWithAnOlderImageSearchesAgainFreeWithARunOfItsOwn @S-A69-HAPPY-AUTO-RELOCATE', async () => {
        const w = await world([['f1', OLD]]);

        await relocateParked(w.deps, CITY);

        const job = await readJob(w, 'f1');
        expect(job).toMatchObject({ status: 'queued', attempt: JOB_MAX_ATTEMPTS - 1, updatedBy: 'system:imagery' });
        expect(job?.searchedWith).toBeUndefined();
        expect(w.deps.recording.records.map((record) => record.message)).toContain('frame located again');
    });

    it('happyPath_aFrameFirstSeenRemembersTheImageAndIsNotSearchedAgain', async () => {
        const w = await world([['f1'], ['f2', NEW]]);

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: NEW });
        expect(await readJob(w, 'f2')).toMatchObject({ status: 'awaiting_gcps', searchedWith: NEW });
    });

    it('happyPath_atMostAFewFramesStartInOneTick', async () => {
        const w = await world(Array.from({ length: RELOCATE_PER_TICK + 1 }, (_, index) => [`f${String(index)}`, OLD] as const));

        await relocateParked(w.deps, CITY);

        const states = await Promise.all(Array.from({ length: RELOCATE_PER_TICK + 1 }, (_, index) => readJob(w, `f${String(index)}`)));
        expect(states.filter((job) => job?.status === 'queued')).toHaveLength(RELOCATE_PER_TICK);
    });

    it('badPath_aFrameWhoseInputsAreGoneIsLoggedAndRememberedSoNoTickAsksAgain @S-A69-BAD-AUTO-RELOCATE-REFUSED', async () => {
        const w = await world([['f1', OLD]]);
        await w.deps.blobs.delete('private', SEGMENT('f1'));

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: NEW });
        expect(w.deps.recording.records.find((record) => record.message === 'a parked frame was not searched again')).toMatchObject({
            level: 'warn',
        });
    });

    // Finding of 2026-11-12: a version its schema refuses sorted first and threw before any other frame was searched again.
    it('badPath_aRecordALaterSchemaRefusesIsLoggedRememberedAndTheOthersStillSearch @S-A69-BAD-AUTO-RELOCATE-INVALID', async () => {
        const w = await world([
            ['a-bad', OLD],
            ['f1', OLD],
            ['f2', OLD],
        ]);
        w.deps.documents.seed(FIRESTORE_PATHS.layerVersion(CITY, 'a-bad'), { layerId: 'Not An Id!' });

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'a-bad')).toMatchObject({ status: 'awaiting_gcps', searchedWith: NEW });
        expect([(await readJob(w, 'f1'))?.status, (await readJob(w, 'f2'))?.status]).toEqual(['queued', 'queued']);
        const warning = w.deps.recording.records.find((record) => record.message === 'a parked frame was not searched again');
        expect(warning).toMatchObject({ level: 'warn', data: { versionId: 'a-bad' } });
        expect(String(warning?.data?.['error'])).toContain('InvalidDocumentError');
    });

    it('badPath_aFailureThatIsNoRefusalFailsThePartForTheTickToLog', async () => {
        const w = await world([['f1', OLD]]);
        w.deps.documents.transaction = () => Promise.reject(new Error('firestore unavailable'));

        await expect(relocateParked(w.deps, CITY)).rejects.toThrow('firestore unavailable');
    });

    it('badPath_withNoInstalledImageKnownNothingMoves', async () => {
        const w = await world([['f1', OLD]], null);

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: OLD });
    });

    // Review of M18 item 3: an editor placing points on the frame keeps it waiting, or their Save would be refused; finding of
    // 2026-11-14: an old mark keeps it waiting too (an update re-ran 1871 Pappasoglu under an agent's unsaved points).
    it('badPath_aFrameAnEditorIsPlacingPointsOnKeepsWaitingHoweverOldTheMark @S-A69-BAD-AUTO-RELOCATE-PLACING', async () => {
        const old = new Date(Date.parse(NOW) - 2 * PLACING_POINTS_HOLD_MS).toISOString();
        const w = await world([
            ['f1', OLD, { placingPoints: true, updatedBy: 'u-admin', updatedAt: at(NOW) }],
            ['f2', OLD, { placingPoints: true, updatedBy: 'u-admin', updatedAt: at(old) }],
            ['f3', OLD],
        ]);

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: OLD, placingPoints: true });
        expect(await readJob(w, 'f2')).toMatchObject({ status: 'awaiting_gcps', searchedWith: OLD, placingPoints: true });
        expect(await readJob(w, 'f3')).toMatchObject({ status: 'queued' });
    });

    // Finding of 2026-11-14 (1864 and 1871 Pappasoglu): an update never sends a version holding the owner's saved pairs searching.
    it('badPath_aVersionHoldingTheOwnersSavedPairsIsNotSearchedAgainAndKeepsThem @S-A69-BAD-AUTO-RELOCATE-OWNER-PAIRS', async () => {
        const w = await world([['f1', OLD]]);
        const georef = { ...goldenGeoref(), method: 'gcps' as const };
        await seedVersion(w, 'f1', needsGcpsVersion({ origin: 'usgs', layerId: 'layer-f1', georef }));

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: NEW });
        expect((await readVersion(w, 'f1'))?.georef).toEqual(georef);
        expect(w.deps.recording.records.map((record) => record.message)).toContain(
            "a parked version keeps the owner's pairs: not searched again",
        );
    });

    // Review of M18 item 3: the record setup/status can lag behind the job; only the job's image sends a frame searching.
    it('badPath_whileOnlyTheRecordNamesAnImageNothingMovesAndNothingIsRemembered @S-A69-BAD-AUTO-RELOCATE-RECORD', async () => {
        const w = await world([['f1', OLD], ['f2']], null);
        await seedSetup(w, { install: { pipeline: { state: 'installed', release: '1.0.0+bf74d17', checkedAt: NOW, image: NEW } } });

        await relocateParked(w.deps, CITY);

        expect(await readJob(w, 'f1')).toMatchObject({ status: 'awaiting_gcps', searchedWith: OLD });
        expect((await readJob(w, 'f2'))?.searchedWith).toBeUndefined();
    });

    it('happyPath_theTickRunsItAndACityWithNothingParkedReadsNoImage', async () => {
        const w = await world([['f1', OLD]]);
        await runImageryTick(w.deps);
        expect((await readJob(w, 'f1'))?.status).not.toBe('awaiting_gcps');

        const empty = await world([]);
        await relocateParked(empty.deps, CITY);
        expect(empty.jobs.recorder.argsOf('job')).toEqual([]);
    });
});
