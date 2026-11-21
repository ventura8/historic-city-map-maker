/**
 * "Use this computer" (finding 72 of 2026-11-02, the user: "I should not have to copy and paste"; the user's decision
 * "Starter file + auto-pair"; `docs/research/M7-local-worker.md` §1.5, §2.7), in the lazy `worker-local` chunk:
 *
 * - **The starter file.** A link gives a small file for this computer's system (Linux `hcm-worker.sh`, macOS
 *   `hcm-worker.command`, Windows `hcm-worker.bat`) as an ordinary download from the server's `worker.starter` (finding 73
 *   of 2026-11-03: Chrome saved nothing of the file this page used to make itself, a Blob behind a link clicked after an
 *   `await`); the file holds no secret. When the panel first shows, one `HEAD` of that address says whether this server
 *   makes the file (`starter`: an older server does not, and the panel says to update the map). Opened once, the file
 *   checks Docker and installs a supervisor of the owner's user that runs the worker in the background and keeps it on
 *   the installed pipeline image. Stop using this computer gives the same file with `uninstall`, and disconnects the
 *   computer's worker (`worker.revoke`).
 * - **Auto-pair.** While the panel is shown or the admin is open (`../app/local-watch.ts`: one instance per city and project,
 *   started by each that shows it), and this browser set the computer up for the city (`LOCAL_KEY`), it looks at
 *   the worker's local state (`GET http://127.0.0.1:8765/state`) every `PROBE_MS`; a worker of this city and project that
 *   is not signed in yet turns the panel to "Connecting this computer…" by itself, and one that takes a code (`pairable`)
 *   gets a fresh one (`worker.pairCode`, posted to `POST /pair`), so nothing is copied or pasted. The worker answers those
 *   two requests for the project's Hosting origins only (CORS, Private Network Access).
 * - **Advanced.** The copyable command of finding 66, with its own one-time code (minted when Advanced is opened, renewed
 *   a minute before it expires).
 */
import {
    WORKER_PAIR_SECONDS,
    WORKER_PORT,
    WORKER_STARTER_FILE_NAMES,
    type WorkerOs,
    type WorkerProfileChoice,
    type WorkerStarterAction,
} from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { Store } from '../state/store.js';
import { LOCAL_KEY } from './local-key.js';
import { UNKNOWN_MACHINE, machineOf, postProfile, versionsOf, type MachineView, type VersionsView } from './machine.js';

export { LOCAL_KEY } from './local-key.js';

/** Where this computer's worker answers (the loopback address its command publishes the port on). */
export const LOCAL_WORKER = `http://127.0.0.1:${String(WORKER_PORT)}`;
/** How often the panel looks at this computer's worker. */
export const PROBE_MS = 5000;
/** A code is posted again only after this long without the worker signing in with the last one. */
const PAIR_AGAIN_MS = 60_000;
/** The Advanced command's code is minted again this long before it expires. */
const RENEW_MS = (WORKER_PAIR_SECONDS - 60) * 1000;

/** What the panel shows of this computer: nothing yet, the file given, looking for it, pairing, connected, or removed. */
type LocalPhase = 'none' | 'downloaded' | 'looking' | 'connecting' | 'connected' | 'stopped';

/** A starter file as the link gives it: the server's address and the name the browser saves it under. */
export interface StarterLink {
    readonly url: string;
    readonly name: string;
}

export interface LocalState {
    readonly os: WorkerOs;
    readonly phase: LocalPhase;
    /** The Advanced command's one-time code (null until Advanced asked for one, or when none could be minted). */
    readonly code: string | null;
    /** Whether the server makes the starter file (`worker.starter` answered the look); null until the look answered. */
    readonly starter: boolean | null;
    /** The starter file and the removal file for `os`. */
    readonly files: Readonly<Record<WorkerStarterAction, StarterLink>>;
    /** M26: what the worker says of this computer (`machine.ts`). */
    readonly machine: MachineView;
    /** The worker's and its starter's versions (`machine.ts`); null until it answered. */
    readonly versions: VersionsView | null;
}

