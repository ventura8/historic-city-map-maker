/**
 * `imagery.tick`'s `relocate` part (M18 item 3, `docs/research/M18-improvements.md`): a frame parked for points under an
 * older pipeline searches for its place again by itself once a newer pipeline image is installed, as the owner used to do
 * with **Locate again** after every update. It is free: no import, so never the day's limit, and one run of its own whatever
 * the runs before used (`locate-again.ts`). Each parked frame remembers the image it was searched with (`JobDoc.searchedWith`,
 * written the first time a tick sees it); a frame first seen now keeps the current image and is not searched again. At most
 * `RELOCATE_PER_TICK` frames a city start in one tick, and a refusal (the inputs gone, the files on the other place) is logged
 * once and remembered, so no tick asks again for the same image.
 *
 * Review of M18 item 3: only the image the Cloud Run job runs counts (`InstalledImage.from === 'job'`): the record
 * `setup/status.install.pipeline` can lag behind it, and each switch between the two would send every parked frame searching
 * again, uncounted. While the job cannot be read nothing moves and nothing is remembered. A frame an editor is placing points on
 * (`JobDoc.placingPoints`, whatever its age) keeps waiting: a search would refuse their Save and reload the page under them.
 * Finding of 2026-11-14 (1864 and 1871 Pappasoglu, `docs/LESSONS.md`): a version that holds the owner's saved pairs is never
 * searched again by an update either; the update re-ran those series and their points were gone. Only **Locate again** asks it.
 * Finding of 2026-11-22 (1846 atlas, plan-ghid 1923, `docs/LESSONS.md` 759): nor is a tile series that holds the owner's saved
 * layout (`help.layoutAnswer`): the search dropped `help` and laid the series out again by order and seams.
 */
import { FIRESTORE_PATHS, jobDocSchema, layerVersionDocSchema, type JobDoc, type LayerVersionDoc } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { installedImage } from '../worker/installed-image.js';
import { holdsOwnerPairs, locateAgain } from './locate-again.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type RelocateDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs' | 'jobs'>;

/** How many frames of one city one tick sends searching again (each is a pipeline run). */
export const RELOCATE_PER_TICK = 3;

const MESSAGE = 'Searched again after an update: free, no new import, no new download.';

/** Remembers the image the frame was searched with, while it still waits for points. */
async function remember(deps: RelocateDeps, cityId: string, jobId: string, digest: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'awaiting_gcps') {
            await transaction.set(path, jobDocSchema, { ...job, searchedWith: digest, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** What the log says of a frame that was not searched again: the refusal's code, or the error itself (an invalid record). */
function whyNot(error: unknown): Readonly<Record<string, string>> {
    return error instanceof ApiError ? { code: error.code } : { error: String(error) };
}

/** Why a parked version is not searched again: it holds the owner's pairs or tile layout (null: it is searched). */
function keptByOwner(version: LayerVersionDoc | undefined): string | null {
    if (holdsOwnerPairs(version)) {
        return "a parked version keeps the owner's pairs: not searched again";
    }
    return version?.help?.layoutAnswer === undefined ? null : "a parked version keeps the owner's tile layout: not searched again";
}

/**
 * One frame searched again; a refusal, or any other failure (a record its schema refuses: finding of 2026-11-12), is logged with
 * the version and remembered for this image, so one bad frame never stops the others nor is asked again each tick.
 */
async function relocateOne(deps: RelocateDeps, cityId: string, frame: StoredDocument<JobDoc>, digest: string): Promise<void> {
    // A parked frame's version has its job's id (`locate-again.ts`).
    const versionId = frame.id;
    try {
        const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
        const kept = keptByOwner(version);
        if (kept !== null) {
            deps.log.info(kept, { cityId, versionId });
        } else {
            await locateAgain(deps, { cityId, versionId, uid: IMAGERY_WRITER, message: MESSAGE });
        }
    } catch (error) {
        deps.log.warn('a parked frame was not searched again', { cityId, jobId: frame.id, versionId, ...whyNot(error) });
    }
    await remember(deps, cityId, frame.id, digest);
}

/**
 * The image the pipeline job runs, read only when some frame waits (undefined: none waits, or the job cannot be read: the
 * record's image is no ground to search again).
 */
async function digestFor(deps: RelocateDeps, parked: readonly StoredDocument<JobDoc>[]): Promise<string | undefined> {
    const image = parked.length === 0 ? undefined : await installedImage(deps);
    return image?.from === 'job' ? image.digest : undefined;
}

/** An editor marked the frame while placing points on it: the mark stays until their Save or a Locate again by hand. */
function placingPoints(frame: StoredDocument<JobDoc>): boolean {
    return frame.data.placingPoints === true;
}

/** The parked frames of `cityId` searched with another image than the installed one start again; new ones are remembered. */
export async function relocateParked(deps: RelocateDeps, cityId: string): Promise<void> {
    const parked = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', '==', 'awaiting_gcps']] });
    const digest = await digestFor(deps, parked.documents);
    if (digest === undefined) {
        return;
    }
    const unseen = parked.documents.filter((frame) => frame.data.searchedWith === undefined);
    const older = parked.documents.filter((frame) => ![undefined, digest].includes(frame.data.searchedWith) && !placingPoints(frame));
    for (const frame of unseen) {
        await remember(deps, cityId, frame.id, digest);
    }
    for (const frame of older.slice(0, RELOCATE_PER_TICK)) {
        await relocateOne(deps, cityId, frame, digest);
    }
}
