/**
 * Where the year's opacity sliders go beside its date menu (the owner, 2026-11-16; `hcm-date-menu.ts`): past the menu's end
 * side, centred on it, or before it where the end has no room; on a phone (`stacked`) under it, as wide as it, one sheet
 * with the dates on top, or beside it where a short window has no room under it. Always inside the viewer and above the strip of Mapbox's legal line. Px from the viewer's corner.
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

function within(at: number, length: number, low: number, high: number): number {
    return Math.max(low, Math.min(at, high - length));
}

/** The sliders' corner beside (or under) the placed menu. */
export function sideOrigin(
    menu: SideBox,
    side: { readonly width: number; readonly height: number },
    room: { readonly width: number; readonly height: number },
    stacked: boolean,
): { readonly x: number; readonly y: number } {
    const bottom = room.height - LEGAL_STRIP;
    const under = menu.y + menu.height + GAP;
    if (stacked && under + side.height <= bottom) {
        return { x: menu.x, y: under };
    }
    const after = menu.x + menu.width + GAP;
    const x = after + side.width <= room.width - GAP ? after : menu.x - GAP - side.width;
    const y = menu.y + menu.height / 2 - side.height / 2;
    return { x: within(x, side.width, GAP, room.width - GAP), y: within(y, side.height, GAP, bottom) };
}

/** Puts the sliders' box (`side`) by the menu; stacked, it takes the menu's width. */
export function placeSide(
    side: HTMLElement,
    menu: SideBox,
    room: { readonly width: number; readonly height: number },
    stacked: boolean,
): void {
    side.style.setProperty('inline-size', stacked ? `${String(menu.width)}px` : '');
    const origin = sideOrigin(menu, { width: side.offsetWidth, height: side.offsetHeight }, room, stacked);
    side.style.setProperty('left', `${String(origin.x)}px`);
    side.style.setProperty('top', `${String(origin.y)}px`);
}
