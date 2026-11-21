/**
 * M7's local worker as its elements read it (`docs/research/M7-local-worker.md` §7), mirroring
 * `packages/admin/src/worker/feed.ts` structurally (`packages/admin/test/app/admin-port.test.ts` checks it at compile
 * time). The elements get their feed from the Jobs area's store (`JobsIntentsPort.worker`), which the page they sit on
 * loads through the app (`WorkerHostPort`: the Jobs page, the pipeline card, a version's page).
 */
import type {
    JobStatus,
    JobWaitReason,
    RunChoice,
    RunPlace,
    WorkerAi,
    WorkerMachine,
    WorkerProfileChoice,
    WorkerRemoval,
    WorkerShare,
    WorkerStarterUpdate,
} from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';

export interface CloudRunUsePort {
    readonly vcpuSeconds: number;
    readonly gibSeconds: number;
}

/** Pause (2026-11-13): who paused a job or a computer (an account, or `computer`), when, and until when (ISO, or null). */
interface PausedPort {
    readonly by: string;
    readonly at: string;
    readonly until: string | null;
}

/** The three ways to pause a computer. */
export type PauseLengthPort = 'forever' | 'hour' | 'tomorrow';

export interface WorkerSeenPort {
    readonly id: string;
    readonly state: 'idle' | 'busy';
    readonly seenAt: string;
    readonly jobId: string | null;
    readonly lastJob: { readonly id: string; readonly outcome: 'done' | 'failed'; readonly at: string } | null;
    /** The pipeline version it runs. */
    readonly version: string;
    readonly outdated: boolean;
    readonly revoked: boolean;
    /** Its local AI (`docs/research/M10-local-ai.md`), or null for a worker older than it. */
    readonly ai: WorkerAi | null;
    /** Pause this computer: who, when, until when; null while it works. */
    readonly paused: PausedPort | null;
}

export interface WorkerJobPort {
    readonly id: string;
    readonly status: JobStatus;
    readonly runOn: RunPlace | null;
    readonly waitReason: JobWaitReason | null;
    readonly estimate: CloudRunUsePort;
    readonly step: string | null;
    readonly progress: number | null;
    readonly overdue: boolean;
    /** M20: its files are only on the computer (an archive's series): the cloud is never offered. */
    readonly localOnly?: boolean;
    /** Pause: who paused it and when; null while it is not paused. */
    readonly paused: PausedPort | null;
}

export interface WorkerViewPort {
    readonly city: string;
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    readonly worker: WorkerSeenPort | null;
    readonly connected: boolean;
    readonly choice: RunChoice;
    /** The pipeline image's digest; null without one, undefined while asked for. */
    readonly image: string | null | undefined;
    readonly usage: CloudRunUsePort;
    readonly job: WorkerJobPort | null;
    readonly acting: boolean;
    readonly refusal: AdminNoticeInputPort | null;
}

/** The systems a starter file is made for (finding 72). */
export type WorkerOsPort = 'linux' | 'mac' | 'windows';

/** A starter file as its link gives it (finding 73 of 2026-11-03): `worker.starter`'s address and the file's name. */
export interface StarterLinkPort {
    readonly url: string;
    readonly name: string;
}

/** M26's "This computer" (`packages/admin/src/worker/machine.ts`): nothing heard yet, a worker older than the governor, or its word. */
export type MachineViewPort =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'old' }
    | { readonly kind: 'known'; readonly machine: WorkerMachine; readonly failed: boolean };

/** The worker's and its starter file's versions beside the installed release's (`packages/admin/src/worker/machine.ts`). */
export interface VersionsViewPort {
    readonly said: boolean;
    readonly image: string | null;
    readonly imageCurrent: boolean;
    readonly starter: string | null;
    readonly starterCurrent: boolean;
    readonly update: WorkerStarterUpdate | null;
}

/** "Use this computer" as `packages/admin/src/worker/local.ts` keeps it (finding 72 of 2026-11-02). */
export interface LocalViewPort {
    readonly os: WorkerOsPort;
    readonly phase: 'none' | 'downloaded' | 'looking' | 'connecting' | 'connected' | 'stopped';
    /** The Advanced command's one-time code (null until Advanced asked for one). */
    readonly code: string | null;
    /** Finding 73: whether the server makes the starter file; null until it answered. */
    readonly starter: boolean | null;
    /** The starter file and the removal file for `os`. */
    readonly files: { readonly install: StarterLinkPort; readonly uninstall: StarterLinkPort };
    /** M26: what the worker says of this computer. */
    readonly machine: MachineViewPort;
    /** The worker's and its starter's versions; null until it answered. */
    readonly versions: VersionsViewPort | null;
}

