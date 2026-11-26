/**
 * The Layers panel's pure parts (`<hcm-layer-panel>`): the list rows, the group headings, the attribution lines, the Map
 * labels note and (M27, `docs/research/M27-lost-streets.md`) the split of the pinned POI categories from the list below.
 */
import {
    categoryGroups,
    overlayLabel,
    poiIcon,
    translate,
    type ViewerLocale,
    type Manifest,
    type MessageKey,
    type Overlay,
} from '@hcm/shared';
import { creditParts } from '@hcm/shared/credits';
import { translateMapLabels } from '@hcm/shared/map-labels';

import { html } from 'lit';

import type { OverlayListGroup, OverlayListItem } from '../components/overlay-list.js';
import { dateText } from './timeline-dates.js';

/**
 * The list rows: overlay labels in `locale`; a POI category also gets its colour and its bundled icon; a historical layer its
 * date (or year) in `locale` as the row's second line. A row without a manifest layer (photos, places) has no date.
 */
export function overlayItems(overlays: readonly Overlay[], manifest: Manifest, locale: ViewerLocale): readonly OverlayListItem[] {
    const categories = new Map((manifest.poiCategories ?? []).map((category) => [category.id, category]));
    const layers = new Map(manifest.layers.map((layer) => [layer.id, layer]));
    return newestFirst(overlays, layers).map((overlay) => {
        const layer = overlay.kind === 'raster' ? layers.get(overlay.id) : undefined;
        const item = {
            id: overlay.id,
            kind: overlay.kind,
            label: overlayLabel(overlay, locale),
            visible: overlay.visible,
            opacity: overlay.opacity,
            ...(layer === undefined
                ? {}
                : {
                      detail: dateText(layer, locale),
                      // V91: a historical layer can be saved to the visitor's favourites.
                      trailing: html`<hcm-favorite-star kind="layer" item-id=${layer.id} .locale=${locale}></hcm-favorite-star>`,
                  }),
        };
        const category = overlay.kind === 'poi' ? categories.get(overlay.id) : undefined;
        return category === undefined
            ? item
            : { ...item, color: category.color, icon: poiIcon(category.icon), ...subgroupsOf(overlay, manifest, locale) };
    });
}

const GEOMETRY_LABELS: Readonly<Record<string, MessageKey>> = {
    points: 'layers.sub.points',
    lines: 'layers.sub.lines',
    areas: 'layers.sub.areas',
    // M17 §15: the "Place media" category's sub-groups, one per kind of media.
    'media:maps': 'poi.media.maps',
    'media:plans': 'poi.media.plans',
    'media:aerial': 'poi.media.aerial',
    'media:ground': 'poi.media.ground',
    'media:interior': 'poi.media.interior',
};

/** A category's sub-groups for its row (the owner, 2026-11-22), with the chevron's name and the switch's mixed state. */
function subgroupsOf(overlay: Overlay, manifest: Manifest, locale: ViewerLocale): Partial<OverlayListItem> {
    const groups = categoryGroups(manifest.pois ?? [], overlay.id);
    if (groups.length < 2) {
        return {};
    }
    const hidden = new Set(overlay.hiddenGroups ?? []);
    const label = (group: string): string => {
        const key = GEOMETRY_LABELS[group];
        return key === undefined ? group : translate(locale, key);
    };
    return {
        subgroups: groups.map((group) => ({ id: group, label: label(group), visible: overlay.visible && !hidden.has(group) })),
        expandLabel: translate(locale, 'layers.sub.expand', { name: overlayLabel(overlay, locale) }),
        mixed: overlay.visible && groups.some((group) => hidden.has(group)),
    };
}

/**
 * The historical layers newest first (the owner, 2026-11-15), by date, a year alone as its first day; equal dates keep
 * their order. The other rows (photos, places) keep their places. Only the rows: the drawing order is the overlays' own.
 */