export interface LocalIntents {
    setOs(os: WorkerOs): void;
    /** The starter file's link was followed: the auto-pair from now on. */
    use(): void;
    /** Finding 75: a computer set up another way (another browser, cleared storage, by hand): the auto-pair, no file. */
    find(): void;
    /** The removal file's link was followed: the computer's worker disconnected, and no more auto-pair. */
    stop(): Promise<void>;
    /** A one-time code for the Advanced command, renewed while the panel is shown. */
    command(): Promise<void>;
    /** M26: the owner's profile for this computer, posted to its worker. */
    profile(choice: WorkerProfileChoice): Promise<void>;
}

/** What the worker's `GET /state` answers that matters here. */
interface LocalAnswer {
    readonly workerId: string;
    readonly signedIn: boolean;
    readonly pairable: boolean;
    readonly city: string;
    readonly project: string;
    readonly machine: MachineView;
    readonly versions: VersionsView;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Where the server's functions answer: the project's, or the Functions emulator's in the e2e build. */
export function functionsBaseFor(project: string, emulators: boolean): string {
    return emulators ? `http://127.0.0.1:5001/${project}/us-central1` : `https://us-central1-${project}.cloudfunctions.net`;
}

/** The system of the browser's computer: Windows, macOS, else Linux. */
export function osOf(userAgent: string): WorkerOs {
    if (userAgent.includes('Windows')) {
        return 'windows';
    }
    return userAgent.includes('Mac') ? 'mac' : 'linux';
}

/** The starter file and the removal file of `os` for the city, as `worker.starter` gives them. */
export function starterLinks(functionsBase: string, city: string, os: WorkerOs): Readonly<Record<WorkerStarterAction, StarterLink>> {
    const link = (action: WorkerStarterAction): StarterLink => ({
        url: `${functionsBase}/worker-starter?${new URLSearchParams({ city, os, action }).toString()}`,
        name: WORKER_STARTER_FILE_NAMES[action][os],
    });
    return { install: link('install'), uninstall: link('uninstall') };
}

/** The worker's answer, when it is one (any other shape: none). */
function answerOf(value: unknown, installed: string | null): LocalAnswer | null {
    const answer = value as Partial<LocalAnswer> | null;
    const fields = [answer?.workerId, answer?.city, answer?.project];
    return fields.every((field) => typeof field === 'string')
        ? { ...(answer as LocalAnswer), machine: machineOf(value), versions: versionsOf(value, installed) }
        : null;
}

/** What the class is made with besides the area's services. */
export interface LocalOptions {
    readonly project: string;
    /** Where the server's functions answer (`functionsBaseFor`). */
    readonly functionsBase: string;
    readonly fetch: Fetch;
    readonly userAgent: string;
    /** The installed pipeline image digest (`setup/status.install.pipeline.image`), or null when unknown. */
    readonly installed?: string | null;
}

export class LocalComputer {
    readonly #services: ContentServices;
    readonly #options: LocalOptions;
    readonly #cell: Store<LocalState>;
    readonly intents: LocalIntents;
    #timer: unknown = null;
    #renew: unknown = null;
    /** How many show it (the panels, the shell's watch): it looks while any does. */
    #users = 0;
    #pairedAt = Number.NEGATIVE_INFINITY;
    #workerId: string | null = null;
    /** Whether the look at `worker.starter` was made (once per instance, when the panel first shows). */
    #starterAsked = false;
    /** The installed pipeline digest from `setup.status`, for `versionsOf` (null: fall back to `outdated`). */
    #installed: string | null;