/** This computer's part of the panel: the starter file, the auto-pair, Stop using this computer, the Advanced command. */
export interface LocalPort {
    readonly state: LocalViewPort;
    subscribe(listener: (state: LocalViewPort) => void): () => void;
    readonly intents: {
        setOs(os: WorkerOsPort): void;
        use(): void;
        find(): void;
        stop(): Promise<void>;
        command(): Promise<void>;
        profile(choice: WorkerProfileChoice): Promise<void>;
    };
    start(): void;
    stop(): void;
}

/** W5: one of the city's computers (`packages/admin/src/worker/household.ts`). */
export interface ComputerViewPort {
    readonly id: string;
    readonly name: string | null;
    readonly online: boolean;
    readonly state: 'idle' | 'busy';
    readonly jobId: string | null;
    readonly paused: boolean;
    readonly share: WorkerShare | null;
    readonly os: WorkerOsPort;
    readonly starter: string | null;
    readonly starterCurrent: boolean;
    readonly version: string;
    readonly outdated: boolean;
    readonly seenAt: string;
    readonly removal: Omit<WorkerRemoval, 'askedAt'> | null;
    readonly revoked: boolean;
    /** Cleanup item 6: the worker's disk (null: not said), "Free space now" pending, and what the last one freed. */
    readonly disk: { readonly workBytes: number; readonly freeBytes: number; readonly floorBytes: number } | null;
    readonly freeing: boolean;
    readonly freed: { readonly bytes: number; readonly at: string } | null;
    /** M20 §22: the scanned maps it shares with the other computers now, how far, or stopped for today; null otherwise. */
    readonly sharing: {
        readonly state: 'sending' | 'dayLimit';
        readonly computers: number;
        readonly sentBytes: number;
        readonly totalBytes: number;
    } | null;
}

export type AddKindPort = WorkerOsPort | 'headless';

export interface HouseholdViewPort {
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    readonly computers: readonly ComputerViewPort[];
    readonly adding: AddKindPort | null;
    readonly code: string | null;
    readonly expiresAt: string | null;
    readonly codeFailed: boolean;
    readonly line: string | null;
    readonly link: string;
    readonly acting: string | null;
    readonly refusal: AdminNoticeInputPort | null;
}

/** W5: the city's computers, Add another computer and Remove this computer. */
export interface HouseholdPort {
    readonly state: HouseholdViewPort;
    cleanup(os: WorkerOsPort): string;
    subscribe(listener: (state: HouseholdViewPort) => void): () => void;
    readonly intents: {
        add(kind: AddKindPort | null): void;
        mint(): Promise<void>;
        rename(id: string, name: string): Promise<boolean>;
        pause(id: string): Promise<boolean>;
        resume(id: string): Promise<boolean>;
        freeSpace(id: string): Promise<boolean>;
        remove(id: string, options: { readonly docker: boolean; readonly keep: boolean }): Promise<boolean>;
        disconnect(id: string): Promise<boolean>;
        retry(): void;
    };
    start(): void;
    stop(): void;
}

interface WorkerIntentsPort {
    setChoice(choice: RunChoice): Promise<boolean>;
    runJob(runOn: RunPlace, freeTierOk: boolean): Promise<boolean>;
    retry(): void;
    disconnect(): Promise<boolean>;
    /** Finding 72: this computer's part, from the lazy `worker-local` chunk (its element registered first). */
    local(project: string): Promise<LocalPort>;
    /** Pause or Resume the watched job. */
    pauseJob(action: 'pause' | 'resume'): Promise<boolean>;
    /** Pause the panel's computer for a length, or Resume it (null). */
    pauseComputer(length: PauseLengthPort | null): Promise<boolean>;
    /** W5: the city's computers, from the lazy `worker-household` chunk (its element registered first). */
    household(project: string): Promise<HouseholdPort>;
}

/** One element's feed: started when it connects (with its version's job, if any), stopped when it goes. */
export interface WorkerFeedPort {
    readonly state: WorkerViewPort;
    subscribe(listener: (state: WorkerViewPort) => void): () => void;
    readonly intents: WorkerIntentsPort;
    start(jobId: string | null): void;
    stop(): void;
}

/** What the elements need of the admin app (`AdminAppPort`): the Jobs area's chunk and its store, which hands out feeds. */
export interface WorkerHostPort {
    loadPage(id: 'jobs'): Promise<unknown>;
    readonly content: {
        readonly jobs: { readonly intents: { worker?(): Promise<WorkerFeedPort>; workerElements?(): Promise<void> } } | null;
    };
}
