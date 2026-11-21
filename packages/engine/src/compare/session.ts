/**
 * One swipe compare session (M4, docs/research/M4-interfaces.md §3.3–§3.7, scenario V06), started by the entry's
 * `CompareDriver` once the visitor compares on a ready map and destroyed when that ends. It keeps compare's surface in
 * step with the store, and in swipe mode (a window 600 px wide or more) the second map: created lazily (one more billed
 * map load, counted by the e2e map-instance counter), drawn by its own `MapSync` from the state as the compared side
 * shows it (`comparedState`: the same basemap and map labels, photos and places with their visibility and opacity, of the historical
 * layers only the compared one with its opacity and image adjustments), its camera linked to the main map's, and
 * destroyed when compare closes and with the viewer. A window that becomes compact (the toggle needs no second map) hides
 * it for `COMPARE_PARK_MS` before destroying it, so a phone turned back and forth or a window dragged across 600 px
 * reuses the one map instead of paying a new map load each time (the security and cost review of M4). A second map that
 * fails to load closes compare with the `error.mapLoad` toast; the main map is never touched.
 */
import type { MapEventMap, Unsubscribe, ViewerMapPort } from '@hcm/ui/map';
import type { CompareUi } from '@hcm/ui/viewer/compare';

import type { CompareSession, CompareSessionDeps } from '../core/compare-port.js';
import { mapLight } from '../core/map-light.js';
import { mapOptions } from '../core/map-specs.js';
import { MapSync } from '../core/map-sync.js';
import { comparedOverlays, compareModeOf, overlayName, type ViewerState } from '../core/state.js';
import { linkCameras } from './camera-sync.js';
import { compareUiProps } from './labels.js';

/** How long a compact window keeps the hidden second map before destroying it (a wider window within it reuses it). */
export const COMPARE_PARK_MS = 60_000;

/** The state as the second map shows it: of the historical layers only the compared one, and no toggle. */
export function comparedState(state: ViewerState): ViewerState {
    return { ...state, overlays: comparedOverlays(state.overlays, state.compare?.layerId ?? null), compare: null };
}

interface SecondMap {
    readonly map: ViewerMapPort;
    readonly sync: MapSync;
    readonly unlink: readonly Unsubscribe[];
}

class Session implements CompareSession {
    readonly #deps: CompareSessionDeps;
    readonly #ui: CompareUi;
    readonly #unsubscribe: Unsubscribe;
    #second: SecondMap | null = null;
    /** The second map while it mounts (its style is on its way), null otherwise. */
    #opening: ViewerMapPort | null = null;
    /** While a compact window hides the second map: the timer that destroys it. */
    #parked: ReturnType<typeof setTimeout> | null = null;
    #destroyed = false;