function newestFirst(overlays: readonly Overlay[], layers: ReadonlyMap<string, Manifest['layers'][number]>): readonly Overlay[] {
    const when = (overlay: Overlay): number => {
        const layer = layers.get(overlay.id);
        return layer === undefined ? 0 : Number((layer.date ?? `${String(layer.year)}-01-01`).replaceAll('-', ''));
    };
    const sorted = overlays.filter((overlay) => overlay.kind === 'raster').sort((a, b) => when(b) - when(a));
    return overlays.map((overlay) => (overlay.kind === 'raster' ? (sorted.shift() ?? overlay) : overlay));
}

/** M27: the ids of the POI categories the manifest pins to the top strip. */
export function pinnedIds(manifest: Manifest): ReadonlySet<string> {
    return new Set((manifest.poiCategories ?? []).filter((category) => category.pinned === true).map((category) => category.id));
}

/** The overlays of the top strip (`pinned`) or of the list below (not `pinned`), in list order. */
export function splitPinned(overlays: readonly Overlay[], manifest: Manifest, pinned: boolean): readonly Overlay[] {
    const ids = pinnedIds(manifest);
    return overlays.filter((overlay) => ids.has(overlay.id) === pinned);
}

/**
 * The lists below the strip, without the photos (their switch and slider are the Photos control's, 2026-11-16). A pinned
 * category (M27's Disappeared streets) leads the places (the owner, 2026-11-22: in Places, no longer in the strip).
 */
export function listedOverlays(overlays: readonly Overlay[], manifest: Manifest): readonly Overlay[] {
    const listed = [...splitPinned(overlays, manifest, true), ...splitPinned(overlays, manifest, false)].filter(
        (overlay) => overlay.kind !== 'photos',
    );
    const disappeared = (manifest.poiCategories ?? []).find(isDisappearedCategory);
    const index = listed.findIndex((overlay) => overlay.kind === 'poi' && overlay.id === disappeared?.id);
    const renamed = listed.findIndex((overlay) => overlay.kind === 'poi' && overlay.id === 'renamed-streets');
    if (index >= 0 && renamed >= 0) {
        const [row] = listed.splice(renamed, 1);
        if (row !== undefined) {
            listed.splice(listed.findIndex((overlay) => overlay.id === disappeared?.id) + 1, 0, row);
        }
    }
    return listed;
}

function isDisappearedCategory(category: NonNullable<Manifest['poiCategories']>[number]): boolean {
    return category.id === 'strazi-disparute' || category.id === 'lost-streets' || category.label.en === 'Disappeared streets';
}

/** The group headings: historical layers always, places only when the manifest has POI categories. */
export function overlayGroups(manifest: Manifest, locale: ViewerLocale): readonly OverlayListGroup[] {
    const historical: OverlayListGroup = { kind: 'raster', label: translate(locale, 'layers.group.historical') };
    const hasPlaces = (manifest.poiCategories ?? []).length > 0;
    return hasPlaces ? [historical, { kind: 'poi', label: translate(locale, 'layers.group.places') }] : [historical];
}

/**
 * `Sursa: USGS EROS, …` once per credit of the visible historical layers and (M27) the visible POI categories that carry
 * one, in list order and in `locale` (the Pixel Tablet found the same English line once per layer: `creditParts`).
 */
export function attributionLines(overlays: readonly Overlay[], manifest: Manifest, locale: ViewerLocale): readonly string[] {
    const credited = new Map<string, string>([
        ...manifest.layers.map((layer) => [layer.id, layer.attribution] as const),
        ...(manifest.poiCategories ?? []).flatMap((category) =>
            category.attribution === undefined ? [] : [[category.id, category.attribution] as const],
        ),
    ]);
    const credits = overlays
        .filter((overlay) => overlay.kind !== 'photos' && overlay.visible)
        .flatMap((overlay) => credited.get(overlay.id) ?? []);
    return creditParts(credits, locale).map((attribution) => translate(locale, 'layers.attribution', { attribution }));
}

/** The note below the switches: what they are, and how they differ from the city's own places when it has some. */
export function labelsNote(manifest: Manifest, locale: ViewerLocale): string {
    const note = translateMapLabels(locale, 'mapLabels.note');
    return (manifest.poiCategories ?? []).length > 0 ? `${note} ${translateMapLabels(locale, 'mapLabels.notePlaces')}` : note;
}
