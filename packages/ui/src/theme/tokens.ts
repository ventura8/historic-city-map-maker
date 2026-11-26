/**
 * Material 3 window size classes and layout tokens. Breakpoints are measured on the host
 * element (container queries + ResizeObserver), not on the viewport, so an embedded map
 * adapts to the box it is given.
 */

export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large' | 'extra-large';

interface Breakpoint {
    readonly windowClass: WindowClass;
    readonly minWidth: number;
}

/** Lower bounds in CSS px, widest first (M3: compact <600, medium <840, expanded <1200, large <1600). */
export const WINDOW_CLASS_BREAKPOINTS: readonly Breakpoint[] = [
    { windowClass: 'extra-large', minWidth: 1600 },
    { windowClass: 'large', minWidth: 1200 },
    { windowClass: 'expanded', minWidth: 840 },
    { windowClass: 'medium', minWidth: 600 },
];

/** Heights below this are "compact height" (landscape phones): controls collapse into a menu. */
export const COMPACT_HEIGHT_MAX_PX = 480;

/**
 * From this width a medium window docks its sheets beside the map instead of covering it (the Pixel Tablet upright,
 * 800 px wide, 2026-11-12: the modal side sheets covered the timeline, Menu and the zoom buttons); the map keeps 400 px.
 */
export const DOCKED_PANE_MIN_PX = 760;

/** Minimum touch target edge in CSS px (48 dp). */
export const TOUCH_TARGET_MIN_PX = 48;

/** The M3 window class for a container `width` in CSS px; anything narrower than 600 (or invalid) is compact. */
export function windowClassFor(width: number): WindowClass {
    return WINDOW_CLASS_BREAKPOINTS.find((breakpoint) => width >= breakpoint.minWidth)?.windowClass ?? 'compact';
}

/** True when a container is wide enough to dock a 360 px pane beside a map that stays usable. */
export function isDockable(width: number): boolean {
    return width >= DOCKED_PANE_MIN_PX;
}

/** True when a container is too short for the regular layout (landscape phones). */
export function isCompactHeight(height: number): boolean {
    return height < COMPACT_HEIGHT_MAX_PX;
}
