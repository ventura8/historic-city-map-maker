/**
 * Mapbox's logo and attribution in the part of the map a modal sheet leaves in view (scenario V18; Mapbox terms; the
 * Pixel 9 Pro review, P3). The sheets draw above Mapbox's controls, which sit in the map's bottom corners: while a bottom
 * sheet is open the controls rise to its top edge, while a side sheet is open the corner it covers moves beside it. The
 * sheet's own box decides (it changes height when dragged and between its heights, and the viewer never knows its
 * detent): a ResizeObserver on the open modal sheet reports each new box. The lightbox and a full-screen dialog hide the
 * whole map, so nothing there needs a credit; a centred dialog leaves the corners in view.
 */

/** How far each of Mapbox's bottom corners moves, in CSS px: up, in from the left edge, in from the right edge. */
export interface LegalLift {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}

export const NO_LIFT: LegalLift = { bottom: 0, left: 0, right: 0 };

/** Box edges, as a DOMRect gives them. */
export interface Edges {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

/** A sheet edge within a pixel of the viewer's edge touches it (sub-pixel layout). */
const TOUCH_PX = 1;

/**
 * The lift for a sheet of box `sheet` over a viewer of box `viewer`: a sheet as wide as the viewer (a bottom sheet) lifts
 * both corners above its top edge; a sheet on one side (a side sheet) moves that side's corner beside it; no sheet, none.
 */
export function liftFor(viewer: Edges, sheet: Edges | null): LegalLift {
    if (sheet === null || sheet.bottom - sheet.top < 1) {
        return NO_LIFT;
    }
    const onLeft = sheet.left - viewer.left <= TOUCH_PX;
    const onRight = viewer.right - sheet.right <= TOUCH_PX;
    const lifts: Readonly<Record<string, LegalLift>> = {
        'true,true': { ...NO_LIFT, bottom: inPx(viewer.bottom - sheet.top) },
        'false,true': { ...NO_LIFT, right: inPx(viewer.right - sheet.left) },
        'true,false': { ...NO_LIFT, left: inPx(sheet.right - viewer.left) },
    };
    return lifts[`${String(onLeft)},${String(onRight)}`] ?? NO_LIFT;
}

/** A distance as whole CSS px, never negative. */
function inPx(distance: number): number {
    return Math.max(0, Math.round(distance));
}

/**
 * The surface of the open `<hcm-sheet>` under `root` (modal, or the standard Layers sheet), searched through open shadow
 * roots; null when none is open.
 */
export function openModalSheet(root: ParentNode): Element | null {
    const sheet = root.querySelector('hcm-sheet[open]');
    if (sheet !== null) {
        return sheet.shadowRoot?.querySelector('.sheet') ?? null;
    }
    return inShadowRoots(root);
}

/** The open modal sheet's surface inside the shadow roots of `root`'s elements, depth first. */
function inShadowRoots(root: ParentNode): Element | null {
    for (const host of root.querySelectorAll('*')) {
        const found = host.shadowRoot === null ? null : openModalSheet(host.shadowRoot);
        if (found !== null) {
            return found;
        }
    }
    return null;
}

/** Whether two lifts are the same (a new box at the same lift re-renders nothing). */
export function sameLift(a: LegalLift, b: LegalLift): boolean {
    return a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/**
 * Watches the open modal sheet under `root()` (null before the element has its shadow root; call `refresh` after each render: a sheet opens, closes or changes) and reports
 * the lift for the viewer's box (`viewer`) whenever the sheet's box changes.
 */
export class LegalLiftWatcher {
    readonly #root: () => ParentNode | null;
    readonly #viewer: () => Edges;
    readonly #report: (lift: LegalLift) => void;
    readonly #observer: ResizeObserver;
    #watched: Element | null = null;
    /**
     * A sheet slides in from past the viewer's edge (`@starting-style`): measured as it opens it lifts nothing, and its
     * slide changes no size the ResizeObserver sees, so its box is read again when a transition on it ends (Mapbox's
     * logo stayed under a phone's sheet once the viewer stopped scrolling to the sheet's focus, the tour 2026-11-24).
     */
    readonly #settled = (): void => {
        this.#measure();
    };

    constructor(root: () => ParentNode | null, viewer: () => Edges, report: (lift: LegalLift) => void) {
        this.#root = root;
        this.#viewer = viewer;
        this.#report = report;
        this.#observer = new ResizeObserver(() => {
            this.#measure();
        });
    }

    refresh(): void {
        const root = this.#root();
        const sheet = root === null ? null : openModalSheet(root);
        if (sheet !== this.#watched) {
            this.stop();
            this.#watched = sheet;
            if (sheet !== null) {
                this.#observer.observe(sheet);
                sheet.addEventListener('transitionend', this.#settled);
            }
            this.#measure();
        }
    }

    stop(): void {
        this.#observer.disconnect();
        this.#watched?.removeEventListener('transitionend', this.#settled);
        this.#watched = null;
    }

    #measure(): void {
        this.#report(liftFor(this.#viewer(), this.#watched?.getBoundingClientRect() ?? null));
    }
}
