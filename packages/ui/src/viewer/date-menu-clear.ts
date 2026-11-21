/**
 * Where `<hcm-date-menu>` goes when its place beside the year would cover a floating control (V68, the owner 2026-11-13:
 * "no overlap with the compass, zoom or FAB, and the menu stays inside the viewport"). The menu moves the shortest way
 * past the controls it meets (to either side, above or below them, a few steps at most), never over the timeline's card
 * it opens beside and never out of the viewer or onto the strip of Mapbox's legal line; with no such place it stays where
 * it was asked (the tour's checks would then say so).
 */

/** A box in the viewer's px. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Px kept between the menu and what it avoids, and from the viewer's edges. */
const GAP = 8;
/** How many controls the menu may move past in a row. */
const STEPS = 3;

function meets(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The menu `menu` moved just past `box` on each of its four sides. */
function besides(menu: Box, box: Box): Box[] {
    return [
        { ...menu, x: box.x - GAP - menu.width },
        { ...menu, x: box.x + box.width + GAP },
        { ...menu, y: box.y - GAP - menu.height },
        { ...menu, y: box.y + box.height + GAP },
    ];
}

function moved(a: Box, b: Box): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * The menu's box clear of `avoid` (the controls and the card), inside `room` (the viewer) above its `foot` px, moved as
 * little as it can; `menu` itself when it is already clear or nothing clear is found within `STEPS` moves.
 */
export function clearOf(menu: Box, avoid: readonly Box[], room: { readonly width: number; readonly height: number }, foot: number): Box {
    const fits = (box: Box): boolean =>
        box.x >= GAP && box.y >= GAP && box.x + box.width <= room.width - GAP && box.y + box.height <= room.height - foot;
    const clear = (box: Box): boolean => fits(box) && !avoid.some((other) => meets(box, other));
    let tried: readonly Box[] = [menu];
    for (let step = 0; step <= STEPS && !tried.some(clear); step++) {
        tried = tried.flatMap((box) => avoid.filter((other) => meets(box, other)).flatMap((other) => besides(box, other)));
    }
    return [...tried].filter(clear).sort((a, b) => moved(a, menu) - moved(b, menu))[0] ?? menu;
}
