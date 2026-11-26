/**
 * The georeferencer's context menu, the page's side (`docs/research/M3-interfaces.md` §10.4, addendum of 2026-11-12): what
 * opens it on either pane (a right-click, a touch held still for `LONG_PRESS_MS`, the ContextMenu key or Shift+F10 at the
 * focused pane's centre), what it offers there (Add a point here; Move and Delete this point when one is within the panes'
 * hit radius; Undo when there is a step; nothing that edits on a read-only version: the element, `./georef-menu.ts`, says
 * so). Part of the element's lazy chunk (`georef-menu-<hash>.js`, re-exported by `./georef-menu.ts`), which the page
 * fetches at its first render, so the `georef` chunk keeps its budget.
 */
import type { GeorefIntentsPort, HalfPairPort } from './georef-port.js';
import type { HcmScanViewer } from './hcm-scan-viewer.js';
import type { Point } from './scan-view.js';

/** How long a touch is held still before the menu opens (ms), and how far it may drift (CSS px). */
export const LONG_PRESS_MS = 500;
const PRESS_SLOP = 8;

/** Where the menu opened and what is there (`menuAt` finds it). */
export interface GeorefMenuOpen {
    readonly pane: 'scan' | 'map';
    /** Where the menu shows (viewport CSS px). */
    readonly at: Point;
    /** One end of a pair exactly there (null: the map cannot say where). */
    readonly end: HalfPairPort | null;
    /** The pair drawn within the hit radius, or null. */
    readonly hit: string | null;
}

/** The pane an event happened in (its `.scan-pane` or `.map-pane` box), or null. */
function paneOf(event: Event): HTMLElement | null {
    const found = event.composedPath().find((node) => node instanceof HTMLElement && node.matches('.scan-pane, .map-pane'));
    return (found as HTMLElement | undefined) ?? null;
}

/** The pane's surface: the scan viewer or the admin map. */
function surfaceOf(pane: HTMLElement): HTMLElement | null {
    return pane.querySelector<HTMLElement>('hcm-scan-viewer, hcm-admin-map');
}

/**
 * What is under `at` on a pane: the scan's pixel and pair, or the map's place and pair (asked of the store); null where the
 * menu would be empty (the map cannot say where, no pair there, and `always` false: no Undo and not read-only).
 */
export function menuAt(pane: HTMLElement, at: Point, intents: GeorefIntentsPort | null, always: boolean): GeorefMenuOpen | null {
    const surface = surfaceOf(pane);
    if (surface === null) {
        return null;
    }
    return surface.localName === 'hcm-scan-viewer' ? scanMenu(surface as HcmScanViewer, at) : mapMenu(surface, at, intents, always);
}

function scanMenu(viewer: HcmScanViewer, at: Point): GeorefMenuOpen {
    const target = viewer.targetAt({ clientX: at.x, clientY: at.y });
    return { pane: 'scan', at, end: { pixel: target.pixel }, hit: target.hit };
}

/** The map's place and pair come from the store (it has the map); none without a map. */
function mapMenu(surface: HTMLElement, at: Point, intents: GeorefIntentsPort | null, always: boolean): GeorefMenuOpen | null {
    const box = surface.getBoundingClientRect();
    const target = intents?.mapTarget({ x: at.x - box.left, y: at.y - box.top }) ?? null;
    if (target === null) {
        return always ? { pane: 'map', at, end: null, hit: null } : null;
    }
    return { pane: 'map', at, end: { geo: target.geo }, hit: target.hit };
}

/** The pane's centre (the keyboard's crosshair), in viewport CSS px. */
function centreOf(pane: HTMLElement): Point {
    const box = (surfaceOf(pane) ?? pane).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

interface Press {
    readonly id: number;
    readonly start: Point;
    readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The gestures that open the menu, listened to on the page's shadow root: `open` gets the pane and the point. A long press
 * that opened it is no click: the scan forgets the press (`cancelGesture`), and the map's click after it is swallowed.
 */
export class MenuGestures {
    readonly #open: (pane: HTMLElement, at: Point) => void;
    #press: Press | null = null;
    /** A long press opened the menu: its click goes nowhere. */
    #fired = false;

    constructor(open: (pane: HTMLElement, at: Point) => void) {
        this.#open = open;
    }

    attach(root: Node): void {
        root.addEventListener('contextmenu', this.#context);
        root.addEventListener('keydown', this.#key as EventListener);
        root.addEventListener('pointerdown', this.#down as EventListener, true);
        root.addEventListener('pointermove', this.#move as EventListener, true);
        root.addEventListener('pointerup', this.#end, true);
        root.addEventListener('pointercancel', this.#end, true);
        root.addEventListener('click', this.#click, true);
    }

    readonly #context = (event: Event): void => {
        const pane = paneOf(event);
        if (pane === null) {
            return;
        }
        event.preventDefault();
        // A touch's own context menu (before the timer): the same long press.
        const press = this.#press;
        if (press !== null) {
            this.#end();
            this.#longPress(pane, press.start);
        } else if (!this.#fired) {
            const mouse = event as MouseEvent;
            this.#open(pane, { x: mouse.clientX, y: mouse.clientY });
        }
    };

    readonly #key = (event: KeyboardEvent): void => {
        const pane = paneOf(event);
        if (pane !== null && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            this.#open(pane, centreOf(pane));
        }
    };

    readonly #down = (event: PointerEvent): void => {
        this.#end();
        this.#fired = false;
        const pane = paneOf(event);
        if (pane === null || event.pointerType === 'mouse' || !event.isPrimary) {
            return;
        }
        const start = { x: event.clientX, y: event.clientY };
        const timer = setTimeout(() => {
            this.#longPress(pane, start);
        }, LONG_PRESS_MS);
        this.#press = { id: event.pointerId, start, timer };
    };

    #longPress(pane: HTMLElement, start: Point): void {
        this.#press = null;
        this.#fired = true;
        pane.querySelector<HcmScanViewer>('hcm-scan-viewer')?.cancelGesture();
        this.#open(pane, start);
    }

    readonly #move = (event: PointerEvent): void => {
        const press = this.#press;
        if (press?.id === event.pointerId && Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y) > PRESS_SLOP) {
            this.#end();
        }
    };

    /** The press ended (or a second finger came, or it drifted): no menu. */
    readonly #end = (): void => {
        if (this.#press !== null) {
            clearTimeout(this.#press.timer);
            this.#press = null;
        }
    };

    readonly #click = (event: Event): void => {
        if (this.#fired) {
            this.#fired = false;
            event.stopPropagation();
            event.preventDefault();
        }
    };
}
