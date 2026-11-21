/**
 * Where a raster job runs (`docs/research/M7-local-worker.md` §3): the city's remembered choice
 * (`cities/{city}/workers/choice`, `auto` when absent), and `auto` means the owner's computer while one of the city's
 * workers was seen within `WORKER_FRESH_SECONDS`, else Cloud Run.
 */
import {
    FIRESTORE_PATHS,
    WORKER_FRESH_SECONDS,
    WORKER_ID_PATTERN,
    runChoiceDocSchema,
    timestampToDate,
    workerDocSchema,
    type RunChoice,
    type RunPlace,
} from '@hcm/shared';

import type { DocumentStore } from '../ports/documents.js';

/** The city's remembered choice (`auto` when it never made one). */
export async function runChoiceOf(documents: DocumentStore, cityId: string): Promise<RunChoice> {
    return (await documents.get(FIRESTORE_PATHS.runChoice(cityId), runChoiceDocSchema))?.choice ?? 'auto';
}

/** True when one of the city's workers (`w-…`; the choice document is not one) was seen within `WORKER_FRESH_SECONDS`. */
async function workerConnected(documents: DocumentStore, cityId: string, now: Date): Promise<boolean> {
    const since = now.getTime() - WORKER_FRESH_SECONDS * 1000;
    const workers = await documents.query(FIRESTORE_PATHS.workers(cityId), workerDocSchema);
    return workers.documents.some(
        (worker) => WORKER_ID_PATTERN.test(worker.id) && timestampToDate(worker.data.lastSeenAt).getTime() >= since,
    );
}

/** Where a new job of the city runs: its choice, or for `auto` the computer while a worker is connected. */
export async function placeFor(documents: DocumentStore, cityId: string, now: Date): Promise<RunPlace> {
    const choice = await runChoiceOf(documents, cityId);
    if (choice !== 'auto') {
        return choice;
    }
    return (await workerConnected(documents, cityId, now)) ? 'local' : 'cloud';
}
