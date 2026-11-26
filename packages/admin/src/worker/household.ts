/**
 * W5, household computers (`docs/research/M7-local-worker.md` *Household computers*; the owner, 2026-11-13: "make it easy to use
 * not only their own computer but also the other computers in their household, with minimum input"), in the lazy
 * `worker-household` chunk:
 *
 * - **The city's computers.** Every worker of the city (`cities/{city}/workers`, live): its name (the owner's, else the
 *   computer's own), online or not (seen within `WORKER_FRESH_SECONDS`), what it does, its share of the computer (M26), its
 *   helper's and pipeline's versions. Rename, Pause and Resume are `worker.manage`.
 * - **Its disk** (cleanup item 6, 2026-11-14): what the worker's folder uses and the free space of its disk, a warning when it is below
 *   the worker's floor (it takes no new map work), and **Free space now** (`worker.manage` `freeSpace`), then what it freed.
 * - **What it shares** (M20 §22, 2026-11-14): a computer holding scanned maps sends their series to the others through the bucket,
 *   also while it works: "Sharing scanned maps with 2 computers", how far, or stopped for today at the day's limit.
 * - **Remove this computer** (the owner's order: clean up first, disconnect second, no command): `worker.manage` `remove` asks
 *   the computer's worker, at its next claim, to clean the computer up; the list follows its word (asked, cleaning, done, or
 *   failed and why). An offline computer does it when it next comes on. **Disconnect now anyway** is `worker.revoke`, and only
 *   then the list shows the line that cleans the computer up by hand.
 * - **Add another computer.** For a computer with a screen, the address of this admin to open there (sign in, then Use this
 *   computer: the auto-pair does the rest). For one without, one line to paste over SSH that carries a one-time code
 *   (`worker.pairCode` with `household`: 45 minutes, one use) on standard input, never as an argument.
 */
import {
    WORKER_FRESH_SECONDS,
    WORKER_STARTER_FILE_NAMES,
    WORKER_STARTER_VERSION,
    workerDocSchema,
    FIRESTORE_PATHS,
    type WorkerDoc,
    type WorkerOs,
    type WorkerRemoval,
    type WorkerShare,
    type WorkerSharing,
} from '@hcm/shared';

import { isoOf, LiveList, type ListState, type LoadStatus } from '../content/list.js';
import type { ContentServices, Stored, StoreFailure } from '../content/services.js';
import { refusalOf } from '../imagery/api.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';

/** How often the list looks again at who is online (a computer that stops calling goes offline without a change to read). */
const TICK_MS = 30_000;
/** A disconnected computer stays in the list this long, with how it ended. */
const GONE_MS = 24 * 3600 * 1000;
/** A copy said `sending` longer ago than this is no longer shown: the computer stopped (its next start resumes the copy). */
const SHARING_FRESH_MS = 10 * 60 * 1000;
/** The most computers one list shows. */
const COMPUTERS_MAX = 20;

/** The ways "Add another computer" offers: a computer with a screen (its system), or one without. */
export type AddKind = WorkerOs | 'headless';

interface ComputerView {
    readonly id: string;
    /** The owner's name for it, else the computer's own, else null (a helper too old to say). */
    readonly name: string | null;
    readonly online: boolean;
    readonly state: WorkerDoc['state'];
    readonly jobId: string | null;
    readonly paused: boolean;
    readonly share: WorkerShare | null;
    /** Its system, as its helper said (Linux when it did not: the cleanup line is then the POSIX one). */
    readonly os: WorkerOs;
    /** The helper's (starter's) version, and whether it is this release's. */
    readonly starter: string | null;
    readonly starterCurrent: boolean;
    readonly version: string;
    readonly outdated: boolean;
    readonly seenAt: string;
    readonly removal: Omit<WorkerRemoval, 'askedAt'> | null;
    readonly revoked: boolean;
    /** Cleanup item 6: the worker's disk as its last claim said it (null: a worker too old to say). */
    readonly disk: { readonly workBytes: number; readonly freeBytes: number; readonly floorBytes: number } | null;
    /** "Free space now" was asked and the computer has not said yet what it freed. */
    readonly freeing: boolean;
    /** What its last "Free space now" freed, and when. */
    readonly freed: { readonly bytes: number; readonly at: string } | null;
    /** M20 §22: the scanned maps it is sharing now (for how many computers, how far), or stopped for today; null otherwise. */
    readonly sharing: (Pick<WorkerSharing, 'computers' | 'sentBytes' | 'totalBytes'> & { readonly state: 'sending' | 'dayLimit' }) | null;
}

