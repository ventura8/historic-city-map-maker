/**
 * What the viewer store is given (docs/research/M1-interfaces.md §6). The fields marked CR-8 are engine-core
 * additions to the contract: the engine version and the map container the boot sequence needs, the reduced-motion
 * preference, and the page address, query and `hashchange` of the location.
 */
import type { EngineConfig, Logger } from '@hcm/shared';
import type { Unsubscribe, ViewerMapPort } from '@hcm/ui/map';

import type { TelemetryPort } from '../telemetry/telemetry-port.js';
import type { CatalogueLoader } from './catalogues.js';
import type { CompareDeps } from './compare-port.js';
import type { PreferenceStorage } from './preferences.js';

export interface ViewerLocation {
    readonly hash: string;
    replaceHash(hash: string): void;
    /** engine-core addition (CR-8): the page address, to resolve the manifest's relative asset URLs. */
    readonly href?: string;
    /** engine-core addition (CR-8): `?lang=` of the page. */
    readonly search?: string;
    /** engine-core addition (CR-8): `hashchange`; the store applies a hash the visitor edits or navigates to. */
    subscribe?(listener: () => void): Unsubscribe;
}

/** `prefers-color-scheme: dark` of the page, which the basemap's light follows under the `system` theme. */
export interface ColorSchemeSource {
    dark(): boolean;
    subscribe(listener: (dark: boolean) => void): Unsubscribe;
}

export interface ViewerDeps {
    readonly config: EngineConfig;
    /** `fetch` for the manifest (tests pass a fake); the store applies a 15 s timeout. */
    readonly fetch: (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;
    readonly map: ViewerMapPort;
    readonly telemetry: TelemetryPort;
    /** localStorage-like; preferences live under `hcm:<cityId>:<name>` (`lang`, `theme`, `consent`). */
    readonly storage: PreferenceStorage;
    /** Reads and writes the URL hash (history.replaceState). */
    readonly location: ViewerLocation;
    readonly log: Logger;
    /** engine-core addition (CR-8): `ENGINE_VERSION`, checked against `city.engine.minVersion`. */
    readonly engineVersion: string;
    /** engine-core addition (CR-8): the element the map is mounted into, once the viewer has rendered it. */
    readonly mapContainer: () => HTMLElement | null;
    /** engine-core addition (CR-8): `prefers-reduced-motion: reduce` (default false). */
    readonly reducedMotion?: () => boolean;
    /**
     * M4 (swipe compare, docs/research/M4-interfaces.md §3): the lazy chunk, a factory of the second map and mapbox-gl.css;
     * without it compare still lives in the state and the hash, but nothing is drawn (the node tests of the store).
     */
    readonly compare?: CompareDeps;
    /** Without it the `system` theme counts as light (the node tests of the store). */
    readonly colorScheme?: ColorSchemeSource;
    /**
     * The viewer's languages, fetched when first shown (`catalogues.ts`); without it only the languages the page already
     * has (the node tests of the store: Romanian and English).
     */
    readonly catalogues?: CatalogueLoader;
}
