/**
 * The admin's field measurements (docs/ARCHITECTURE.md → *Field measurements*, docs/research/DECISIONS-for-review.md
 * §76), read from what the admin already does, so no feature changes for them:
 *
 * - {@link FieldWatch} follows the app's state: the time from the navigation to the signed-in shell (`admin_ready`), each
 *   Setup step's check (`busy` on, then off: `setup_check` with its state and error code), Provision's outcome per item
 *   (`provision_item`) and each install build the admin saw running end (`install_build`: its target, outcome, Cloud
 *   Build's own duration and the failing step's name, never a log line);
 * - {@link measuredStore} wraps the editors' Firestore: each write's latency and outcome (`editor_save`, by area) and the
 *   jobs the admin saw unfinished end (`job_done`: from the job's creation to the admin seeing it done).
 *
 * Telemetry sends them after the admin's consent only (`telemetry.ts`).
 */
import type { GaParams, Schema } from '@hcm/shared';

import type { BatchWrite, ContentQuery, ContentStore, Stored, StoredPage, StoreFailure, WriteOutcome } from '../content/services.js';
import { isRunning, type InstallTargetView } from '../install/model.js';
import type { SetupState } from '../setup/state.js';
import type { AdminState } from '../state/state.js';
import type { Measure } from './telemetry.js';

/** The auth states in which the shell shows the admin's own screens (start-up mode's Setup included). */
const SHELL_STATES: ReadonlySet<string> = new Set(['admin', 'bootstrap']);
const INSTALL_TARGETS = ['server', 'pipeline', 'site'] as const;
type StepRecord = SetupState['steps'][keyof SetupState['steps']];

interface CheckResult {
    readonly outcome: string;
    readonly error: string | undefined;
}

/** The Setup state of the app's state, when the Assistant runs (the entry's `SetupState`; tests may give others). */
function setupOf(setup: unknown): SetupState | null {
    return typeof setup === 'object' && setup !== null && 'steps' in setup && 'install' in setup ? (setup as SetupState) : null;
}

/** Milliseconds between two ISO times, or undefined when either is missing or unreadable. */
function between(start: string | null, end: string | null): number | undefined {
    const duration = Date.parse(end ?? '') - Date.parse(start ?? '');
    return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function defined(params: Readonly<Record<string, string | number | boolean | undefined>>): GaParams {
    return Object.fromEntries(
        Object.entries(params).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
    );
}

export class FieldWatch {
    readonly #measure: Measure;
    /** `performance.now()`: milliseconds since the navigation started. */
    readonly #now: () => number;
    #ready = false;
    #signedOut = false;
    #previous: SetupState | null = null;
    readonly #since = new Map<string, number>();

    constructor(measure: Measure, now: () => number) {
        this.#measure = measure;
        this.#now = now;
    }

    observe(state: Pick<AdminState, 'auth' | 'setup'>): void {
        this.#auth(state.auth);
        const setup = setupOf(state.setup);
        const previous = this.#previous;
        this.#previous = setup;
        if (setup !== null && previous !== null && setup !== previous) {
            this.#setup(previous, setup);
        }
    }

    /** The first signed-in shell; `restored` unless the admin had to sign in on this page. */
    #auth(auth: string): void {
        if (this.#ready) {
            return;
        }
        this.#signedOut ||= auth === 'signedOut';
        if (SHELL_STATES.has(auth)) {
            this.#ready = true;
            this.#measure({ name: 'admin_ready', params: { duration_ms: Math.round(this.#now()), restored: !this.#signedOut } });
        }
    }

    #setup(previous: SetupState, next: SetupState): void {
        this.#busy('all', previous.checking, next.checking, () => ({
            outcome: next.ready ? 'ready' : 'not_ready',
            error: next.error?.key,
        }));
        for (const id of next.order) {
            this.#step(previous.steps[id], next.steps[id], next);
        }
        for (const target of INSTALL_TARGETS) {
            this.#install(previous.install[target], next.install[target]);
        }
    }

    #step(before: StepRecord, after: StepRecord, setup: SetupState): void {
        const ended = this.#busy(after.id, before.busy, after.busy, () => ({ outcome: after.state, error: after.error?.key }));
        if (ended && after.id === 'provision') {
            for (const item of setup.provision.items) {
                this.#measure({ name: 'provision_item', params: { item: item.id, outcome: item.state } });
            }
        }
    }

    /** A check that starts (busy on) is timed until it ends (busy off); returns whether it just ended. */
    #busy(step: string, before: boolean, after: boolean, result: () => CheckResult): boolean {
        if (before === after) {
            return false;
        }
        if (after) {
            this.#since.set(step, this.#now());
            return false;
        }
        return this.#ended(step, result);
    }

    #ended(step: string, result: () => CheckResult): boolean {
        const start = this.#since.get(step);
        if (start === undefined) {
            return false;
        }
        this.#since.delete(step);
        const { outcome, error } = result();
        const params = defined({ step, outcome, error_code: error, duration_ms: Math.round(this.#now() - start) });
        this.#measure({ name: 'setup_check', params });
        return true;
    }

    /** A build the admin saw running that ended: Cloud Build's own duration, the step that failed. */
    #install(before: InstallTargetView, after: InstallTargetView): void {
        if (!isRunning(before.state) || isRunning(after.state)) {
            return;
        }
        const params = defined({
            target: after.target,
            outcome: after.state,
            duration_ms: between(after.startedAt, after.finishedAt),
            failed_step: after.failedStep ?? undefined,
        });
        this.#measure({ name: 'install_build', params });
    }
}

