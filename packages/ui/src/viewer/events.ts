/**
 * The public events of `<hcm-map-viewer>` (docs/ENGINE_API.md → `<hcm-map-viewer>`), derived from store transitions
 * so they fire the same way for the visitor, the URL hash and the JavaScript API:
 *
 * - `hcm-ready` once the manifest is valid and the map is ready, `hcm-error` when boot fails;
 * - `hcm-overlay-change` (and `hcm-layer-change` for a historical layer) once per settled change of an overlay: while a
 *   slider is dragged the change is held back, and released as one event when the slider lets go;
 * - `hcm-photo-open` and `hcm-poi-open` when a photo's or a POI's details open;
 * - `hcm-compare-change` (M4, V06) when swipe compare opens, closes, switches between `swipe` and `toggle` (the window
 *   class), changes its compared side or settles its divider (a drag fires it once, on release); a compare the URL hash
 *   opens fires it after `hcm-ready`;
 * - `hcm-map-labels-change` (V31) when the basemap's own labels change; a link's choice fires it after `hcm-ready`.
 */
import type { Manifest, Overlay } from '@hcm/shared';
import type { MapLabels } from '@hcm/shared/map-labels';

import type { ViewerError, ViewerState } from './store-port.js';

type PublicEventType =
    | 'hcm-ready'
    | 'hcm-error'
    | 'hcm-layer-change'
    | 'hcm-overlay-change'
    | 'hcm-photo-open'
    | 'hcm-poi-open'
    | 'hcm-compare-change'
    | 'hcm-map-labels-change';

export interface PublicEvent {
    readonly type: PublicEventType;
    readonly detail: Readonly<Record<string, unknown>>;
}

interface Settled {
    readonly visible: boolean;
    readonly opacity: number;
}

/** Remembers the last announced state of each overlay and which overlays are being dragged. */
export class OverlayChangeTracker {
    readonly #settled = new Map<string, Settled>();
    readonly #dragging = new Set<string>();

    /** Starts over from `overlays` (a new manifest): nothing is announced for them. */
    reset(overlays: readonly Overlay[]): void {
        this.#settled.clear();
        this.#dragging.clear();
        for (const overlay of overlays) {
            this.#settled.set(overlay.id, { visible: overlay.visible, opacity: overlay.opacity });
        }
    }

    /** A slider moved: hold its changes back until `final`. */
    drag(id: string, final: boolean): void {
        if (final) {
            this.#dragging.delete(id);
            return;
        }
        this.#dragging.add(id);
    }

    /** The overlays that changed since they were last announced (dragged ones excepted); they count as announced now. */
    changes(overlays: readonly Overlay[]): readonly Overlay[] {
        const changed = overlays.filter((overlay) => !this.#dragging.has(overlay.id) && this.#differs(overlay));
        for (const overlay of changed) {
            this.#settled.set(overlay.id, { visible: overlay.visible, opacity: overlay.opacity });
        }
        return changed;
    }

    #differs(overlay: Overlay): boolean {
        const settled = this.#settled.get(overlay.id);
        return settled?.visible !== overlay.visible || settled.opacity !== overlay.opacity;
    }
}

function errorDetail(error: ViewerError): Readonly<Record<string, unknown>> {
    const detail = error.params?.['detail'];
    return detail === undefined
        ? { code: error.code, retryable: error.retryable }
        : { code: error.code, retryable: error.retryable, detail };
}

function readyEvent(manifest: Manifest, engineVersion: string): PublicEvent {
    return {
        type: 'hcm-ready',
        detail: { cityId: manifest.city.id, engineVersion, layers: manifest.layers.length, photos: manifest.photos.length },
    };
}

function readyEvents(state: ViewerState, tracker: OverlayChangeTracker, engineVersion: string): PublicEvent[] {
    if (state.manifest === null) {
        return [];
    }
    tracker.reset(state.overlays);
    return [readyEvent(state.manifest, engineVersion)];
}

function errorEvents(error: ViewerError | null): PublicEvent[] {
    return error === null ? [] : [{ type: 'hcm-error', detail: errorDetail(error) }];
}

