/**
 * Stitched films between computers (`functions/src/worker/film-host.ts`; live report of 2026-11-13): a worker without a job's
 * stitched film hands it back without spending an attempt; the job then waits for the computer whose claims name the film, and only
 * that computer takes it; with no such computer the job fails `filmMissing` with what to do.
 */
import type { JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { dispatchJob } from '../../src/imagery/dispatch.js';
import { claimFunction } from '../../src/worker/claim.js';
import { endFunction } from '../../src/worker/end.js';
import { readJob, seedJob } from '../imagery/world.js';
import {
    CITY,
    JOB,
    OTHER,
    OTHER_WORKER,
    WORKER,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedHeld,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

function end(made: WorkerWorld) {
    return callAs<{ readonly status: string }>(made, endFunction, { workerId: WORKER, jobId: JOB, outcome: 'returned' });
}

function claimBy(made: WorkerWorld, workerId: string, uid: string | undefined, films?: string[]) {
    return callAs(made, claimFunction, { workerId, ...(films === undefined ? {} : { films }) }, uid);
}

async function waiting(job: Partial<JobDoc> = {}): Promise<WorkerWorld> {
    const made = await workerWorld();
    await seedWorker(made);
    await seedWorker(made, OTHER_WORKER, { uid: OTHER, updatedBy: OTHER, films: ['film-job'] });
    await seedJob(made, 'film-job', localJob({ waitReason: 'film-copy', createdAt: minutes(-100), ...job }));
    return made;
}

describe('a job whose film is on another computer', () => {
    it('happyPath_aWorkerWithoutTheFilmHandsItBackForTheComputerThatHasIt @S-A120-HAPPY-FILM-HOST', async () => {
        const made = await workerWorld();
        await seedHeld(made, { attempt: 2, step: 'georef' });
        await seedWorker(made, OTHER_WORKER, { uid: OTHER, updatedBy: OTHER, films: [JOB] });

        await expect(end(made)).resolves.toEqual({ status: 'queued' });

        await expect(readJob(made, JOB)).resolves.toMatchObject({ status: 'queued', attempt: 1, waitReason: 'film-copy' });
        await expect(readWorker(made)).resolves.toMatchObject({ state: 'idle' });
    });

    it('happyPath_onlyTheComputerHoldingTheFilmClaimsIt @S-A120-HAPPY-FILM-HOST', async () => {
        const made = await waiting();

        await expect(claimBy(made, WORKER, undefined, [])).resolves.toEqual({ job: null });
        await expect(claimBy(made, WORKER, undefined)).resolves.toEqual({ job: null });
        await expect(readWorker(made)).resolves.toMatchObject({ films: [] });
        await expect(claimBy(made, OTHER_WORKER, OTHER, ['film-job'])).resolves.toEqual({ job: { jobId: 'film-job' } });
        await expect(readJob(made, 'film-job')).resolves.toMatchObject({ status: 'starting', worker: { id: OTHER_WORKER } });
        await expect(readWorker(made, OTHER_WORKER)).resolves.toMatchObject({ films: ['film-job'], state: 'busy' });
    });

    it('happyPath_aClaimKeepsTheFilmsItNames', async () => {
        const made = await waiting({ status: 'succeeded' });

        await expect(claimBy(made, WORKER, undefined, ['a-film'])).resolves.toEqual({ job: null });
        await expect(readWorker(made)).resolves.toMatchObject({ films: ['a-film'] });
    });

    it.each([
        ['no computer holds it', {}],
        ['only a disconnected computer holds it', { revokedAt: minutes(-1) }],
        ['only a computer unseen for longer than films are kept holds it', { lastSeenAt: minutes(-15 * 24 * 60) }],
    ])('badPath_%sFailsFilmMissing @S-A120-BAD-FILM-GONE', async (_name, other) => {
        const made = await workerWorld();
        await seedHeld(made, { attempt: 2, step: 'georef' });
        await seedWorker(made, OTHER_WORKER, {
            uid: OTHER,
            updatedBy: OTHER,
            ...other,
            films: 'revokedAt' in other || 'lastSeenAt' in other ? [JOB] : [],
        });

        await expect(end(made)).resolves.toEqual({ status: 'failed' });

        await expect(readJob(made, JOB)).resolves.toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.filmMissing' } });
    });

    it('badPath_theDispatcherKeepsTheWaitForTheFilm @S-A120-BAD-FILM-GONE', async () => {
        const made = await waiting();

        await dispatchJob(made.deps, CITY, 'film-job');

        await expect(readJob(made, 'film-job')).resolves.toMatchObject({ waitReason: 'film-copy' });
    });
});
