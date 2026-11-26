/**
 * The types swipe compare's two halves share (M4, docs/research/M4-interfaces.md §3.2): the engine's entry (the store,
 * `compare-driver.ts`, `deps.ts`) and the lazy chunk (`packages/engine/src/compare/`). Types only, so neither half pulls
 * the other's code.
 */
import type { Logger, MessageKey } from '@hcm/shared';
import type { Unsubscribe, ViewerMapPort } from '@hcm/ui/map';
import type { CompareUiFactory } from '@hcm/ui/viewer/compare';

import type { ViewerState } from './state.js';

/** What a compare session reads and calls on the store. */
export interface CompareHost {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    openCompare(layerId: string | null): void;
    setComparePosition(position: number): void;
    closeCompare(): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    /** The second map is ready (`ok`) or failed: the `compare_timing` field measurement (§76). */
    compareReady?(ok: boolean): void;
}

/** Everything a session is started with. */
export interface CompareSessionDeps {
    readonly host: CompareHost;
    /** The viewer's map: the main side. */
    readonly mainMap: ViewerMapPort;
    /** The element the viewer's map is mounted into; compare's surface goes right after it. */
    readonly anchor: HTMLElement;
    /** A new Mapbox MapPort for the second map (each is a billed map load). */
    readonly createMap: () => ViewerMapPort;
    /** mapbox-gl.css of the pinned release, linked beside the second map. */
    readonly mapboxCssUrl: string;
    /** The manifest's address, for relative asset URLs (as the main map's). */
    readonly assetBase: string | undefined;
    readonly reducedMotion: boolean;
    /** Builds compare's surface (`@hcm/ui/viewer/compare`). */
    readonly ui: CompareUiFactory;
    readonly log: Logger;
}

export interface CompareSession {
    /** Destroys the second map, every listener and compare's surface; calling it again does nothing. */
    destroy(): void;
}

/** The lazy chunk's module (`compare/compare.ts`). */
export interface CompareModule {
    readonly startCompare: (deps: CompareSessionDeps) => CompareSession;
    readonly createCompareUi: CompareUiFactory;
}

/** What the page gives compare (`ViewerDeps.compare`; `mount.ts` wires the browser's). */
export interface CompareDeps {
    /** `import('../compare/compare.js')`: the chunk, fetched the first time the visitor compares. */
    readonly load: () => Promise<CompareModule>;
    readonly createMap: () => ViewerMapPort;
    readonly mapboxCssUrl: string;
}

/** The viewer's map once it is mounted. */
export interface MountedMap {
    readonly anchor: HTMLElement;
    readonly assetBase: string | undefined;
}