/** The area a document path belongs to: `cities/{city}/photos/{id}` is `photos`, `cities/{city}` is `city`. */
export function areaOf(path: string): string {
    const [root, , collection] = path.split('/');
    const area = root === 'cities' ? (collection ?? 'city') : (root ?? '');
    return /^[A-Za-z][\w-]{0,39}$/.test(area) ? area : 'other';
}

const FINAL_JOB_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

interface JobFields {
    readonly type?: unknown;
    readonly status?: unknown;
    readonly createdAt?: { readonly seconds?: unknown };
}

/** A job's `createdAt` (a Firestore timestamp) in epoch milliseconds, else `fallback`. */
function createdMs(data: JobFields, fallback: number): number {
    const seconds = data.createdAt?.seconds;
    return typeof seconds === 'number' ? seconds * 1000 : fallback;
}

/** The jobs the admin saw unfinished; each one's end is measured once. */
class JobWatch {
    readonly #unfinished = new Set<string>();
    readonly #measure: Measure;
    readonly #epoch: () => number;

    constructor(measure: Measure, epoch: () => number) {
        this.#measure = measure;
        this.#epoch = epoch;
    }

    seen(id: string, data: JobFields): void {
        const status = typeof data.status === 'string' ? data.status : '';
        if (!FINAL_JOB_STATUSES.has(status)) {
            this.#unfinished.add(id);
            return;
        }
        if (this.#unfinished.delete(id)) {
            const now = this.#epoch();
            const params = { job_type: String(data.type), status, duration_ms: Math.max(0, Math.round(now - createdMs(data, now))) };
            this.#measure({ name: 'job_done', params });
        }
    }
}

export interface MeasuredStoreDeps {
    readonly measure: Measure;
    /** A monotonic clock (`performance.now()`) for the writes' latency. */
    readonly now: () => number;
    /** Epoch milliseconds (the jobs' `createdAt` is the server's). */
    readonly epoch: () => number;
}

const JOB_DOC = /\/jobs\/[^/]+$/;

/** The editors' Firestore with each write and each job's end measured (see the module comment). */
export function measuredStore(store: ContentStore, deps: MeasuredStoreDeps): ContentStore {
    const jobs = new JobWatch(deps.measure, deps.epoch);
    const timed = async (operation: string, path: string, write: () => Promise<WriteOutcome>): Promise<WriteOutcome> => {
        const start = deps.now();
        const report = (outcome: string): void => {
            const params = { area: areaOf(path), operation, outcome, duration_ms: Math.round(deps.now() - start) };
            deps.measure({ name: 'editor_save', params });
        };
        try {
            const outcome = await write();
            report(outcome.ok ? 'ok' : outcome.reason);
            return outcome;
        } catch (error) {
            report('error');
            throw error;
        }
    };
    return {
        watchDoc: (path, schema, listener, failed) =>
            store.watchDoc(path, schema, JOB_DOC.test(path) ? watchedJob(jobs, listener) : listener, failed),
        watchQuery: <T>(
            ...[collection, schema, query, listener, failed]: [
                collection: string,
                schema: Schema<T>,
                query: ContentQuery,
                listener: (page: StoredPage<T>) => void,
                failed: (failure: StoreFailure) => void,
            ]
        ) => store.watchQuery(collection, schema, query, collection.endsWith('/jobs') ? watchedJobs(jobs, listener) : listener, failed),
        count: (collection, query) => store.count(collection, query),
        update: (path, fields, expected) => timed('update', path, () => store.update(path, fields, expected)),
        create: (path, data, options) => timed('create', path, () => store.create(path, data, options)),
        remove: (path, expected) => timed('remove', path, () => store.remove(path, expected)),
        batch: (writes: readonly BatchWrite[]) => timed('batch', writes[0]?.path ?? '', () => store.batch(writes)),
        newId: () => store.newId(),
    };
}

function watchedJob<T>(jobs: JobWatch, listener: (doc: Stored<T> | null) => void): (doc: Stored<T> | null) => void {
    return (doc) => {
        if (doc !== null) {
            jobs.seen(doc.id, doc.data as JobFields);
        }
        listener(doc);
    };
}

function watchedJobs<T>(jobs: JobWatch, listener: (page: StoredPage<T>) => void): (page: StoredPage<T>) => void {
    return (page) => {
        for (const doc of page.docs) {
            jobs.seen(doc.id, doc.data as JobFields);
        }
        listener(page);
    };
}
