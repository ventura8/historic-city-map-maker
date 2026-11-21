/**
 * What the Jobs page learns from the raster pipeline (`docs/research/M3-interfaces.md` §4.5, §10.6; CR-M3-5): why an
 * unfinished job waits and until when, the layer version it works for (an `awaiting_gcps` job opens the georeferencer
 * on it), and whether a failed job may run again (`jobRetryable` of `@hcm/shared`, CR-M3-47: a pipeline or publish job
 * with its version, attempts left and a failure a retry can cure), through `imagery.retry`, which puts it back in the
 * queue from its failed step.
 */
import { isoOf } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import { jobRetryable, type JobDoc, type JobWaitReason } from '@hcm/shared';

import type { NoticeInput } from '../state/state.js';

export interface RasterJobFields {
    /** Why the unfinished job is not running, or null. */
    readonly waitReason: JobWaitReason | null;
    /** When a job waiting for a retry tries again (ISO), or null. */
    readonly retryAt: string | null;
    /** The layer version it produces or publishes, or null. */
    readonly versionId: string | null;
    /** A failed pipeline or publish job a retry may cure, with attempts left: Retry is offered. */
    readonly retryable: boolean;
    /** Lesson 728: the USGS scene a failed, cancelled or waiting import may run again on the latest pipeline, or null. */
    readonly rerunScene: string | null;
}

/** The job statuses a scene's import may run again from: it failed, was cancelled, or waits for approval. */
const RERUN_STATUSES: ReadonlySet<JobDoc['status']> = new Set(['failed', 'cancelled', 'awaiting_approval']);

/** The scene a `usgs-import` job in one of `RERUN_STATUSES` imported, or null. */
function rerunSceneOf(job: JobDoc): string | null {
    const entityId = job.params['entityId'];
    return job.type === 'usgs-import' && RERUN_STATUSES.has(job.status) && typeof entityId === 'string' ? entityId : null;
}

export function rasterFieldsOf(job: JobDoc): RasterJobFields {
    return {
        ...{ waitReason: job.waitReason ?? null, retryAt: job.retryAt === undefined ? null : isoOf(job.retryAt) },
        ...{ versionId: job.versionId ?? null, retryable: jobRetryable(job), rerunScene: rerunSceneOf(job) },
    };
}

/**
 * Lesson 728: Run again with the latest pipeline (`imagery.import` with `again`): the scene downloaded again for free into a new
 * version of its layer; the new version's page opens. Says why not otherwise. True once the new job exists.
 */
export async function runSceneAgain(services: ContentServices, entityId: string): Promise<boolean> {
    try {
        const { versionId } = await callImagery(services.callables, 'imagery.import', { cityId: services.cityId, entityId, again: true });
        services.notify({ key: 'adminContent.imagery.notice.imported' });
        globalThis.location.hash = `#/imagery/version/${encodeURIComponent(versionId)}`;
        return true;
    } catch (error) {
        services.notify(refusalOf(error));
        return false;
    }
}

/** Runs a failed job again; says so, or why not. True once it is queued again. */
export async function retryRasterJob(services: ContentServices, jobId: string): Promise<boolean> {
    try {
        await callImagery(services.callables, 'imagery.retry', { cityId: services.cityId, jobId });
    } catch (error) {
        services.notify(withNewerImport(refusalOf(error)));
        return false;
    }
    services.notify({ key: 'adminContent.jobs.retried' });
    return true;
}

/** The notice of Pause all or Resume all: how many jobs changed, or that there was nothing to change. */
function pauseAllNotice(action: 'pause' | 'resume', changed: number): NoticeInput {
    if (changed === 0) {
        return { key: action === 'pause' ? 'adminContent.jobs.nothingToPause' : 'adminContent.jobs.nothingToResume' };
    }
    return { key: action === 'pause' ? 'adminContent.jobs.pausedAll' : 'adminContent.jobs.resumedAll', params: { count: String(changed) } };
}

/** Pause all or Resume all (the owner's request of 2026-11-13, `imagery.pause` without a job); says how many, or why not. */
export async function pauseAllJobs(services: ContentServices, action: 'pause' | 'resume'): Promise<boolean> {
    try {
        const { changed } = await services.callables.call('imagery.pause', { cityId: services.cityId, action });
        services.notify(pauseAllNotice(action, changed));
        return true;
    } catch (error) {
        services.notify(refusalOf(error));
        return false;
    }
}

/**
 * A refusal that names a newer import of the same frame (`apiError.imagery.importedAgain`) offers to open it: the old
 * import cannot run again, the newer one is where the frame goes on (the owner's report of 2026-11-13).
 */
export function withNewerImport(notice: NoticeInput): NoticeInput {
    const newer = notice.params?.['versionId'];
    if (notice.key !== 'apiError.imagery.importedAgain' || newer === undefined) {
        return notice;
    }
    const run = (): void => {
        globalThis.location.hash = `#/imagery/version/${encodeURIComponent(newer)}`;
    };
    return { ...notice, action: { key: 'adminContent.jobs.openNewer', run } };
}