function statusEvents(previous: ViewerState, state: ViewerState, tracker: OverlayChangeTracker, engineVersion: string): PublicEvent[] {
    if (state.status === previous.status) {
        return [];
    }
    if (state.status === 'ready') {
        return readyEvents(state, tracker, engineVersion);
    }
    return state.status === 'error' ? errorEvents(state.error) : [];
}

function selectionEvents(previous: ViewerState, state: ViewerState): PublicEvent[] {
    const events: PublicEvent[] = [];
    if (state.selectedPhotoId !== null && state.selectedPhotoId !== previous.selectedPhotoId) {
        events.push({ type: 'hcm-photo-open', detail: { photoId: state.selectedPhotoId } });
    }
    if (state.selectedPoiId !== null && state.selectedPoiId !== previous.selectedPoiId) {
        events.push({ type: 'hcm-poi-open', detail: { poiId: state.selectedPoiId } });
    }
    return events;
}

/**
 * `hcm-overlay-change` for each overlay, plus `hcm-layer-change` (with the layer's year) for a historical layer whose
 * layer the manifest has (none without a manifest).
 */
export function overlayEvents(changed: readonly Overlay[], manifest: Manifest | null): PublicEvent[] {
    const layers = manifest === null ? [] : manifest.layers;
    return changed.flatMap((overlay) => {
        const { id, kind, visible, opacity } = overlay;
        const event: PublicEvent = { type: 'hcm-overlay-change', detail: { overlayId: id, kind, visible, opacity } };
        const layer = kind === 'raster' ? layers.find((candidate) => candidate.id === id) : undefined;
        return layer === undefined
            ? [event]
            : [event, { type: 'hcm-layer-change', detail: { layerId: id, visible, opacity, year: layer.year } }];
    });
}

function changeEvents(previous: ViewerState, state: ViewerState, tracker: OverlayChangeTracker): PublicEvent[] {
    if (state.status !== 'ready' || state.manifest === null || state.overlays === previous.overlays) {
        return [];
    }
    return overlayEvents(tracker.changes(state.overlays), state.manifest);
}

interface CompareDetail {
    readonly open: boolean;
    readonly mode: 'swipe' | 'toggle' | null;
    readonly layerId: string | null;
    readonly position: number | null;
}

const CLOSED: CompareDetail = { open: false, mode: null, layerId: null, position: null };

/** Compare as `hcm-compare-change` states it; closed before the viewer is ready (a hash's compare waits for `hcm-ready`). */
function compareDetail(state: ViewerState): CompareDetail {
    const compare = state.compare;
    if (compare === null || state.status !== 'ready') {
        return CLOSED;
    }
    const mode = state.windowClass === 'compact' ? 'toggle' : 'swipe';
    return { open: true, mode, layerId: compare.layerId, position: compare.position };
}

function compareEvents(previous: ViewerState, state: ViewerState): PublicEvent[] {
    const before = compareDetail(previous);
    const after = compareDetail(state);
    const same = (Object.keys(after) as (keyof CompareDetail)[]).every((key) => before[key] === after[key]);
    return same ? [] : [{ type: 'hcm-compare-change', detail: { ...after } }];
}

/** The labels as announced: before the viewer is ready, the city's default (so a link's choice fires after `hcm-ready`). */
function announcedLabels(state: ViewerState): MapLabels {
    return state.status === 'ready' ? state.mapLabels.shown : state.mapLabels.defaults;
}

function mapLabelsEvents(previous: ViewerState, state: ViewerState): PublicEvent[] {
    const before = announcedLabels(previous);
    const after = announcedLabels(state);
    const same = before.streets === after.streets && before.pois === after.pois;
    return same || state.status !== 'ready'
        ? []
        : [{ type: 'hcm-map-labels-change', detail: { streets: after.streets, pois: after.pois } }];
}

/** Every public event a store transition from `previous` to `state` causes, in order. */
export function viewerEvents(
    previous: ViewerState,
    state: ViewerState,
    tracker: OverlayChangeTracker,
    engineVersion: string,
): PublicEvent[] {
    return [
        ...statusEvents(previous, state, tracker, engineVersion),
        ...changeEvents(previous, state, tracker),
        ...selectionEvents(previous, state),
        ...compareEvents(previous, state),
        ...mapLabelsEvents(previous, state),
    ];
}
