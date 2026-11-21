/**
 * What a cloud run of a job would use (`docs/research/M7-local-worker.md` §4.1, §4.3), as the version page shows it
 * beside the month's use: the phases still to run (the download phase on the small `fetch` job while `DOWNLOAD_STEPS` are
 * pending, then the processing phase on `xl` for a KH-9 panoramic frame or after an escalation, else `std`), each for
 * its `CLOUD_RUN_ESTIMATE_SECONDS` on its machine's vCPUs and GiB. The dispatcher's own figure is the server's.
 */
import {
    CLOUD_RUN_ESTIMATE_SECONDS,
    DOWNLOAD_STEPS,
    JOB_MACHINE_SIZES,
    JOB_STEPS,
    SENSOR_SPECS,
    type JobDoc,
    type JobMachine,
    type Sensor,
} from '@hcm/shared';

/** vCPU-seconds and GiB-seconds of Cloud Run. */
export interface CloudRunUse {
    readonly vcpuSeconds: number;
    readonly gibSeconds: number;
}

/** True while the job's type downloads and a download step is neither done nor skipped. */
function downloadPending(job: JobDoc): boolean {
    const steps = job.steps ?? {};
    const types: readonly string[] = JOB_STEPS[job.type];
    return DOWNLOAD_STEPS.some((step) => types.includes(step) && !['done', 'skipped'].includes(steps[step]?.status ?? 'pending'));
}

/** The processing phase's machine: `xl` once escalated or for the camera that needs it, else `std`. */
function processMachine(job: JobDoc): JobMachine {
    const sensor = job.params['sensor'];
    const camera = typeof sensor === 'string' && sensor in SENSOR_SPECS ? SENSOR_SPECS[sensor as Sensor].machine : 'std';
    return job.machine === 'xl' ? 'xl' : camera;
}

/** The download phase's machine: `fetch`, unless an out-of-memory exit moved it to a larger one. */
function downloadMachine(job: JobDoc): JobMachine {
    return job.machine === undefined || job.machine === 'fetch' ? 'fetch' : job.machine;
}

/** The machines of the phases still to run, in order. */
function phases(job: JobDoc): readonly JobMachine[] {
    return downloadPending(job) ? [downloadMachine(job), processMachine(job)] : [processMachine(job)];
}

/** The estimate of the job's cloud run. */
export function estimateCloudRun(job: JobDoc): CloudRunUse {
    return phases(job).reduce<CloudRunUse>(
        (sum, machine) => {
            const seconds = CLOUD_RUN_ESTIMATE_SECONDS[machine];
            const size = JOB_MACHINE_SIZES[machine];
            return { vcpuSeconds: sum.vcpuSeconds + seconds * size.vcpu, gibSeconds: sum.gibSeconds + seconds * size.gib };
        },
        { vcpuSeconds: 0, gibSeconds: 0 },
    );
}
