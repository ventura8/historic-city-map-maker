/**
 * The Layers panel, easier to find (the owner, 2026-11-22: 27 % of visitors open it). Where it is not docked (a phone, a
 * tablet, a short window) the first visit shows an M3 snackbar in the toast's dock: "the old maps and aerial photos are in
 * Layers", with an Open Layers action. Once answered, dismissed or timed out it never shows again for this visitor
 * (localStorage, every access guarded: blocked storage shows it once per page). Where the pane is docked it is already open.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { ViewerState } from './store-port.js';

const SEEN_KEY = 'hcm.layersHint.seen';

/** The snackbar's two answers. */
export interface LayersHintOffer {
    readonly onOpen: () => void;
    readonly onDismiss: () => void;
}

function readSeen(): boolean {
    try {
        return globalThis.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        return false;
    }
}

/** Remembers the hint for this visitor, and for this page whatever the storage says. */
export class LayersHint {
    #seen = readSeen();

    /** The offer while the hint should show: the map ready with historical layers, the pane not docked nor open. */
    offer(
        state: ViewerState | null,
        layersDocked: boolean,
        answer: { readonly open: () => void; readonly changed: () => void },
    ): LayersHintOffer | null {
        if (this.#seen || !shown(state, layersDocked)) {
            return null;
        }
        return {
            onOpen: () => {
                this.#done(answer.changed);
                answer.open();
            },
            onDismiss: () => {
                this.#done(answer.changed);
            },
        };
    }

    #done(changed: () => void): void {
        this.#seen = true;
        try {
            globalThis.localStorage.setItem(SEEN_KEY, '1');
        } catch {
            // Blocked storage: the hint stays gone for this page only.
        }
        changed();
    }
}

function shown(state: ViewerState | null, layersDocked: boolean): boolean {
    return state !== null && !layersDocked && quietMap(state);
}

/** The map is ready with historical layers and nothing open over it. */
function quietMap(state: ViewerState): boolean {
    const layers = state.manifest === null ? 0 : state.manifest.layers.length;
    return state.status === 'ready' && state.webgl && state.sheet === 'none' && layers > 0;
}

/** The hint's snackbar, or nothing. */
export function layersHintSnackbar(locale: ViewerLocale, offer: LayersHintOffer | null | undefined): TemplateResult {
    if (offer === null || offer === undefined) {
        return EMPTY;
    }
    return html`<hcm-snackbar
        data-layout-check="layers-hint"
        .message=${translate(locale, 'layers.hint')}
        .actionLabel=${translate(locale, 'layers.hintOpen')}
        .closeLabel=${translate(locale, 'action.close')}
        @hcm-action=${offer.onOpen}
        @hcm-dismiss=${offer.onDismiss}
    ></hcm-snackbar>`;
}
