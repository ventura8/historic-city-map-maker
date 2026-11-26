/**
 * The visitor's choice of the basemap's own labels (docs/ENGINE_API.md → Map labels): street names and points of interest,
 * Mapbox Standard's `showRoadLabels` and `showPointOfInterestLabels`, with its transit stations (`showTransitLabels`). Pure
 * transitions over `MapLabelsState`; each returns the same object when nothing changed. What the basemap can do is read
 * from the mounted map, never guessed from its style URL: a custom style without these properties offers no switch, drops what a link asked for and is never written to.
 */
import type { Basemap, Manifest } from '@hcm/shared';
import {
    basemapLabels,
    MAP_LABEL_CONFIG,
    MAP_LABEL_KINDS,
    TRANSIT_LABELS,
    transitLabels,
    type MapLabelKind,
    type MapLabels,
} from '@hcm/shared/map-labels';
import type { ViewerMapPort } from '@hcm/ui/map';

export interface MapLabelsState {
    /** What is drawn. */
    readonly shown: MapLabels;
    /** What the city's basemap draws by itself: the URL hash names only a difference from it. */
    readonly defaults: MapLabels;
    /** The kinds this basemap has; null until a map has answered (before the mount, or no map at all). */
    readonly available: readonly MapLabelKind[] | null;
    /**
     * The hash keeps `labels` even at the default. Until the map answers: a link named them, so what it shows is a choice even where
     * it equals the assumed default. After: the mount wrote the link's choice over a default the style's own may differ from, and the
     * map's answer cannot tell which (no reload may lose it by omitting `labels`).
     */
    readonly pinned: boolean;
}

/** What `getBasemapFlag` answered for each kind (null: the style does not have it). */
export type MapLabelsRead = Readonly<Record<MapLabelKind, boolean | null>>;

const ALL_DRAWN: MapLabels = { streets: true, pois: true };

/** Before any manifest. */
export const NO_MAP_LABELS: MapLabelsState = { shown: ALL_DRAWN, defaults: ALL_DRAWN, available: null, pinned: false };

/** A freshly loaded manifest: its basemap's defaults, and no map has answered yet. */
export function mapLabelsOf(manifest: Manifest): MapLabelsState {
    const defaults = basemapLabels(manifest.city.basemap);
    return { shown: defaults, defaults, available: null, pinned: false };
}

function sameLabels(a: MapLabels, b: MapLabels): boolean {
    return MAP_LABEL_KINDS.every((kind) => a[kind] === b[kind]);
}

/** `base` with the booleans of `change` for `kinds`; `base` itself when that changes nothing. */
function merged(base: MapLabels, change: Partial<MapLabels>, kinds: readonly MapLabelKind[]): MapLabels {
    const next = { ...base };
    for (const kind of kinds) {
        const value = change[kind];
        if (typeof value === 'boolean') {
            next[kind] = value;
        }
    }
    return sameLabels(next, base) ? base : next;
}

function withShown(state: MapLabelsState, shown: MapLabels): MapLabelsState {
    return shown === state.shown ? state : { ...state, shown };
}

/** The visitor or the API chose (a JavaScript caller may pass anything, `null` too): what this basemap does not have, or a map that has not answered, changes nothing. */
export function withRequestedLabels(state: MapLabelsState, change: Partial<MapLabels> | null | undefined): MapLabelsState {
    return withShown(state, merged(state.shown, change ?? {}, state.available ?? []));
}

/** Whether the hash keeps `labels` after this `labels`: named before the map answered; once gone, nothing is left to keep. */
function pinnedBy(state: MapLabelsState, labels: MapLabels | undefined): boolean {
    return labels === undefined ? false : state.pinned || state.available === null;
}

/** A URL hash applied: `labels` as it names them, its absence the city's default (the encoder omits a default). */
export function withHashLabels(state: MapLabelsState, labels: MapLabels | undefined): MapLabelsState {
    const shown = withShown(state, merged(state.shown, labels ?? state.defaults, state.available ?? MAP_LABEL_KINDS));
    const pinned = pinnedBy(state, labels);
    return pinned === shown.pinned ? shown : { ...shown, pinned };
}

/**
 * `[shown, default]` of one kind once the map answered. A choice that differs from the assumed default went into the mount, so the
 * map says nothing of the default; a link's choice equal to it did not, so the map's value is the style's own, and the choice stands
 * (`MapSync` draws it); with no choice, the map's value is what is shown.
 */
function answered(state: MapLabelsState, kind: MapLabelKind, value: boolean | null): readonly [boolean, boolean] {
    const fallback = state.defaults[kind];
    if (value === null) {
        return [fallback, fallback];
    }
    if (state.shown[kind] !== fallback) {
        return [state.shown[kind], fallback];
    }
    return state.pinned ? [fallback, value] : [value, value];
}

/** The mounted map answered: what its basemap has, each missing kind back at its default so no link keeps asking for it. */
export function withMapAnswer(state: MapLabelsState, read: MapLabelsRead): MapLabelsState {
    const [streets, streetsDefault] = answered(state, 'streets', read.streets);
    const [pois, poisDefault] = answered(state, 'pois', read.pois);
    const available = MAP_LABEL_KINDS.filter((kind) => read[kind] !== null);
    return {
        shown: { streets, pois },
        defaults: { streets: streetsDefault, pois: poisDefault },
        available,
        pinned: state.pinned && available.some((kind) => state.shown[kind] !== state.defaults[kind]),
    };
}

/** What the mounted map's basemap has. */
export function readMapLabels(map: Pick<ViewerMapPort, 'getBasemapFlag'>): MapLabelsRead {
    return { streets: map.getBasemapFlag(MAP_LABEL_CONFIG.streets), pois: map.getBasemapFlag(MAP_LABEL_CONFIG.pois) };
}

/** Writes one property where the basemap has it and it differs (a write re-evaluates the style); what the map read, null: not there. */
function drawFlag(map: Pick<ViewerMapPort, 'getBasemapFlag' | 'setBasemapFlag'>, name: string, value: boolean): boolean | null {
    const current = map.getBasemapFlag(name);
    if (current !== null && current !== value) {
        map.setBasemapFlag(name, value);
    }
    return current;
}

/**
 * Writes `labels` to a mounted map, live: only what its basemap has and what differs. Transit stations follow the points of
 * interest (`transitLabels`, with the city's `config`), on a basemap that has both, so the switch hides tram and metro stops too.
 */
export function drawMapLabels(
    map: Pick<ViewerMapPort, 'getBasemapFlag' | 'setBasemapFlag'>,
    labels: MapLabels,
    config?: Basemap['config'],
): void {
    drawFlag(map, MAP_LABEL_CONFIG.streets, labels.streets);
    if (drawFlag(map, MAP_LABEL_CONFIG.pois, labels.pois) !== null) {
        drawFlag(map, TRANSIT_LABELS, transitLabels(config, labels.pois));
    }
}

/** What the hash carries: nothing while the labels are the city's default, unless the default is not known for sure (`pinned`). */
export function hashMapLabels(state: MapLabelsState): { readonly labels?: MapLabels } {
    return sameLabels(state.shown, state.defaults) && !state.pinned ? {} : { labels: state.shown };
}
