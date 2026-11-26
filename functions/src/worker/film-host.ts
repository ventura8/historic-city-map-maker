/**
 * Stitched films between computers (live report of 2026-11-13, the 1968 Corona F026 that failed "film no longer stored"): `stitch`
 * leaves a frame's film as segments under `work/` on the computer that stitched it, and the admin's points later queue the job again for
 * any worker. A worker without the film hands the job back (`worker.end` `returned`, the attempt given back): it waits for the computer
 * that holds the film (`waitReason: 'film-copy'`), which every claim names (`films`), and only that computer claims it while it is
 * online. When no worker of the city says it holds the film, the job fails `filmMissing` (Locate again, or import the frame again).
 * The film is never copied through the bucket: only its holder could send it, and an idle holder runs the job itself instead.
 */
import { FIRESTORE_PATHS, timestampToDate, workerDocSchema, type JobDoc, type WorkerDoc } from '@hcm/shared';

import type { DocumentStore } from '../ports/documents.js';

/** A queued job waiting for the computer that holds its stitched film. */
function awaitingFilm(job: JobDoc): boolean {
    return job.waitReason === 'film-copy';
}

/** True when this claim may take the job: one waiting for its film goes only to a worker that holds it. */
export function filmHere(job: JobDoc, jobId: string, films: readonly string[] | undefined): boolean {
    return !awaitingFilm(job) || (films ?? []).includes(jobId);
}

/** How long a computer unseen may still hold a film: its work folder keeps the segments 14 days (`WORK_DAYS` of the pipeline). */
const FILM_KEPT_MS = 14 * 24 * 3600 * 1000;

/** A worker that may still hold the film: not disconnected, seen within the film's days, naming the job in its last claim. */
function holdsFilm(worker: WorkerDoc, jobId: string, now: Date): boolean {
    const recent = now.getTime() - timestampToDate(worker.lastSeenAt).getTime() < FILM_KEPT_MS;
    return worker.revokedAt === undefined && recent && (worker.films ?? []).includes(jobId);
}

/** True when a worker of the city other than `call.workerId` said in its last claim that it holds the job's film. */
export async function filmHeldElsewhere(
    store: Pick<DocumentStore, 'query'>,
    call: { readonly cityId: string; readonly workerId: string },
    jobId: string,
    now: Date,
): Promise<boolean> {
    const workers = await store.query(FIRESTORE_PATHS.workers(call.cityId), workerDocSchema);
    return workers.documents.some((worker) => worker.id !== call.workerId && holdsFilm(worker.data, jobId, now));
}