export interface HouseholdState {
    readonly status: LoadStatus;
    readonly failure: StoreFailure | null;
    readonly computers: readonly ComputerView[];
    /** The open "Add another computer" choice, or null. */
    readonly adding: AddKind | null;
    /** The headless line's one-time code and when it ends; null until minted (or when it could not be). */
    readonly code: string | null;
    readonly expiresAt: string | null;
    readonly codeFailed: boolean;
    /** The headless line with the code (`headlessLine`), or null. */
    readonly line: string | null;
    /** The address of this admin, to open on a computer with a screen. */
    readonly link: string;
    /** The computer an action is on its way for, or null. */
    readonly acting: string | null;
    readonly refusal: NoticeInput | null;
}

export interface HouseholdIntents {
    add(kind: AddKind | null): void;
    /** A new one-time code for the headless line. */
    mint(): Promise<void>;
    rename(id: string, name: string): Promise<boolean>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
    /** Free space now (cleanup item 6): the computer deletes what no job needs at its next check. */
    freeSpace(id: string): Promise<boolean>;
    remove(id: string, options: { readonly docker: boolean; readonly keep: boolean }): Promise<boolean>;
    /** Disconnect now anyway (`worker.revoke`): the last resort when the computer cannot clean itself up. */
    disconnect(id: string): Promise<boolean>;
    retry(): void;
}

/** What the class is made with besides the area's services. */
export interface HouseholdOptions {
    /** Where the server's functions answer (the project's, or the emulator's). */
    readonly functionsBase: string;
    /** The admin's own address (`location`'s origin and path). */
    readonly adminUrl: string;
}

/** The starter file's address on the server (`worker.starter`) for `os` and `action`. */
export function starterUrl(functionsBase: string, city: string, os: WorkerOs, action: 'install' | 'uninstall'): string {
    return `${functionsBase}/worker-starter?${new URLSearchParams({ city, os, action }).toString()}`;
}

/**
 * The one line for a computer without a screen (pasted over SSH): it saves the starter file and runs it with the one-time code
 * on standard input (`echo` is the shell's own: the code is never an argument of a program, and never in a file).
 */
export function headlessLine(functionsBase: string, city: string, code: string): string {
    const file = `~/${WORKER_STARTER_FILE_NAMES.install.linux}`;
    return `curl -fsSL '${starterUrl(functionsBase, city, 'linux', 'install')}' -o ${file} && echo ${code} | sh ${file}`;
}

/** The line that cleans a computer up by hand (after Disconnect now anyway): POSIX, or Windows PowerShell. */
export function cleanupLine(functionsBase: string, city: string, os: WorkerOs): string {
    const url = starterUrl(functionsBase, city, os, 'uninstall');
    if (os === 'windows') {
        return `Invoke-WebRequest '${url}' -OutFile "$env:TEMP\\hcm-worker.bat"; & "$env:TEMP\\hcm-worker.bat"`;
    }
    const file = `~/${WORKER_STARTER_FILE_NAMES.uninstall[os]}`;
    return `curl -fsSL '${url}' -o ${file} && sh ${file}`;
}

/** The removal as the list shows it: its step and choices, not when it was asked. */
function removalOf(removal: WorkerRemoval | undefined): ComputerView['removal'] {
    return removal === undefined
        ? null
        : (Object.fromEntries(Object.entries(removal).filter(([key]) => key !== 'askedAt')) as ComputerView['removal']);
}

/** What the worker said of itself: its names, its system, its helper, its share and its job. */
function saidOf(data: WorkerDoc): Pick<ComputerView, 'name' | 'os' | 'starter' | 'starterCurrent' | 'share' | 'jobId'> {
    const { os = 'linux', starter = null, share = null, jobId = null } = data;
    return { name: nameOf(data), os, starter, starterCurrent: starter === WORKER_STARTER_VERSION, share, jobId };
}

