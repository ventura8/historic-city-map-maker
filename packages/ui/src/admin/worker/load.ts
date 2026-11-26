/**
 * How a page has the `worker` chunk's elements registered (`docs/research/M7-local-worker.md` §7): through the Jobs area's
 * store, whose chunk the app loads first; the chunk itself is fetched once, when a page first shows a worker element.
 */
import type { WorkerHostPort } from './worker-port.js';

/** Registers `<hcm-worker-panel>` and `<hcm-run-place>` (fire and forget: nothing shows when the chunk does not load). */
export function loadWorkerElements(app: WorkerHostPort | null | undefined): void {
    void app
        ?.loadPage('jobs')
        .then(() => app.content.jobs?.intents.workerElements?.())
        .catch(() => undefined);
}