    constructor(deps: CompareSessionDeps) {
        this.#deps = deps;
        const { host } = deps;
        this.#ui = deps.ui(deps.anchor, deps.mapboxCssUrl, {
            onPosition: (position) => {
                host.setComparePosition(position);
            },
            onChoose: (layerId) => {
                host.openCompare(layerId);
            },
            onClose: () => {
                host.closeCompare();
            },
        });
        this.#unsubscribe = host.subscribe((state, previous) => {
            this.#follow(state, previous);
        });
        const state = host.getState();
        this.#follow(state, state);
    }

    /**
     * After every state change: the surface follows; in swipe mode the second map exists (made, or shown again), in toggle
     * mode it is hidden and destroyed after `COMPARE_PARK_MS`; meanwhile it keeps drawing the compared side.
     */
    #follow(state: ViewerState, previous: ViewerState): void {
        const { manifest, compare } = state;
        if (this.#destroyed || manifest === null || compare === null) {
            return;
        }
        this.#ui.update(compareUiProps(state, manifest, compare));
        if (compareModeOf(state) === 'toggle') {
            this.#park();
        } else {
            this.#unpark();
        }
        this.#draw(state, previous);
    }

    #draw(state: ViewerState, previous: ViewerState): void {
        if (this.#second !== null) {
            this.#second.sync.update(comparedState(previous), comparedState(state));
        } else if (compareModeOf(state) === 'swipe') {
            this.#openSecond();
        }
    }

    /** A compact window: the second map (made or on its way) is kept hidden, then destroyed unless the window widens. */
    #park(): void {
        if (this.#parked === null && (this.#second !== null || this.#opening !== null)) {
            this.#parked = setTimeout(() => {
                this.#parked = null;
                this.#closeSecond();
            }, COMPARE_PARK_MS);
        }
    }

    #unpark(): void {
        if (this.#parked !== null) {
            clearTimeout(this.#parked);
            this.#parked = null;
        }
    }

    #openSecond(): void {
        if (this.#opening === null) {
            const map = this.#deps.createMap();
            this.#opening = map;
            void this.#mount(map);
        }
    }

    /** Whether `map` is still the second map being mounted (not superseded, closed or destroyed). */
    #current(map: ViewerMapPort): boolean {
        return !this.#destroyed && this.#opening === map;
    }

    async #mount(map: ViewerMapPort): Promise<void> {
        const container = await this.#ui.mapContainer();
        const state = this.#deps.host.getState();
        if (container === null || state.manifest === null || !this.#current(map)) {
            this.#abandon(map);
            return;
        }
        try {
            const { locale, mapLabels } = state;
            const { mainMap, reducedMotion } = this.#deps;
            await map.mount(
                container,
                mapOptions(state.manifest, {
                    view: mainMap.getView(),
                    locale,
                    reducedMotion,
                    labels: mapLabels.shown,
                    light: mapLight(state),
                }),
            );
        } catch (error: unknown) {
            this.#failed(map, error);
            return;
        }
        this.#mounted(map);
    }

    #abandon(map: ViewerMapPort): void {
        if (this.#opening === map) {
            this.#opening = null;
        }
        map.destroy();
    }

    /** The second map's style or WebGL failed: compare closes with a toast; one that was closed meanwhile goes quietly. */
    #failed(map: ViewerMapPort, error: unknown): void {
        const current = this.#current(map);
        this.#abandon(map);
        if (current) {
            this.#deps.log.warn('the compared map failed to load', { error: String(error) });
            this.#deps.host.compareReady?.(false);
            this.#deps.host.closeCompare();
            this.#deps.host.showToast('error.mapLoad');
        }
    }

    /** The second map's style loaded: it draws the compared side and follows the main map, unless compare moved on. */
    #mounted(map: ViewerMapPort): void {
        if (!this.#current(map)) {
            map.destroy();
            return;
        }
        this.#opening = null;
        const sync = new MapSync(map, this.#deps.assetBase);
        sync.render(comparedState(this.#deps.host.getState()));
        const unlink = [
            linkCameras(this.#deps.mainMap, map),
            map.on('error', (event) => {
                this.#mapError(event);
            }),
            map.on('webglcontextlost', () => {
                this.#deps.host.closeCompare();
            }),
        ];
        this.#second = { map, sync, unlink };
        this.#deps.host.compareReady?.(true);
    }

    /** The compared layer failing names itself in a toast, as the main map's layers do (V03). */
    #mapError(event: MapEventMap['error']): void {
        const state = this.#deps.host.getState();
        if (event.layerId !== undefined && state.toast === null) {
            this.#deps.host.showToast('error.layer', { name: overlayName(state, event.layerId) });
        }
    }

    #closeSecond(): void {
        this.#unpark();
        const opening = this.#opening;
        this.#opening = null;
        opening?.destroy();
        const second = this.#second;
        this.#second = null;
        if (second !== null) {
            for (const unlink of second.unlink) {
                unlink();
            }
            second.map.destroy();
        }
    }

    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.#unsubscribe();
        this.#closeSecond();
        this.#ui.remove();
    }
}

/** Starts compare on the viewer's map (the lazy chunk's entry point, `CompareModule.startCompare`). */
export function startCompare(deps: CompareSessionDeps): CompareSession {
    return new Session(deps);
}
