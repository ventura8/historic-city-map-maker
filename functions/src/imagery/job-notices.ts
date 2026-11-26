/**
 * What `imagery.onJobWrite` tells the admins (`docs/research/M4-interfaces.md` §5.1, CR-M4-8; S-A46-HAPPY-PRODUCERS):
 * a job that becomes `failed` (`job.failed`, one event per attempt), a version waiting for Approve after the approval
 * policy left it there (`layer.readyToApprove`), and one waiting for points in the georeferencer (`layer.needsPoints`).
 * Read after the dispatcher's own action, so an automatic approval is seen and not announced. Emitting never fails the
 * dispatcher (`emitNotification`); a redelivered write finds its event and writes nothing. M8: a frame a live join holds
 * is not announced as ready: its Approve is refused, and the join is what the admin approves.
 */
import {
    FIRESTORE_PATHS,
    layerVersionDocSchema,
    type JobDoc,
    type JobStatus,
    type LayerVersionDoc,
    type NotificationKind,
} from '@hcm/shared';

import { emitNotification, type EmitDeps } from '../api/notification-event.js';
import { liveJoinOf } from './join-parts.js';
import { versionIdOf } from './records.js';

type JobNotice = Extract<NotificationKind, 'job.failed' | 'layer.readyToApprove' | 'layer.needsPoints'>;

/** The status whose start each notice reports. */
const NOTICES: readonly (readonly [JobStatus, JobNotice])[] = [
    ['failed', 'job.failed'],
    ['awaiting_approval', 'layer.readyToApprove'],
    ['awaiting_gcps', 'layer.needsPoints'],
];

/** The notice a write calls for: a status the job reached with this write. */
export function noticeOf(before: JobDoc | undefined, after: JobDoc): JobNotice | undefined {
    return NOTICES.find(([status]) => after.status === status && before?.status !== status)?.[1];
}

/** The version's label in both languages, or the job's type for a job without a version (a layer's deletion). */
export function labelParams(version: LayerVersionDoc | undefined, job: JobDoc): Readonly<Record<string, string>> {
    if (version === undefined) {
        return { label: job.type };
    }
    return version.label.en === undefined ? { label: version.label.ro } : { label: version.label.ro, labelEn: version.label.en };
}

function linkOf(notice: JobNotice, versionId: string, version: LayerVersionDoc | undefined): string {
    if (version === undefined) {
        return '#/jobs';
    }
    return notice === 'layer.needsPoints' ? `#/georef/${versionId}` : `#/imagery/version/${versionId}`;
}

/** The job a write is about: its city, its id and the job as written. */
interface JobWrite {
    readonly cityId: string;
    readonly jobId: string;
    readonly job: JobDoc;
}

function partsOf(notice: JobNotice, write: JobWrite, versionId: string): readonly string[] {
    return notice === 'job.failed' ? [write.cityId, write.jobId, String(write.job.attempt ?? 0)] : [write.cityId, versionId];
}

/** A version that still waits after the policy, and that no live join holds. */
async function readyForAnAdmin(deps: EmitDeps, cityId: string, version: LayerVersionDoc | undefined): Promise<boolean> {
    return version?.state === 'awaiting_approval' && (await liveJoinOf(deps.documents, cityId, version)) === undefined;
}

/** Emits the notice of this write of job `jobId` (`before` → `after`), if it calls for one. */
export async function noticeJobChange(deps: EmitDeps, write: JobWrite, before: JobDoc | undefined): Promise<void> {
    const notice = noticeOf(before, write.job);
    if (notice === undefined) {
        return;
    }
    const { cityId, job } = write;
    const versionId = versionIdOf(write.jobId, job);
    const path = FIRESTORE_PATHS.layerVersion(cityId, versionId);
    const version = await deps.documents.get(path, layerVersionDocSchema).catch(() => undefined);
    if (notice === 'layer.readyToApprove' && !(await readyForAnAdmin(deps, cityId, version))) {
        return;
    }
    await emitNotification(deps, 'imagery', {
        kind: notice,
        parts: partsOf(notice, write, versionId),
        params: labelParams(version, job),
        link: linkOf(notice, versionId, version),
        cityId,
    });
}