/** True while "Free space now" waits for the computer: asked, and nothing freed since. */
function waiting(asked: WorkerDoc['freeSpaceAskedAt'], freed: ComputerView['freed']): boolean {
    return asked !== undefined && (freed === null || Date.parse(freed.at) < Date.parse(isoOf(asked)));
}

/** The worker's disk (without when it said it), its pending "Free space now" and what the last one freed (cleanup item 6). */
function diskOf({ disk, freeSpaceAskedAt, freed }: WorkerDoc): Pick<ComputerView, 'disk' | 'freeing' | 'freed'> {
    const done = freed === undefined ? null : { bytes: freed.bytes, at: isoOf(freed.at) };
    const said = disk === undefined ? null : { workBytes: disk.workBytes, freeBytes: disk.freeBytes, floorBytes: disk.floorBytes };
    return { disk: said, freeing: waiting(freeSpaceAskedAt, done), freed: done };
}

/** True when the worker's sharing is worth a line now: a copy said lately, or today's limit reached today (UTC). */
function current(sharing: WorkerSharing, now: number): boolean {
    if (sharing.state === 'dayLimit') {
        return sharing.day === new Date(now).toISOString().slice(0, 10);
    }
    return sharing.state === 'sending' && Date.parse(isoOf(sharing.at)) + SHARING_FRESH_MS > now;
}

/** M20 §22: what the computer shares now, or null (nothing, a copy finished, or a word too old). */
function sharingOf({ sharing }: WorkerDoc, now: number): ComputerView['sharing'] {
    if (sharing === undefined || !current(sharing, now)) {
        return null;
    }
    const { computers, sentBytes, totalBytes } = sharing;
    return { state: sharing.state === 'dayLimit' ? 'dayLimit' : 'sending', computers, sentBytes, totalBytes };
}

/** The owner's name for it, else the computer's own, else null. */
function nameOf({ name, host }: WorkerDoc): string | null {
    return name ?? host ?? null;
}

/** One computer as the list shows it, `now` deciding whether it is online. */
function computerOf(doc: Stored<WorkerDoc>, now: number): ComputerView {
    const data = doc.data;
    const seenAt = isoOf(data.lastSeenAt);
    const revoked = data.revokedAt !== undefined;
    const online = !revoked && Date.parse(seenAt) + WORKER_FRESH_SECONDS * 1000 > now;
    return {
        ...{ id: doc.id, online, state: data.state, paused: data.pausedAt !== undefined, ...saidOf(data) },
        ...{ version: data.version, outdated: data.outdated === true, seenAt, removal: removalOf(data.removal), revoked },
        ...diskOf(data),
        sharing: revoked ? null : sharingOf(data, now),
    };
}

/** A computer the list still shows: not disconnected, or disconnected within `GONE_MS`. */
function shown(doc: Stored<WorkerDoc>, now: number): boolean {
    const revokedAt = doc.data.revokedAt;
    return revokedAt === undefined || Date.parse(isoOf(revokedAt)) + GONE_MS > now;
}

export class Household {
    readonly #services: ContentServices;
    readonly #options: HouseholdOptions;
    readonly #cell: Store<HouseholdState>;
    readonly #workers: LiveList<WorkerDoc, Stored<WorkerDoc>>;
    readonly intents: HouseholdIntents;
    #docs: readonly Stored<WorkerDoc>[] = [];
    #tick: unknown = null;
    #running = false;

