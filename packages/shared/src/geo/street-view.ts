/**
 * Google Street View at a place (the owner, 2026-11-09): a plain link that opens Google Maps' panorama in a new tab, with
 * no Google script, no key and no cost (Maps URLs, `map_action=pano`). The heading, when known, is the direction to look.
 */
import { roundTo } from './math.js';

export function streetViewUrl(place: { readonly lat: number; readonly lng: number }, heading?: number): string {
    const viewpoint = `${String(roundTo(place.lat, 6))},${String(roundTo(place.lng, 6))}`;
    const look = heading === undefined ? '' : `&heading=${String(Math.round(heading) % 360)}`;
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}${look}`;
}
