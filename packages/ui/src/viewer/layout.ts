/**
 * The viewer's adaptive layout per M3 window class (docs/research/material3-research.json → adaptive_layout),
 * measured on the viewer's own box (the store's `windowClass` and `compactHeight`), never on the browser window:
 *
 * - compact: full-bleed map, a vertical timeline on the leading edge (the owner, 2026-11-08), FAB menu; layers, photo
 *   and POI details in modal bottom sheets; About as a full-screen dialog;
 * - compact height (landscape phones, any width): the timeline lies at the bottom, too short to stand; modal side sheets;
 * - medium: floating timeline across the foot of the map; layers and details in modal side sheets, docked from 760 px wide (`dockable`:
 *   the Pixel Tablet upright, 800 px, 2026-11-12: the side sheets covered the timeline, Menu and zoom; the map shrinks);
 * - expanded and large: one docked supporting pane (standard side sheet, 360 / 412 px) for layers or details;
 * - extra-large: up to three panes, the layers panel always docked on the leading side.
 */
import type { WindowClass } from '../theme/tokens.js';

/** How a sheet is presented: modal bottom sheet, modal side sheet, or a docked standard side sheet (a pane). */
export type SheetMode = 'bottom' | 'side' | 'docked';

export interface ViewerLayout {
    /** The layers, photo, POI and photo-list sheets. */
    readonly sheetMode: SheetMode;
    /** The layers panel is always shown in its own leading pane (it never opens as a sheet). */
    readonly layersDocked: boolean;
    readonly timeline: 'horizontal' | 'vertical';
    readonly aboutFullscreen: boolean;
}

const COMPACT: ViewerLayout = { sheetMode: 'bottom', layersDocked: false, timeline: 'vertical', aboutFullscreen: true };
const MEDIUM: ViewerLayout = { sheetMode: 'side', layersDocked: false, timeline: 'horizontal', aboutFullscreen: false };
const SUPPORTING_PANE: ViewerLayout = { sheetMode: 'docked', layersDocked: false, timeline: 'horizontal', aboutFullscreen: false };
const THREE_PANES: ViewerLayout = { sheetMode: 'docked', layersDocked: true, timeline: 'horizontal', aboutFullscreen: false };
const COMPACT_HEIGHT: ViewerLayout = { sheetMode: 'side', layersDocked: false, timeline: 'horizontal', aboutFullscreen: true };

const BY_CLASS: Readonly<Record<WindowClass, ViewerLayout>> = {
    compact: COMPACT,
    medium: MEDIUM,
    expanded: SUPPORTING_PANE,
    large: SUPPORTING_PANE,
    'extra-large': THREE_PANES,
};

export function layoutFor(windowClass: WindowClass, compactHeight: boolean, dockable = false): ViewerLayout {
    if (compactHeight) {
        return COMPACT_HEIGHT;
    }
    return windowClass === 'medium' && dockable ? SUPPORTING_PANE : BY_CLASS[windowClass];
}

/**
 * Where a sheet shows, whether it is open, whether its close button minimizes it (the always-docked layers pane) and
 * whether a modal surface above it (the lightbox over a modal sheet) makes it inert.
 */
export interface Placement {
    readonly mode: SheetMode;
    readonly open: boolean;
    readonly minimizable?: boolean;
    readonly inert?: boolean;
}

export const DOCKED_OPEN: Placement = { mode: 'docked', open: true };
