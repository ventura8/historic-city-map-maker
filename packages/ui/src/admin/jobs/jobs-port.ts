/**
 * The jobs area as its page reads it (`docs/research/M2c-interfaces.md` §9.3), mirroring `packages/admin/src/jobs/jobs.ts`
 * (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { JobWaitReason } from '@hcm/shared';

import type { DocStatePort, ListStatePort } from '../area-port.js';
import type { GuardPort } from '../imagery/guard-port.js';
import type { WorkerFeedPort } from '../worker/worker-port.js';

export type JobFilterPort = 'all' | 'active' | 'failed' | 'done';

export type JobStatusPort =
    | 'queued'
    | 'starting'
    | 'running'
    | 'waiting_usgs'
    | 'mts_processing'
    | 'awaiting_approval'
    | 'awaiting_gcps'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export interface JobItemPort {
    readonly id: string;
    readonly type: string;
    readonly status: JobStatusPort;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly { readonly name: string; readonly status: string }[];
    readonly createdBy: string;
    readonly createdAt: string;
    readonly dispatchAt: string | null;
    readonly cancelRequested: boolean;
    /** Pause (2026-11-13): the owner paused it. */
    readonly paused: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
    // M3 (CR-M3-5): why it waits and until when, its layer version, and whether Retry is offered.
    readonly waitReason: JobWaitReason | null;
    readonly retryAt: string | null;
    readonly versionId: string | null;
    readonly retryable: boolean;
    /** Lesson 728: the USGS scene Run again with the latest pipeline imports again, or null. */
    readonly rerunScene: string | null;
}

export interface JobLogLinePort {
    readonly seq: number;
    readonly level: 'info' | 'warn' | 'error';
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

export interface JobsViewState {
    readonly filter: JobFilterPort;
    readonly list: ListStatePort<JobItemPort>;
    readonly detail: { readonly id: string; readonly job: DocStatePort<JobItemPort>; readonly logs: ListStatePort<JobLogLinePort> } | null;
    readonly cancelling: boolean;
    readonly retrying: boolean;
    /** Lesson 728: Run again with the latest pipeline is on its way. */
    readonly rerunning: boolean;
    /** The budget guard (null while reading; CR-M3-47). */
    readonly guard: GuardPort | null;
    readonly resuming: boolean;
    /** Pause all or Resume all is on its way. */
    readonly pausingAll: boolean;
}

export interface JobsIntentsPort {
    setFilter(filter: JobFilterPort): void;
    more(): void;
    retry(): void;
    cancel(): Promise<unknown>;
    retryJob(): Promise<unknown>;
    /** Lesson 728: the open job's scene imported again on the latest pipeline. */
    runAgain(): Promise<unknown>;
    resumeGuard(): Promise<unknown>;
    /** Pause all or Resume all (2026-11-13). */
    pauseAll(action: 'pause' | 'resume'): Promise<unknown>;
    /** M7: a new feed of the city's local worker (the lazy `worker` chunk); optional, so a page without it shows none. */
    worker?(): Promise<WorkerFeedPort>;
    /** M7: registers the `worker` chunk's elements (`../worker/load.ts`). */
    workerElements?(): Promise<void>;
}
