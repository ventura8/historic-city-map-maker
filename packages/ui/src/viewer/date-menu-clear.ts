/**
 * Where `<hcm-date-menu>` goes when its place beside the year would cover a floating control (V68, the owner 2026-11-13:
 * "no overlap with the compass, zoom or FAB, and the menu stays inside the viewport"). When given a timeline `axis`
 * (`'x'` for a lying timeline, `'y'` for a standing one), the menu shifts along that axis first so it stays anchored
 * beside the timeline rather than jumping to a corner; only if no along-axis place is clear does it try all four sides.
 * It never covers the timeline's card and never leaves the viewer or enters Mapbox's legal strip; with no clear place it
 * stays where it was asked (the tour's checks would then say so).
 */

/** A box in the viewer's px. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Axis to shift along first when clearing controls: `'x'` along a lying timeline, `'y'` along a standing one. */
export type Axis = 'x' | 'y';

/** Px kept between the menu and what it avoids, and from the viewer's edges. */
const GAP = 8;
/** How many controls the menu may move past in a row. */
const STEPS = 3;

function meets(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The menu `menu` moved just past `box` along `axis` (or on all four sides when omitted). */
function besides(menu: Box, box: Box, axis?: Axis): Box[] {
    const alongX = [
        { ...menu, x: box.x - GAP - menu.width },
        { ...menu, x: box.x + box.width + GAP },
    ];
    const alongY = [
        { ...menu, y: box.y - GAP - menu.height },
        { ...menu, y: box.y + box.height + GAP },
    ];
    if (axis === 'x') {
        return alongX;
    }
    if (axis === 'y') {
        return alongY;
    }
    return [...alongX, ...alongY];
}

function moved(a: Box, b: Box): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function search(menu: Box, avoid: readonly Box[], clear: (box: Box) => boolean, axis?: Axis): Box | undefined {
    let tried: readonly Box[] = [menu];
    for (let step = 0; step <= STEPS && !tried.some(clear); step++) {
        tried = tried.flatMap((box) => avoid.filter((other) => meets(box, other)).flatMap((other) => besides(box, other, axis)));
    }
    return [...tried].filter(clear).sort((a, b) => moved(a, menu) - moved(b, menu))[0];
}

/**
 * The menu's box clear of `avoid` (the controls and the card), inside `room` (the viewer) above its `foot` px, moved as
 * little as it can (along `axis` first when given); `menu` itself when it is already clear or nothing clear is found.
 */
export function clearOf(
    menu: Box,
    avoid: readonly Box[],
    room: { readonly width: number; readonly height: number },
    { foot, axis }: { readonly foot: number; readonly axis?: Axis },
): Box {
    const fits = (box: Box): boolean =>
        box.x >= GAP && box.y >= GAP && box.x + box.width <= room.width - GAP && box.y + box.height <= room.height - foot;
    const clear = (box: Box): boolean => fits(box) && !avoid.some((other) => meets(box, other));
    const along = axis === undefined ? undefined : search(menu, avoid, clear, axis);
    return along ?? search(menu, avoid, clear) ?? menu;
}