    constructor(services: ContentServices, options: LocalOptions) {
        this.#services = services;
        this.#options = options;
        this.#installed = options.installed ?? null;
        const os = osOf(options.userAgent);
        // After a reload nothing says the file was just saved: it looks, and the first answer says the rest.
        const phase = this.#remembered() ? 'looking' : 'none';
        const initial: LocalState = {
            os,
            phase,
            code: null,
            starter: null,
            files: this.#files(os),
            machine: UNKNOWN_MACHINE,
            versions: null,
        };
        this.#cell = new Store<LocalState>(initial, services.log);
        this.intents = {
            setOs: (next) => {
                this.#cell.update({ os: next, files: this.#files(next) });
            },
            use: () => {
                this.#remember('downloaded');
            },
            find: () => {
                this.#remember('looking');
            },
            stop: () => this.#stop(),
            command: () => this.#mint(),
            profile: (choice) => this.#profile(choice),
        };
    }

    get state(): LocalState {
        return this.#cell.state;
    }

    subscribe(listener: (state: LocalState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    /** One more shows it: it looks at this computer's worker while any does, when this browser set it up for the city. */
    start(): void {
        this.#users += 1;
        void this.#askStarter();
        this.#look();
    }

    /** One fewer shows it; with none left, it stops looking. */
    stop(): void {
        this.#users = Math.max(0, this.#users - 1);
        if (this.#users === 0) {
            this.#halt();
        }
    }

    get #running(): boolean {
        return this.#users > 0;
    }

    #files(os: WorkerOs): LocalState['files'] {
        return starterLinks(this.#options.functionsBase, this.#services.cityId, os);
    }

    /** The first look, unless one is under way or scheduled. */
    #look(): void {
        if (this.#remembered() && this.#timer === null) {
            void this.#probe();
        }
    }

    #halt(): void {
        const { clock } = this.#services;
        clock.clearTimeout(this.#timer);
        clock.clearTimeout(this.#renew);
        this.#timer = null;
        this.#renew = null;
    }

    #remembered(): boolean {
        return this.#services.local.get(LOCAL_KEY) === this.#services.cityId;
    }

    /** Once: whether the server makes the starter file (a `HEAD` of its address; any failure: it does not). */
    async #askStarter(): Promise<void> {
        if (this.#starterAsked) {
            return;
        }
        this.#starterAsked = true;
        const url = this.#cell.state.files.install.url;
        const made = await this.#options
            .fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store' })
            .then((response) => response.ok)
            .catch(() => false);
        if (!made) {
            this.#services.log.warn('no starter file', { url });
        }
        this.#cell.update({ starter: made });
    }

