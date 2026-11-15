/**
 * The map's zoom buttons (the owner, 2026-11-08; scenario V52): Zoom in and Zoom out, a vertical M3 button group on the
 * map's trailing edge (a row beside the vertical timeline on a phone held landscape; `viewer-styles.ts`). Our own icon
 * buttons, not Mapbox's NavigationControl: the kit's 48 px targets, theme and languages (DECISIONS-for-review.md §128);
 * the group's head is our own compass (V64, `hcm-compass.ts`). A click asks the store for one level (`zoomBy`); at the city's zoom limit the button
 * is soft-disabled: it says so and keeps the focus. In swipe compare the second map follows the first, so one pair serves both.
 * Zoom out's limit is the higher of `city.minZoom` and the zoom at which the city's bounds just cover the map: Mapbox keeps
 * the view inside `maxBounds`, so on most screens it stops there first (Bucharest: about 10.8 on a phone, 11.6 at 1440 px).
 */
import { translate, type BBox, type ViewerLocale, type Manifest, type MapView } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { CameraSource } from './hcm-compass.js';

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
}

/**
 * The compass (V64; its needle follows `camera`, the store) in its own pill over the group, or beside its Zoom in on a
 * short map (`dock-styles.ts`), then the group of the two zoom buttons for the camera's `view` in the city's zoom range
 * and, once the map has a box (`size`), its bounds. A hundredth of a level covers the rounding of the camera Mapbox
 * stopped. The compass's name is its tooltip, as the zoom buttons'.
 */
export function zoomButtons(
    { locale, mapSize, camera }: { readonly locale: ViewerLocale; readonly mapSize: MapSize | null; readonly camera: CameraSource | null },
    view: MapView,
    manifest: Manifest,
    { onZoom, onCompass }: MapControlHandlers,
): TemplateResult {
    const { maxZoom, bounds } = manifest.city;
    const minZoom = Math.max(manifest.city.minZoom, mapSize === null ? 0 : coverZoom(bounds, mapSize) + 0.01);
    return html`<div class="dock compass" data-layout-check="compass">
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

/**
 * The open menu marks its frame (`data-menu-open`): the zoom group and the compass fade out under it and back when it
 * closes (dock-styles.ts). The `:has(> [open])` sibling rule did not apply in Safari on the owner's iPhone (2026-11-15).
 */
export function markMenuOpen(event: Event): void {
    const open = (event as CustomEvent<{ readonly open: boolean }>).detail.open;
    (event.currentTarget as Element).closest('.frame')?.toggleAttribute('data-menu-open', open);
}
