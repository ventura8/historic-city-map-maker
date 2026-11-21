/**
 * Finding 72 of 2026-11-02 (the auto-pair, `docs/research/M7-local-worker.md` §2.7): while the admin is open, a browser
 * that set this computer up for the current city with Use this computer (`LOCAL_KEY`) keeps looking at the computer's
 * worker and pairs it, also away from the Jobs page (the worker's panel does the same while it is shown, with the same
 * shared instance). It costs nothing to anyone else: without the mark nothing is loaded and nothing is asked of the
 * computer. The part itself is the lazy `worker-local` chunk, reached through the Jobs area's store.
 */
import type { Logger } from '@hcm/shared';

import { LOCAL_KEY } from '../worker/local-key.js';
import type { ShellState } from '../state/state.js';
import type { KeyValueStore, Unsubscribe } from './ports.js';

/** What the watch needs of the computer's part: it looks while started. */
interface Looking {
    start(): void;
    stop(): void;
}

export interface LocalWatchSources {
    readonly local: KeyValueStore;
    readonly log: Logger;
    readonly projectId: string;
    /** The Jobs area's chunk, then its store's computer part (null: a store without it). */
    part(project: string): Promise<Looking | null>;
}

export interface LocalWatch {
    stateChanged(state: ShellState): void;
    stop(): void;
}

class Watch implements LocalWatch {
    readonly #sources: LocalWatchSources;
    #city: string | null = null;
    #part: Promise<Looking | null> | null = null;

    constructor(sources: LocalWatchSources) {
        this.#sources = sources;
    }

    stateChanged(state: ShellState): void {
        const wanted = this.#wanted(state);
        if (wanted !== this.#city) {
            this.stop();
            this.#city = wanted;
            this.#part = wanted === null ? null : this.#started();
        }
    }

    /** The signed-in admin's city, when this browser set this computer up for it; else null. */
    #wanted(state: ShellState): string | null {
        const city = state.auth === 'admin' ? state.cityId : null;
        return city !== null && this.#sources.local.get(LOCAL_KEY) === city ? city : null;
    }

    stop(): void {
        void this.#part?.then((part) => part?.stop());
        this.#part = null;
        this.#city = null;
    }

    async #started(): Promise<Looking | null> {
        const part = await this.#sources.part(this.#sources.projectId).catch((error: unknown) => {
            this.#sources.log.warn("this computer's worker part did not load", { error: String(error) });
            return null;
        });
        part?.start();
        return part;
    }
}

export function localWatch(sources: LocalWatchSources): LocalWatch {
    return new Watch(sources);
}

/** What `watchComputer` needs of the shell (`./mount.ts`): its storage, log and project, the pages and the areas' stores. */
export interface ComputerWatchDeps {
    readonly local: KeyValueStore;
    readonly log: Logger;
    readonly config: { readonly projectId: string };
    readonly pages: { load(id: 'jobs'): Promise<unknown> };
}

/** The Jobs area's store as the watch reaches it (its feed's computer part). */
export interface JobsStores {
    readonly jobs: { readonly intents: { worker?(): Promise<{ readonly intents: { local(project: string): Promise<Looking> } }> } } | null;
}

/** The shell's state, as a listener of its own: another watch's failure never keeps this one from following it. */
export interface ShellStates {
    subscribe(listener: (state: ShellState) => void): Unsubscribe;
}

/** The watch over the shell, through the Jobs area's chunk and store; the returned function stops both. */
export function watchComputer(deps: ComputerWatchDeps, shell: ShellStates, stores: JobsStores): () => void {
    const watch = localWatch({
        ...{ local: deps.local, log: deps.log, projectId: deps.config.projectId },
        part: async (project) => {
            await deps.pages.load('jobs');
            const feed = await stores.jobs?.intents.worker?.();
            return (await feed?.intents.local(project)) ?? null;
        },
    });
    const unsubscribe = shell.subscribe((state) => {
        watch.stateChanged(state);
    });
    return () => {
        unsubscribe();
        watch.stop();
    };
}
