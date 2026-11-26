/**
 * M26: "This computer" (`docs/research/M26-governor.md` §6), in the lazy `worker-local` chunk. The worker's `GET /state`,
 * which `local.ts` reads every `PROBE_MS` already, carries `machine`: what the governor says of the computer (cores,
 * memory, power, cards, where the matcher runs, the profile in force and why, the budget). A worker older than M26 says
 * nothing of it (`old`: the card asks to update the worker). The owner's choice (`auto`, `quiet`, `full`) is posted to
 * the worker's `POST /profile` from the admin's Hosting origin, under `/pair`'s rules; it stays on that computer.
 *
 * The same `/state` says the versions (`docs/research/M7-local-worker.md`, *The starter updates itself*): the image the worker
 * runs (`image`, and `outdated` when it is not the installed one) and the version of the starter file that runs it (`starter`),
 * which the card compares with this release's `WORKER_STARTER_VERSION` (the admin is the installed release). The image is current
 * when its digest equals the installed pipeline's (`setup/status.install.pipeline.image`); `outdated` is only the fallback while
 * that digest is unknown (a busy worker only learns `outdated` at its next claim).
 */
import {
    WORKER_STARTER_UPDATES,
    WORKER_STARTER_VERSION,
    workerMachineSchema,
    type WorkerMachine,
    type WorkerProfileChoice,
    type WorkerStarterUpdate,
} from '@hcm/shared';

/** What the card shows: nothing heard yet, a worker older than the governor, or what the governor says. */
export type MachineView =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'old' }
    | { readonly kind: 'known'; readonly machine: WorkerMachine; readonly failed: boolean };

export const UNKNOWN_MACHINE: MachineView = { kind: 'unknown' };

/** The card's view of one `/state` answer: `old` without `machine` (or with one this admin cannot read), unknown before its first tick. */
export function machineOf(answer: unknown): MachineView {
    const said = machineSaid(answer);
    if (said === null) {
        return UNKNOWN_MACHINE;
    }
    const parsed = workerMachineSchema.safeParse(said);
    return parsed.success ? { kind: 'known', machine: parsed.data, failed: false } : { kind: 'old' };
}

/** The answer's `machine` (null before the governor's first tick); undefined, which no schema takes, when it has none. */
function machineSaid(answer: unknown): unknown {
    const record = answer as { readonly machine?: unknown } | null;
    return typeof record === 'object' && record !== null && 'machine' in record ? record.machine : undefined;
}

/** The versions the card shows beside the installed release's. */
export interface VersionsView {
    /** Whether the worker says them at all: one older than this says neither. */
    readonly said: boolean;
    /** The image the worker runs, by digest (null: it does not say), and whether it is the installed release's. */
    readonly image: string | null;
    readonly imageCurrent: boolean;
    /** The starter file's version (null: none, a worker started by a command), whether it is this release's, and its last look's word. */
    readonly starter: string | null;
    readonly starterCurrent: boolean;
    readonly update: WorkerStarterUpdate | null;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STARTER_WORD = /^[a-z0-9-]{1,40}$/;

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function matching(value: unknown, pattern: RegExp): string | null {
    return typeof value === 'string' && pattern.test(value) ? value : null;
}

/**
 * Whether the worker's image is the installed pipeline's: compare digests when the installed one is known, else the
 * worker's `outdated` flag (set only on the next claim).
 */
function imageCurrentOf(image: string | null, outdated: boolean, installed: string | null): boolean {
    const wanted = matching(installed, DIGEST);
    return wanted !== null && image !== null ? image === wanted : !outdated;
}

/** The card's versions of one `/state` answer, with the installed pipeline digest when `setup.status` named one. */
export function versionsOf(answer: unknown, installed: string | null = null): VersionsView {
    const record = fieldsOf(answer);
    const starter = fieldsOf(record['starter']);
    const version = matching(starter['version'], STARTER_WORD);
    const image = matching(record['image'], DIGEST);
    return {
        said: 'starter' in record,
        image,
        imageCurrent: imageCurrentOf(image, record['outdated'] === true, installed),
        starter: version,
        starterCurrent: version === WORKER_STARTER_VERSION,
        update: WORKER_STARTER_UPDATES.find((word) => word === starter['update']) ?? null,
    };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The owner's profile posted to the worker; its new state's machine, or null when the worker did not take it. */
export async function postProfile(fetch: Fetch, worker: string, profile: WorkerProfileChoice): Promise<MachineView | null> {
    try {
        const response = await fetch(`${worker}/profile`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ profile }),
            credentials: 'omit',
        });
        return response.ok ? machineOf(await response.json()) : null;
    } catch {
        return null;
    }
}