    constructor(services: ContentServices, options: HouseholdOptions) {
        this.#services = services;
        this.#options = options;
        const initial = { status: 'loading' as const, failure: null, computers: [], adding: null, code: null, expiresAt: null };
        this.#cell = new Store<HouseholdState>(
            { ...initial, codeFailed: false, line: null, link: options.adminUrl, acting: null, refusal: null },
            services.log,
        );
        const { store, clock } = services;
        this.#workers = new LiveList({
            ...{ store, clock, collection: FIRESTORE_PATHS.workers(services.cityId), pageSize: COMPUTERS_MAX, schema: workerDocSchema },
            map: (doc: Stored<WorkerDoc>) => doc,
            denied: () => {
                services.denied();
            },
            changed: (list) => {
                this.#listed(list);
            },
        });
        this.intents = {
            add: (kind) => {
                this.#add(kind);
            },
            mint: () => this.#mint(),
            rename: (id, name) => this.#manage(id, { action: 'rename', name }),
            pause: (id) => this.#manage(id, { action: 'pause' }),
            resume: (id) => this.#manage(id, { action: 'resume' }),
            freeSpace: (id) => this.#manage(id, { action: 'freeSpace' }),
            remove: (id, options) => this.#manage(id, { action: 'remove', ...options }),
            disconnect: (id) =>
                this.#act(id, () => this.#services.callables.call('worker.revoke', { cityId: this.#services.cityId, workerId: id })),
            retry: () => {
                this.#workers.retry();
            },
        };
    }

    get state(): HouseholdState {
        return this.#cell.state;
    }

    /** The line that cleans a computer of `os` up by hand (after Disconnect now anyway). */
    cleanup(os: WorkerOs): string {
        return cleanupLine(this.#options.functionsBase, this.#services.cityId, os);
    }

    subscribe(listener: (state: HouseholdState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    start(): void {
        this.#running = true;
        this.#workers.show({ orderBy: [['lastSeenAt', 'desc']] });
        this.#schedule();
    }

    stop(): void {
        this.#running = false;
        this.#workers.stop();
        this.#services.clock.clearTimeout(this.#tick);
    }

    #schedule(): void {
        const { clock } = this.#services;
        clock.clearTimeout(this.#tick);
        this.#tick = this.#running
            ? clock.setTimeout(() => {
                  this.#show();
                  this.#schedule();
              }, TICK_MS)
            : null;
    }

    #listed(list: ListState<Stored<WorkerDoc>>): void {
        this.#docs = list.items;
        this.#cell.update({ status: list.status, failure: list.failure });
        this.#show();
    }

    /** The computers as of now (who is online changes with time alone). */
    #show(): void {
        const now = this.#services.clock.now();
        this.#cell.update({ computers: this.#docs.filter((doc) => shown(doc, now)).map((doc) => computerOf(doc, now)) });
    }

    #add(kind: AddKind | null): void {
        this.#cell.update({ adding: kind });
        if (kind === 'headless' && this.#cell.state.code === null) {
            void this.#mint();
        }
    }

    async #mint(): Promise<void> {
        const { callables, cityId } = this.#services;
        try {
            const { code, expiresAt } = await callables.call('worker.pairCode', { cityId, household: true });
            const line = headlessLine(this.#options.functionsBase, cityId, code);
            this.#cell.update({ code, expiresAt, line, codeFailed: false });
        } catch (error) {
            this.#services.log.warn('the household pairing code was not minted', { cityId });
            this.#cell.update({ code: null, expiresAt: null, line: null, codeFailed: true, refusal: refusalOf(error) });
        }
    }

    #manage(
        id: string,
        change:
            | { readonly action: 'rename'; readonly name: string }
            | { readonly action: 'pause' | 'resume' | 'freeSpace' }
            | { readonly action: 'remove'; readonly docker: boolean; readonly keep: boolean },
    ): Promise<boolean> {
        return this.#act(id, () =>
            this.#services.callables.call('worker.manage', { cityId: this.#services.cityId, workerId: id, ...change }),
        );
    }

    /** One action for computer `id`, one at a time; a refusal is said under the list. */
    async #act(id: string, call: () => Promise<unknown>): Promise<boolean> {
        if (this.#cell.state.acting !== null) {
            return false;
        }
        this.#cell.update({ acting: id, refusal: null });
        try {
            await call();
            this.#cell.update({ acting: null });
            return true;
        } catch (error) {
            this.#cell.update({ acting: null, refusal: refusalOf(error) });
            return false;
        }
    }
}

/** Where the server's functions answer: the project's, or the Functions emulator's in the e2e build. */
export function functionsBaseOf(project: string, emulators: boolean): string {
    return emulators ? `http://127.0.0.1:5001/${project}/us-central1` : `https://us-central1-${project}.cloudfunctions.net`;
}

/** The city's computers over the area's services, for `project`. */
export function createHousehold(services: ContentServices, project: string): Household {
    const here = (globalThis as { readonly location?: Pick<Location, 'origin' | 'pathname'> }).location;
    const adminUrl = here === undefined ? '#/jobs' : `${here.origin}${here.pathname}#/jobs`;
    return new Household(services, { functionsBase: functionsBaseOf(project, import.meta.env.MODE === 'e2e'), adminUrl });
}
