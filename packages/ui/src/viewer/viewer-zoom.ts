/**
 * The map's zoom buttons (the owner, 2026-11-08; scenario V52): Zoom in and Zoom out, a vertical M3 button group on the
 * map's trailing edge (a row beside the vertical timeline on a phone held landscape; `viewer-styles.ts`). Our own icon
 * buttons, not Mapbox's NavigationControl: the kit's 48 px targets, theme and languages (DECISIONS-for-review.md §128);
 * the group's head is our own compass (V64, `hcm-compass.ts`). A click asks the store for one level (`zoomBy`); at the city's zoom limit the button
 * is soft-disabled: it says so and keeps the focus. In swipe compare the second map follows the first, so one pair serves both.
 * Zoom out's limit is the higher of `city.minZoom` and the zoom at which the city's bounds just cover the map: Mapbox keeps
 * the view inside `maxBounds`, so on most screens it stops there first (Bucharest: about 10.8 on a phone, 11.6 at 1440 px).
 */
import { translate, type BBox, type ViewerLocale, type Manifest } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { CameraSource } from './hcm-compass.js';
import { frontShotDirection } from './shot-direction.js';
import type { ViewerState } from './store-port.js';

/**
 * One button: its name is also its tooltip; at the limit it is soft-disabled and its press never reaches the store (Zoom
 * out's limit comes from the map's box, which the store does not know: Mapbox would clamp the flight back, but only after
 * moving the map and rewriting the address).
 */
function zoomButton(label: string, icon: string, atLimit: boolean, onClick: () => void): TemplateResult {
    return html`<hcm-icon-button
        icon=${icon}
        .label=${label}
        title=${label}
        ?soft-disabled=${atLimit}
        @click=${atLimit ? nothing : onClick}
    ></hcm-icon-button>`;
}

/** The map's box in CSS px. */
export interface MapSize {
    readonly width: number;
    readonly height: number;
}

/** A latitude's Web Mercator y, in world widths. */
function mercatorY(lat: number): number {
    return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
}

/** The lowest zoom at which `bounds` still cover a map of `size` (Mapbox's world is 512 px wide at zoom 0). */
export function coverZoom([[west, south], [east, north]]: BBox, size: MapSize): number {
    return Math.log2(Math.max((size.width * 360) / (east - west), size.height / (mercatorY(north) - mercatorY(south))) / 512);
}

/** What the group's buttons do: one level in (1) or out (-1), and the compass's press (north up, V64). */
export interface MapControlHandlers {
    readonly onZoom: (step: number) => void;
    readonly onCompass: () => void;
    readonly onLocate: () => void;
    /** V93: the map turned to the shot direction of the image on top. */
    readonly onShotDirection: () => void;
}

/**
 * The compass (V64; its needle follows `camera`, the store) in its own pill over the group, or beside its Zoom in on a
 * short map (`dock-styles.ts`), then the group of the two zoom buttons for the camera's `view` in the city's zoom range
 * and, once the map has a box (`size`), its bounds. A hundredth of a level covers the rounding of the camera Mapbox
 * stopped. The compass's name is its tooltip, as the zoom buttons'. Over the compass, Show my location (V10; the owner,
 * 2026-11-22): an icon button only, its name its tooltip, selected while the dot shows.
 */
export function zoomButtons(
    {
        locale,
        mapSize,
        camera,
        locating,
    }: {
        readonly locale: ViewerLocale;
        readonly mapSize: MapSize | null;
        readonly camera: CameraSource | null;
        readonly locating: boolean;
    },
    state: Pick<ViewerState, 'view' | 'year' | 'front' | 'overlays'>,
    manifest: Manifest,
    { onZoom, onCompass, onLocate, onShotDirection }: MapControlHandlers,
): TemplateResult {
    const { maxZoom, bounds } = manifest.city;
    const { view } = state;
    // V93: the shot direction of the image on top, or null (no button).
    const shot = frontShotDirection(manifest, state);
    const minZoom = Math.max(manifest.city.minZoom, mapSize === null ? 0 : coverZoom(bounds, mapSize) + 0.01);
    const locate = translate(locale, 'action.locate');
    return html`<div class="dock locate ${shot === null ? '' : 'over-shot'}" data-layout-check="locate">
            <hcm-icon-button
                icon="my_location"
                toggle
                .label=${locate}
                title=${locate}
                .selected=${locating}
                @click=${onLocate}
            ></hcm-icon-button>
        </div>
        ${shotButton(locale, shot, onShotDirection)}
        <div class="dock compass" data-layout-check="compass">
            <hcm-compass .source=${camera} locale=${locale} title=${translate(locale, 'viewer.compass')} @click=${onCompass}></hcm-compass>
        </div>
        <div class="dock zoom" data-layout-check="zoom">
            ${zoomButton(translate(locale, 'viewer.zoomIn'), 'add', view.zoom >= maxZoom, () => {
                onZoom(1);
            })}
            ${zoomButton(translate(locale, 'viewer.zoomOut'), 'remove', view.zoom <= minZoom, () => {
                onZoom(-1);
            })}
        </div>`;
}

/** V93: the round button that turns the map to the image's shot direction, its name its tooltip; none without one. */
function shotButton(locale: ViewerLocale, shot: number | null, onClick: () => void): TemplateResult {
    if (shot === null) {
        return html``;
    }
    const label = translate(locale, 'viewer.shotDirection', { degrees: String(Math.round(shot) % 360) });
    return html`<div class="dock shot" data-layout-check="shot-direction">
        <hcm-icon-button icon="satellite_alt" .label=${label} title=${label} @click=${onClick}></hcm-icon-button>
    </div>`;
}

/**
 * The open menu marks its frame (`data-menu-open`): the zoom group and the compass fade out under it and back when it
 * closes (dock-styles.ts). The `:has(> [open])` sibling rule did not apply in Safari on the owner's iPhone (2026-11-15).
 */
export function markMenuOpen(event: Event): void {
    const open = (event as CustomEvent<{ readonly open: boolean }>).detail.open;
    (event.currentTarget as Element).closest('.frame')?.toggleAttribute('data-menu-open', open);
}
