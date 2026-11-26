/**
 * The Cloud Run job a raster job's next phase needs (finding 56 of 2026-11-01): an import's download on the small `fetch`
 * job, then its processing on `std`, or on `xl` for a KH-9 panoramic frame or after an out-of-memory exit. Shared by the
 * dispatcher (`dispatch.ts`) and the free-tier estimate (`free-tier.ts`, `docs/research/M7-local-worker.md` §4.3).
 */
import { DOWNLOAD_STEPS, JOB_STEPS, SENSOR_SPECS, type JobDoc, type JobMachine, type Sensor } from '@hcm/shared';

/** The machine the job's camera needs (`SENSOR_SPECS`: a KH-9 panoramic strip does not fit in 16 GiB). */
function sensorMachine(job: JobDoc): 'std' | 'xl' {
    const sensor = job.params['sensor'];
    return typeof sensor === 'string' && sensor in SENSOR_SPECS ? SENSOR_SPECS[sensor as Sensor].machine : 'std';
}

/** True while an import's download phase (`DOWNLOAD_STEPS`) has a step neither done nor skipped. */
export function downloadPending(job: JobDoc): boolean {
    const steps = job.steps ?? {};
    const types: readonly string[] = JOB_STEPS[job.type];
    return DOWNLOAD_STEPS.some((step) => types.includes(step) && !['done', 'skipped'].includes(steps[step]?.status ?? 'pending'));
}

/**
 * The machine a job needs (finding 56 of 2026-11-01): the small `fetch` job for an import's download phase (unless an
 * out-of-memory exit moved it to `std`), then `xl` for a KH-9 panoramic frame or after an out-of-memory exit, else `std`.
 */
export function machineOf(job: JobDoc): JobMachine {
    if (job.machine === 'xl') {
        return 'xl';
    }
    if (downloadPending(job)) {
        return job.machine === 'std' ? 'std' : 'fetch';
    }
    return sensorMachine(job);
}

/** The processing phase's machine: `xl` after an escalation or for a KH-9 panoramic frame, else `std`. */
export function processingMachine(job: JobDoc): 'std' | 'xl' {
    return job.machine === 'xl' ? 'xl' : sensorMachine(job);
}

/** A dispatch after the download phase ended on the small job is the same try going on, not a new one. */
export function handedOver(job: JobDoc): boolean {
    return job.machine === 'fetch' && !downloadPending(job);
}
