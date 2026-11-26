import type { BuildManifestTask, ExportTask, GeocodeTask, PublishTask } from '@hcm/shared';

/** Every task queue of the backend and the payload its function takes (validated again on dispatch). */
interface TaskPayloads {
    readonly 'publish-buildManifest': BuildManifestTask;
    /** M3: the publisher of `docs/research/M3-interfaces.md` §7.3 (`IMAGERY_PUBLISH_QUEUE`), one dispatch at a time. */
    readonly 'imagery-publish': PublishTask;
    /** M4: Nominatim reverse geocoding, one a second for the whole project (`ASSIST_GEOCODE_QUEUE`; task id = the cell). */
    readonly 'assist-geocode': GeocodeTask;
    /** M5: a city's static export (`EXPORT_QUEUE`; task id = the city and the export, `docs/research/M5-interfaces.md` §5.3). */
    readonly 'export-build': ExportTask;
}

type QueueName = keyof TaskPayloads;

interface EnqueueOptions {
    /** Cloud Tasks drops a second task with the same id (the manifest builder's debounce: `manifestTaskId`). */
    readonly id?: string;
    readonly delaySeconds?: number;
}

/**
 * Cloud Tasks for the `onTaskDispatched` functions (`roles/cloudtasks.enqueuer`), through firebase-admin's
 * `getFunctions().taskQueue()` (REST, OIDC handled) or the REST API itself. Adapter
 * `functions/src/adapters/cloud-tasks.ts` (fn-content).
 */
export interface TaskQueue {
    /** Resolves `false` when a task with the same id exists already (nothing new was queued). */
    enqueue<Q extends QueueName>(queue: Q, payload: TaskPayloads[Q], options?: EnqueueOptions): Promise<boolean>;
}
