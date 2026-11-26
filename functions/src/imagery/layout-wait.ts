import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    jobDocSchema,
    layerVersionDocSchema,
    type HelpItem,
    type JobDoc,
    type LayerVersionDoc,
    type LayoutAnswer,
    type StitchLayout,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { stampOf } from './records.js';

/**
 * The tile-import wizard's shared step (`docs/research/M20-import-local.md` §19.10; `save-layout.ts`, `accept-layout.ts`): an archive
 * series waiting with `layout-check` takes the owner's answer as `help.layoutAnswer` and runs again from `place`, which fixes it
 * (`pipeline/src/hcm_pipeline/placing/owner_layout.py`), as `imagery.saveGcps` resumes a series from the owner's pairs.
 */

/** The series, its job and its layout, all waiting for the owner's tiles. */
interface LayoutWait {
    readonly version: LayerVersionDoc;
    readonly job: JobDoc;
    readonly help: HelpItem;
    readonly layout: StitchLayout;
}

/** An archive series parked for a person, not asked to stop. */
function seriesWaits(version: LayerVersionDoc, job: JobDoc): boolean {
    return (
        version.state === 'needs_gcps' && job.status === 'awaiting_gcps' && job.type === 'archive-series' && job.cancelRequested !== true
    );
}

/** The layout that waits for the owner's tiles, if any. */
function layoutOf(help: HelpItem | undefined): StitchLayout | undefined {
    return help?.reason === 'layout-check' ? help.stitched?.layout : undefined;
}

/** The version and its job, both there and parked for a person, else `apiError.imagery.versionState`. */
function requireParked(version: LayerVersionDoc | undefined, job: JobDoc | undefined): { version: LayerVersionDoc; job: JobDoc } {
    if (version === undefined || job === undefined || !seriesWaits(version, job)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return { version, job };
}

/** A series waiting with `layout-check` and a layout, else `apiError.imagery.versionState`. */
function requireLayoutWait(found: LayerVersionDoc | undefined, foundJob: JobDoc | undefined): LayoutWait {
    const { version, job } = requireParked(found, foundJob);
    const layout = layoutOf(version.help);
    if (version.help === undefined || layout === undefined) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return { version, job, help: version.help, layout };
}

/** The answer was made on the layout as it stands, else `apiError.imagery.layoutStale`. */
function requireRevision(layout: StitchLayout, revision: number): void {
    if (layout.revision !== revision) {
        throw new ApiError('apiError.imagery.layoutStale', { revision: String(layout.revision) });
    }
}

/** The owner's tiles get a run of their own, whatever the runs before them used (as the owner's pairs do). */
function attemptForLayout(job: JobDoc): Pick<JobDoc, 'attempt'> {
    return (job.attempt ?? 0) >= JOB_MAX_ATTEMPTS ? { attempt: JOB_MAX_ATTEMPTS - 1 } : {};
}

/** What a resume needs: where, the answer made of the help that waits, who and when. */
export interface LayoutResume {
    readonly cityId: string;
    readonly versionId: string;
    readonly revision: number;
    readonly answer: (help: HelpItem, stamp: { readonly by: string; readonly at: LayoutAnswer['at'] }) => LayoutAnswer;
    readonly by: string;
    readonly now: Date;
}

/** Checks the series and the revision, writes the answer and queues the job from `place`; the job's id. */
export async function resumeWithLayout(transaction: DocumentTransaction, resume: LayoutResume): Promise<string> {
    const versionPath = FIRESTORE_PATHS.layerVersion(resume.cityId, resume.versionId);
    const jobPath = FIRESTORE_PATHS.job(resume.cityId, resume.versionId);
    const wait = requireLayoutWait(await transaction.get(versionPath, layerVersionDocSchema), await transaction.get(jobPath, jobDocSchema));
    requireRevision(wait.layout, resume.revision);
    const stamp = stampOf(resume.by, resume.now);
    const layoutAnswer = resume.answer(wait.help, { by: resume.by, at: stamp.updatedAt });
    await transaction.set(versionPath, layerVersionDocSchema, {
        ...omit(wait.version, ['error']),
        state: 'processing',
        help: { ...wait.help, layoutAnswer },
        ...stamp,
    });
    await transaction.set(jobPath, jobDocSchema, {
        ...omit(wait.job, ['waitReason', 'error', 'placingPoints', 'finishedAt', 'lease', 'retryAt', 'executionName']),
        ...attemptForLayout(wait.job),
        status: 'queued',
        steps: { ...wait.job.steps, place: { status: 'pending' as const } },
        ...stamp,
    });
    return wait.version.jobId;
}
