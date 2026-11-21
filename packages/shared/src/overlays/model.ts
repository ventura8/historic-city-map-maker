/**
 * The overlay model (PLAN Addendum 3 → Live transparency for every overlay). Every historical layer, the photos (markers
 * and view cones) and every POI category is an overlay with its own visibility and opacity, listed in one order:
 * historical layers by year (then by drawing order, top first), the photos, then the POI categories in manifest order.
 *
 * Pure and immutable: an update returns a new list, and `withOverlayOpacity`, `withOverlayVisibility` and
 * `withHashOpacity` return the same list when nothing changed (an unknown id, the same value), so a store can skip a
 * render. The viewer's Layers panel, its URL hash (`&op=`) and the admin's default-opacity sliders all use them.
 */
import { localized, translate, type ViewerLocale } from '../i18n/index.js';
import { clamp, roundTo } from '../geo/math.js';
import type { Layer, Manifest } from '../schemas/manifest.js';
import type { PoiCategory } from '../schemas/poi.js';
import { PHOTOS_OVERLAY_ID } from '../schemas/primitives.js';
import type { HashState } from '../url/hash.js';

export const OVERLAY_KINDS = ['raster', 'photos', 'poi'] as const;

export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** The photos start fully opaque unless the manifest's `photosOverlay.defaultOpacity` says otherwise. */
export const DEFAULT_PHOTOS_OPACITY = 1;

export interface OverlayLabel {
    readonly ro: string;
    readonly en: string;
}

export interface Overlay {
    /** The layer id, `PHOTOS_OVERLAY_ID` or the POI category id (one namespace, checked by the manifest schema). */
    readonly id: string;
    readonly kind: OverlayKind;
    readonly label: OverlayLabel;
    readonly visible: boolean;
    /** 0 to 1. */
    readonly opacity: number;
    /** The manifest's values: the URL hash records only an opacity that differs from `defaultOpacity`. */
    readonly defaultVisible: boolean;
    readonly defaultOpacity: number;
}

type OverlayDefaults = Pick<Overlay, 'id' | 'kind' | 'label' | 'visible' | 'opacity'>;

/** An overlay at its defaults: the current state starts equal to them. */
function atDefaults(defaults: OverlayDefaults): Overlay {
    return { ...defaults, defaultVisible: defaults.visible, defaultOpacity: defaults.opacity };
}

function byYearThenTopFirst(a: Layer, b: Layer): number {
    return a.year - b.year || b.order - a.order;
}

function rasterOverlay(layer: Layer): Overlay {
    return atDefaults({ id: layer.id, kind: 'raster', label: layer.label, visible: layer.defaultVisible, opacity: layer.opacity });
}

/** A POI category starts visible unless (M27) its `defaultVisible` is false, at its default opacity. */
function poiOverlay(category: PoiCategory): Overlay {
    const visible = category.defaultVisible !== false;
    return atDefaults({ id: category.id, kind: 'poi', label: category.label, visible, opacity: category.defaultOpacity });
}

const PHOTOS_LABEL: OverlayLabel = { ro: translate('ro', 'layers.photos'), en: translate('en', 'layers.photos') };

/** The overlays of a validated manifest, in list order, at their manifest defaults. */
export function overlaysFromManifest(manifest: Manifest): readonly Overlay[] {
    const photosOpacity = manifest.photosOverlay?.defaultOpacity ?? DEFAULT_PHOTOS_OPACITY;
    return [
        ...manifest.layers.toSorted(byYearThenTopFirst).map(rasterOverlay),
        atDefaults({ id: PHOTOS_OVERLAY_ID, kind: 'photos', label: PHOTOS_LABEL, visible: true, opacity: photosOpacity }),
        ...(manifest.poiCategories ?? []).map(poiOverlay),
    ];
}

export function findOverlay(overlays: readonly Overlay[], id: string): Overlay | undefined {
    return overlays.find((candidate) => candidate.id === id);
}

/** An overlay's name in `locale`: the photos' from the catalogue (fetched after this module loads), a city's own otherwise. */
export function overlayLabel(target: Overlay, locale: ViewerLocale): string {
    return target.kind === 'photos' ? translate(locale, 'layers.photos') : localized(target.label, locale);
}

/** Opacity as the slider and the hash show it: a whole percent, 0 to 100. */
export function opacityPercent(opacity: number): number {
    return Math.round(clamp(opacity, 0, 1) * 100);
}

function replaceWhere(overlays: readonly Overlay[], id: string, change: (target: Overlay) => Overlay): readonly Overlay[] {
    const index = overlays.findIndex((candidate) => candidate.id === id);
    const target = overlays[index];
    if (target === undefined) {
        return overlays;
    }
    const changed = change(target);
    return changed === target ? overlays : overlays.with(index, changed);
}

/** Sets one overlay's opacity, clamped to 0..1; an unknown id or an unchanged value returns `overlays` itself. */
export function withOverlayOpacity(overlays: readonly Overlay[], id: string, opacity: number): readonly Overlay[] {
    const value = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : null;
    return replaceWhere(overlays, id, (target) => (value === null || value === target.opacity ? target : { ...target, opacity: value }));
}

/** Shows or hides one overlay; without `visible` it toggles. An unknown id returns `overlays` itself. */
export function withOverlayVisibility(overlays: readonly Overlay[], id: string, visible?: boolean): readonly Overlay[] {
    return replaceWhere(overlays, id, (target) => {
        const next = visible ?? !target.visible;
        return next === target.visible ? target : { ...target, visible: next };
    });
}

/**
 * Applies the opacities of a decoded URL hash: `opacity` (the single historical-layer slider of v1) to the visible
 * raster overlays (docs/ENGINE_API.md → URL hash v1; apply the hash's `layers` first), then each `op` entry to its
 * overlay, which wins. A hidden layer keeps its own opacity. Unknown ids are ignored; values are clamped.
 */
export function withHashOpacity(overlays: readonly Overlay[], hash: Pick<HashState, 'opacity' | 'overlayOpacity'>): readonly Overlay[] {
    const entries = [...rasterEntries(overlays, hash.opacity), ...Object.entries(hash.overlayOpacity ?? {})];
    return entries.reduce((list, [id, value]) => withOverlayOpacity(list, id, value), overlays);
}

/** `[id, opacity]` for every visible raster overlay; none without an opacity. */
function rasterEntries(overlays: readonly Overlay[], opacity: number | undefined): [string, number][] {
    if (opacity === undefined) {
        return [];
    }
    return overlays.filter((target) => target.kind === 'raster' && target.visible).map((target) => [target.id, opacity]);
}

/**
 * The `overlayOpacity` of the URL hash: the overlays whose opacity, in whole percent, differs from their default.
 * Undefined when none does, so an untouched viewer writes no `&op=`.
 */
export function hashOverlayOpacity(overlays: readonly Overlay[]): Readonly<Record<string, number>> | undefined {
    const changed = overlays.filter((target) => opacityPercent(target.opacity) !== opacityPercent(target.defaultOpacity));
    return changed.length === 0 ? undefined : Object.fromEntries(changed.map((target) => [target.id, roundTo(target.opacity, 2)]));
}

/** Every overlay back at its manifest defaults (the admin's "reset", the viewer's new manifest). */
export function resetOverlays(overlays: readonly Overlay[]): readonly Overlay[] {
    return overlays.map((target) => ({ ...target, visible: target.defaultVisible, opacity: target.defaultOpacity }));
}
