/**
 * Where the year's opacity sliders go beside its date menu (the owner, 2026-11-16; `hcm-date-menu.ts`): past the menu's end
 * side, centred on it, or before it where the end has no room; on a phone (`stacked`) under it, as wide as it, one sheet
 * with the dates on top, or beside it where a short window has no room under it; never below `floor` (the timeline's top
 * when the menu opens above it). Always inside the viewer and above the strip of Mapbox's legal line. Px from the viewer's corner.
 */

/** The gap between the menu and the sliders, and the edge kept from the viewer's sides. */
const GAP = 8;
/** The strip at the foot of the map kept for Mapbox's logo and attribution. */
const LEGAL_STRIP = 42;

export interface SideBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The viewer's size, and the lowest the sliders may reach (the timeline's top when the menu opens above it). */
export interface SideRoom {
    readonly width: number;
    readonly height: number;
    readonly floor?: number;
}

function within(at: number, length: number, low: number, high: number): number {
    return Math.max(low, Math.min(at, high - length));
}

/** The sliders' corner beside (or under) the placed menu. */
export function sideOrigin(
    menu: SideBox,
    side: { readonly width: number; readonly height: number },
    room: SideRoom,
    stacked: boolean,
): { readonly x: number; readonly y: number } {
    // Never below `floor`: above a lying timeline, the sliders taller than the menu once reached down over it (owner, 2026-11-22).
    const bottom = Math.min(room.height - LEGAL_STRIP, room.floor ?? Number.POSITIVE_INFINITY);
    const centredY = within(menu.y + menu.height / 2 - side.height / 2, side.height, GAP, bottom);
    const after = { x: menu.x + menu.width + GAP, y: centredY };
    const before = { x: menu.x - GAP - side.width, y: centredY };
    const under = { x: menu.x, y: menu.y + menu.height + GAP };
    // Above the dates: a short or narrow window (a phone lying, 800 x 360) has no room under the menu nor beside it.
    const over = { x: within(menu.x, side.width, GAP, room.width - GAP), y: menu.y - GAP - side.height };
    const order = stacked ? [under, after, before, over] : [after, before, over, under];
    const fits = (at: { x: number; y: number }): boolean =>
        at.x >= GAP && at.x + side.width <= room.width - GAP && at.y >= GAP && at.y + side.height <= bottom;
    const chosen = order.find(fits);
    if (chosen !== undefined) {
        return chosen;
    }
    const x = after.x + side.width <= room.width - GAP ? after.x : before.x;
    return { x: within(x, side.width, GAP, room.width - GAP), y: centredY };
}

/** Puts the sliders' box (`side`) by the menu; stacked, it takes the menu's width. */
export function placeSide(side: HTMLElement, menu: SideBox, room: SideRoom, stacked: boolean): void {
    side.style.setProperty('inline-size', stacked ? `${String(menu.width)}px` : '');
    const origin = sideOrigin(menu, { width: side.offsetWidth, height: side.offsetHeight }, room, stacked);
    side.style.setProperty('left', `${String(origin.x)}px`);
    side.style.setProperty('top', `${String(origin.y)}px`);
}
