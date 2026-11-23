/**
 * Where `<hcm-date-menu>`'s box goes (`hcm-date-menu.ts`): the dates alone, or the dates and the year's opacity sliders
 * side by side (the owner, 2026-11-23). Beside the anchor, inside the viewer, above the strip of Mapbox's legal line, and
 * never taller than the room over a lying timeline. Px from the viewer's corner.
 */
import type { DatesOpenDetail } from './timeline-dates.js';

/** Px kept from the viewer's edges, and from the anchor. */
const EDGE = 8;
/** The strip at the foot of the map kept for Mapbox's logo and attribution (`--hcm-map-chrome`). */
const LEGAL_STRIP = 42;
/** The menu's width limits (M3 menus: 112 to 280 px). */
const MIN_WIDTH = 112;
export const MAX_WIDTH = 280;
/** The widest the dates and the sliders side by side may be: a 280 px menu, the gap and the 280 px sliders. */
export const PAIR_MAX_WIDTH = 2 * MAX_WIDTH + EDGE;
/** The fewest px of height the pair keeps above a lying timeline (a short window scrolls its columns). */
const MIN_HEIGHT = 96;

type Box = DatesOpenDetail['anchor'];

/** The side of the timeline the menu opens on: above a lying one, past or before a standing one. */
export type Side = 'above' | 'end' | 'start';

/** Where the menu's corner goes in the viewer (px from its top-left): beside the anchor, moved back inside when it would leave. */
export function dateMenuOrigin(
    anchor: Box,
    menu: { readonly width: number; readonly height: number },
    room: { readonly width: number; readonly height: number },
    side: Side,
): { readonly x: number; readonly y: number } {
    const centreX = anchor.x + anchor.width / 2 - menu.width / 2;
    const centreY = anchor.y + anchor.height / 2 - menu.height / 2;
    const wanted = {
        above: { x: centreX, y: anchor.y - EDGE - menu.height },
        end: { x: anchor.x + anchor.width + EDGE, y: centreY },
        start: { x: anchor.x - EDGE - menu.width, y: centreY },
    }[side];
    const within = (at: number, length: number, end: number): number => Math.max(EDGE, Math.min(at, end - length));
    return { x: within(wanted.x, menu.width, room.width - EDGE), y: within(wanted.y, menu.height, room.height - LEGAL_STRIP) };
}

/** The widest the menu (with the sliders, the pair: `max`) may be (px) beside a standing timeline, or above a lying one. */
export function sideRoom(anchor: Box, width: number, side: Side, max = MAX_WIDTH): number {
    const room = { above: width, end: width - (anchor.x + anchor.width), start: anchor.x }[side] - 2 * EDGE;
    return Math.max(MIN_WIDTH, Math.min(max, room));
}

/** The tallest the pair may be (px): above a lying timeline, the room over the anchor; else the viewer above the legal strip. */
export function pairHeight(anchor: Box, height: number, side: Side): number {
    const room = side === 'above' ? anchor.y - 2 * EDGE : height - LEGAL_STRIP - EDGE;
    return Math.max(MIN_HEIGHT, room);
}