    /** This browser looks after this computer from now on (the mark `start` and the shell's watch read). */
    #remember(phase: LocalPhase): void {
        this.#services.local.set(LOCAL_KEY, this.#services.cityId);
        this.#cell.update({ phase });
        this.#look();
    }

    async #stop(): Promise<void> {
        this.#services.local.remove(LOCAL_KEY);
        this.#halt();
        this.#cell.update({ phase: 'stopped' });
        await this.#disconnect();
    }

    /** This computer's worker, when it answered, disconnected in the admin (a failure leaves it: the file removes it anyway). */
    async #disconnect(): Promise<void> {
        const workerId = this.#workerId;
        if (workerId === null) {
            return;
        }
        await this.#services.callables.call('worker.revoke', { cityId: this.#services.cityId, workerId }).catch(() => undefined);
    }

    /** One look at this computer's worker, and the next one `PROBE_MS` later while the panel is shown. */
    async #probe(): Promise<void> {
        this.#timer = 'looking';
        await this.#seen(await this.#ask());
        this.#timer = null;
        if (this.#running && this.#remembered()) {
            this.#timer = this.#services.clock.setTimeout(() => void this.#probe(), PROBE_MS);
        }
    }

    /** The installed pipeline digest the Versions line compares with (from the feed's `setup.status` read). */
    useInstalled(installed: string | null): void {
        this.#installed = installed;
    }

    /** The worker's state, or null (none answers on this computer, or not with a state). */
    async #ask(): Promise<LocalAnswer | null> {
        try {
            const response = await this.#options.fetch(`${LOCAL_WORKER}/state`, { credentials: 'omit', cache: 'no-store' });
            return response.ok ? answerOf(await response.json(), this.#installed) : null;
        } catch {
            return null;
        }
    }

    /** Connected, or a code for a worker of this city and project that takes one; anything else changes nothing. */
    async #seen(answer: LocalAnswer | null): Promise<void> {
        if (!this.#ours(answer)) {
            return;
        }
        this.#workerId = answer.workerId;
        if (answer.signedIn) {
            this.#cell.update({ phase: 'connected', machine: answer.machine, versions: answer.versions });
            return;
        }
        if (!answer.pairable) {
            return;
        }
        // Finding 73: the worker came up (the file ran) and takes a code: connecting, also while a code is on its way.
        this.#cell.update({ phase: 'connecting' });
        if (this.#pairs()) {
            await this.#pair();
        }
    }

    /** A worker of this city and this project answered. */
    #ours(answer: LocalAnswer | null): answer is LocalAnswer {
        return answer?.city === this.#services.cityId && answer.project === this.#options.project;
    }

    /** No code was posted in the last minute. */
    #pairs(): boolean {
        return this.#services.clock.now() - this.#pairedAt >= PAIR_AGAIN_MS;
    }

    /** A fresh code, posted to the worker, which pairs with it at once. */
    async #pair(): Promise<void> {
        const { callables, cityId, clock } = this.#services;
        this.#pairedAt = clock.now();
        try {
            const { code } = await callables.call('worker.pairCode', { cityId });
            const body = JSON.stringify({ code });
            await this.#options.fetch(`${LOCAL_WORKER}/pair`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                credentials: 'omit',
            });
        } catch (error) {
            this.#services.log.warn('pairing failed', { error: String(error) });
        }
    }

    /** M26: the owner's profile posted to this computer's worker; its answer is the card's at once, a refusal is said on the card. */
    async #profile(choice: WorkerProfileChoice): Promise<void> {
        const answered = await postProfile(this.#options.fetch, LOCAL_WORKER, choice);
        const machine = this.#cell.state.machine;
        if (answered !== null) {
            this.#cell.update({ machine: answered });
        } else if (machine.kind === 'known') {
            this.#services.log.warn('the worker did not take the profile', { choice });
            this.#cell.update({ machine: { ...machine, failed: true } });
        }
    }

    /** The Advanced command's code, minted again a minute before it expires while the panel is shown. */
    async #mint(): Promise<void> {
        const { callables, cityId, clock } = this.#services;
        clock.clearTimeout(this.#renew);
        try {
            const { code } = await callables.call('worker.pairCode', { cityId });
            this.#cell.update({ code });
            this.#renew = this.#running ? clock.setTimeout(() => void this.#mint(), RENEW_MS) : null;
        } catch {
            this.#cell.update({ code: null });
        }
    }
}

/** One instance per area's services and project: the panels and the shell's watch share it (and its looks). */
const SHARED = new WeakMap<ContentServices, Map<string, LocalComputer>>();

/** This computer's part of the worker's panel, over the area's services and the page's `fetch`; shared, see `SHARED`. */
export function createLocal(services: ContentServices, project: string, installed: string | null = null): LocalComputer {
    const byProject = SHARED.get(services) ?? new Map<string, LocalComputer>();
    SHARED.set(services, byProject);
    const local =
        byProject.get(project) ??
        new LocalComputer(services, {
            project,
            functionsBase: functionsBaseFor(project, import.meta.env.MODE === 'e2e'),
            fetch: (url, init) => globalThis.fetch(url, init),
            userAgent: globalThis.navigator.userAgent,
            installed,
        });
    local.useInstalled(installed);
    byProject.set(project, local);
    return local;
}
