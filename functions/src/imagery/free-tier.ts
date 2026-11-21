/**
 * Cloud Run's free tier (`docs/research/M7-local-worker.md` §4.1, §4.3; S-A63-*): before a cloud run that is not a
 * hand-over from the download job, and without the admin's OK (`job.freeTierOk`), the month's counted use
 * (`usage/cloudrun-<month>`, absent = nothing yet) plus the job's estimate must stay within `CLOUD_RUN_FREE_TIER` on both
 * figures; otherwise the job waits (`waitReason: 'free-tier'`), and one made by automation (a `system:` writer, or the
 * order watch importing a delivered scan) leaves an inbox item, `job.needsOk`, whose link opens the version.
 */
import {
    CLOUD_RUN_ESTIMATE_SECONDS,
    CLOUD_RUN_FREE_TIER,
    FIRESTORE_PATHS,
    JOB_MACHINE_SIZES,
    cloudRunUsageDocSchema,
    layerVersionDocSchema,
    usageMonth,
    usgsSceneDocSchema,
    type JobDoc,
    type JobMachine,
} from '@hcm/shared';

import { emitNotification, type EmitDeps } from '../api/notification-event.js';
import type { DocumentStore } from '../ports/documents.js';
import { labelParams } from './job-notices.js';
import { downloadPending, handedOver, machineOf, processingMachine } from './machine.js';
import { versionIdOf } from './records.js';

/** Cloud Run use in vCPU-seconds and GiB-seconds. */
export interface CloudRunUse {
    readonly vcpuSeconds: number;
    readonly gibSeconds: number;
}

function phase(machine: JobMachine, seconds: number): CloudRunUse {
    const size = JOB_MACHINE_SIZES[machine];
    return { vcpuSeconds: seconds * size.vcpu, gibSeconds: seconds * size.gib };
}

function sum(uses: readonly CloudRunUse[]): CloudRunUse {
    return uses.reduce(
        (total, use) => ({ vcpuSeconds: total.vcpuSeconds + use.vcpuSeconds, gibSeconds: total.gibSeconds + use.gibSeconds }),
        {
            vcpuSeconds: 0,
            gibSeconds: 0,
        },
    );
}

/**
 * The estimate of the phases still to run: the download phase (`CLOUD_RUN_ESTIMATE_SECONDS.fetch` on the machine it runs
 * on) while a download step is pending, then the processing phase on `xl` for a KH-9 panoramic frame or after an
 * escalation, else `std`.
 */
export function estimateCloudRun(job: JobDoc): CloudRunUse {
    const processing = processingMachine(job);
    const download = downloadPending(job) ? [phase(machineOf(job), CLOUD_RUN_ESTIMATE_SECONDS.fetch)] : [];
    return sum([...download, phase(processing, CLOUD_RUN_ESTIMATE_SECONDS[processing])]);
}

/** This month's counted use (nothing before the first counted run). */
async function cloudRunUseOf(documents: DocumentStore, now: Date): Promise<CloudRunUse> {
    const usage = await documents.get(FIRESTORE_PATHS.cloudRunUsage(usageMonth(now)), cloudRunUsageDocSchema);
    return { vcpuSeconds: usage?.vcpuSeconds ?? 0, gibSeconds: usage?.gibSeconds ?? 0 };
}

/** True when the use plus the estimate passes either figure of the free tier. */
export function passesFreeTier(use: CloudRunUse, estimate: CloudRunUse): boolean {
    return (
        use.vcpuSeconds + estimate.vcpuSeconds > CLOUD_RUN_FREE_TIER.vcpuSeconds ||
        use.gibSeconds + estimate.gibSeconds > CLOUD_RUN_FREE_TIER.gibSeconds
    );
}

/** True when this cloud dispatch must wait for the admin's OK (never a hand-over, never a job with the OK). */
export async function needsFreeTierOk(documents: DocumentStore, job: JobDoc, now: Date): Promise<boolean> {
    if (handedOver(job) || job.freeTierOk !== undefined) {
        return false;
    }
    return passesFreeTier(await cloudRunUseOf(documents, now), estimateCloudRun(job));
}

/** An import the order watch started for a delivered scan (stamped with the admin who ordered it, but nobody clicked). */
async function fromOrder(documents: DocumentStore, cityId: string, jobId: string, job: JobDoc): Promise<boolean> {
    const entityId = job.params['entityId'];
    if (job.type !== 'usgs-import' || typeof entityId !== 'string') {
        return false;
    }
    const scene = await documents.get(FIRESTORE_PATHS.usgsScene(cityId, entityId), usgsSceneDocSchema).catch(() => undefined);
    return scene?.order?.importJobId === jobId;
}

/** A job made by automation: a server writer created it, or the order watch did. */
async function automated(documents: DocumentStore, cityId: string, jobId: string, job: JobDoc): Promise<boolean> {
    return job.createdBy.startsWith('system:') || fromOrder(documents, cityId, jobId, job);
}

/** The inbox item of an automated job that waits for the OK (`job.needsOk`, once per job). */
export async function askForOk(deps: EmitDeps, cityId: string, jobId: string, job: JobDoc): Promise<boolean> {
    if (!(await automated(deps.documents, cityId, jobId, job))) {
        return false;
    }
    const versionId = versionIdOf(jobId, job);
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema).catch(() => undefined);
    return emitNotification(deps, 'imagery', {
        kind: 'job.needsOk',
        parts: [cityId, jobId],
        params: labelParams(version, job),
        link: `#/imagery/version/${versionId}`,
        cityId,
    });
}
