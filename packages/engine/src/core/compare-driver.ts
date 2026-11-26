/**
 * Swipe compare's part in the engine's entry (M4, docs/research/M4-interfaces.md §3.2, scenario V06): it fetches the lazy
 * chunk (`compare/compare.ts`, emitted as `compare-<hash>.js` beside `engine.mjs`) the first time the visitor compares,
 * starts a session once the viewer's map is ready, and ends it when compare closes, when the map goes (no WebGL, an error
 * card, a new load) and when the viewer is destroyed. Everything compare draws, the second map included, is the chunk's;
 * the types both halves share are in `compare-port.ts`.
 */
import type { CompareDeps, CompareHost, CompareModule, CompareSession, MountedMap } from './compare-port.js';
import type { ViewerDeps } from './deps.js';
import type { ViewerState } from './state.js';

/** What the driver needs from the store: its actions, its deps and its map once mounted. */
export interface CompareDriverHost extends CompareHost {
    readonly deps: ViewerDeps;
    mountedMap(): MountedMap | null;
}

export class CompareDriver {
    readonly #host: CompareDriverHost;
    #session: CompareSession | null = null;
    #loading = false;
    #destroyed = false;

    constructor(host: CompareDriverHost) {
        this.#host = host;
    }

    /** After every state change: a session runs exactly while the visitor compares on a ready map. */
    follow(state: ViewerState): void {
        const compare = this.#host.deps.compare;
        if (!this.#wanted(state)) {
            this.#stop();
        } else if (compare !== undefined && this.#session === null && !this.#loading) {
            this.#loading = true;
            void this.#start(compare);
        }
    }

    #wanted(state: ViewerState): boolean {
        return !this.#destroyed && state.compare !== null && state.status === 'ready' && state.webgl && this.#host.mountedMap() !== null;
    }

    async #start(compare: CompareDeps): Promise<void> {
        try {
            const module = await this.#load(compare);
            if (module !== null) {
                this.#begin(module, compare);
            }
        } catch (error: unknown) {
            this.#fail(error, 'error.mapLoad');
        } finally {
            this.#loading = false;
        }
    }

    /**
     * The chunk (the IIFE's extra, `extras/loader.ts`); one that does not arrive closes compare with a message that says to
     * try again, and the visitor's next Compare fetches it afresh.
     */
    async #load(compare: CompareDeps): Promise<CompareModule | null> {
        try {
            return await compare.load();
        } catch (error: unknown) {
            this.#fail(error, 'error.extraLoad');
            return null;
        }
    }

    #fail(error: unknown, message: 'error.mapLoad' | 'error.extraLoad'): void {
        this.#host.deps.log.warn('compare could not start', { error: String(error) });
        this.#host.compareReady?.(false);
        this.#host.closeCompare();
        this.#host.showToast(message);
    }

    /** Starts the session, unless the visitor stopped comparing while the chunk loaded. */
    #begin(module: CompareModule, compare: CompareDeps): void {
        const mounted = this.#host.mountedMap();
        if (mounted === null || !this.#wanted(this.#host.getState())) {
            return;
        }
        const { deps } = this.#host;
        this.#session = module.startCompare({
            host: this.#host,
            mainMap: deps.map,
            anchor: mounted.anchor,
            createMap: compare.createMap,
            mapboxCssUrl: compare.mapboxCssUrl,
            assetBase: mounted.assetBase,
            reducedMotion: deps.reducedMotion?.() === true,
            ui: module.createCompareUi,
            log: deps.log.child('compare'),
        });
    }

    #stop(): void {
        const session = this.#session;
        this.#session = null;
        session?.destroy();
    }

    /** The viewer is going: the session ends now and none starts again. */
    destroy(): void {
        this.#destroyed = true;
        this.#stop();
    }
}
