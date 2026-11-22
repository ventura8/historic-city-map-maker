/**
 * The Wikipedia overlay's part in the engine (`docs/research/M31-wikipedia.md` §4, scenario V3): the first time the overlay is
 * visible (its switch in Layers, or a shared link that shows it), its file (`manifest.wikipedia.file`, beside the manifest)
 * is loaded through the lazy chunk (`wikipedia/wikipedia.ts`), and its articles join the state; the map draws them as the
 * overlay's places (`map-specs.ts`). A file that cannot be loaded switches the overlay off and says so in a toast with the fix;
 * switching it on again tries again. Nothing is asked of Wikipedia itself: the file is the city's own.
 */
import { WIKIPEDIA_CATEGORY_ID, findOverlay, withOverlayVisibility, type MessageKey } from '@hcm/shared';

import type { ViewerDeps } from './deps.js';
import type { ViewerState, WikipediaState } from './state.js';

export interface WikipediaHost {
    readonly deps: ViewerDeps;
    getState(): ViewerState;
    set(next: ViewerState): void;
    showToast(key: MessageKey): void;
}

function visible(state: ViewerState): boolean {
    return findOverlay(state.overlays, WIKIPEDIA_CATEGORY_ID)?.visible === true;
}

/** The file's address: relative to the manifest's (or the page's, for an inline manifest). */
export function wikipediaUrl(file: string, manifestUrl: string | undefined, href: string | undefined): string {
    try {
        return new URL(file, new URL(manifestUrl ?? href ?? '', href)).href;
    } catch {
        return file;
    }
}

/** Whether `next` starts a load: the overlay just shown (or shown by a new manifest) and its articles not here or failed. */
function wanted(previous: ViewerState, next: ViewerState): boolean {
    if (!shown(next)) {
        return false;
    }
    const status = next.wikipedia.status;
    return status === 'idle' || (status === 'failed' && !visible(previous));
}

/** The manifest has the overlay's file and the overlay is visible. */
function shown(state: ViewerState): boolean {
    return state.manifest?.wikipedia !== undefined && visible(state);
}

export class WikipediaFollower {
    readonly #host: WikipediaHost;

    constructor(host: WikipediaHost) {
        this.#host = host;
    }

    /** After every state change. */
    follow(previous: ViewerState, next: ViewerState): void {
        const loader = this.#host.deps.wikipedia;
        const ref = next.manifest?.wikipedia;
        if (loader === undefined || ref === undefined || !wanted(previous, next)) {
            return;
        }
        const manifest = next.manifest;
        this.#settle(next, { status: 'loading', articles: [] });
        const { config, location } = this.#host.deps;
        loader.load(wikipediaUrl(ref.file, config.manifestUrl, location.href)).then(
            (articles) => {
                this.#arrived(manifest, { status: 'ready', articles });
            },
            (error: unknown) => {
                this.#failed(manifest, error);
            },
        );
    }

    #settle(state: ViewerState, wikipedia: WikipediaState): void {
        this.#host.set({ ...state, wikipedia });
    }

    #arrived(manifest: ViewerState['manifest'], wikipedia: WikipediaState): void {
        const state = this.#host.getState();
        if (state.manifest === manifest) {
            this.#settle(state, wikipedia);
        }
    }

    #failed(manifest: ViewerState['manifest'], error: unknown): void {
        const state = this.#host.getState();
        if (state.manifest !== manifest) {
            return;
        }
        this.#host.deps.log.warn('wikipedia file failed', { error: String(error) });
        const overlays = withOverlayVisibility(state.overlays, WIKIPEDIA_CATEGORY_ID, false);
        this.#host.set({ ...state, overlays, wikipedia: { status: 'failed', articles: [] } });
        this.#host.showToast('wikipedia.loadFailed');
    }
}
