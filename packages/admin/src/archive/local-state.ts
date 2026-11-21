/**
 * Batch 4: what the admin's Import local files shares between the `archive` chunk (the feed's state) and the lazy `local-run` chunk that
 * talks to the worker (`local-import.ts`, `local-transport.ts`): the state, its idle value and the loopback's port.
 */
/** Where the import stands: nothing yet, sending files, the worker's scan, done, failed (with why) or cancelled. */
type LocalPhase = 'idle' | 'upload' | 'scan' | 'done' | 'failed' | 'cancelled';

/** The admin card's view of it: the phase, a share from 0 to 100, what is done of how many, and why it failed. */
export interface LocalImportState {
    readonly phase: LocalPhase;
    readonly percent: number;
    readonly done: number;
    readonly total: number;
    /** `notPaired`, `refused` (a file or the zip), `unreachable` (no worker answered) or the scan's error code. */
    readonly error: string | null;
}

export const LOCAL_IDLE: LocalImportState = { phase: 'idle', percent: 0, done: 0, total: 0, error: null };

/** One file picked in the browser, with its path inside the folder (or the zip's own name). */
export interface LocalFile {
    readonly path: string;
    readonly file: Blob;
}

export interface LocalAnswer {
    readonly status: number;
    readonly body: Readonly<Record<string, unknown>>;
}

/** One file's upload: where, what, its headers, its abort and how much of it is sent. */
export interface LocalUpload {
    readonly path: string;
    readonly file: Blob;
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
    readonly progress: (loaded: number) => void;
}

/** The loopback, the external boundary the tests fake: JSON requests, and one file's upload with its progress. */
export interface LocalTransport {
    json(path: string, body: unknown, headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<LocalAnswer>;
    upload(upload: LocalUpload): Promise<number>;
}
