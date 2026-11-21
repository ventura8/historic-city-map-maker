/**
 * The New city map's rectangle gesture (`docs/research/M5-interfaces.md` §1.6; behaviour A50): while the page draws, a
 * drag on the map, from one corner of the city to the other, makes the rectangle; two clicks make it too (the
 * single-pointer way, WCAG 2.5.7). The listeners sit on the element Mapbox draws into, in the capture phase, so the map
 * neither pans nor sees the press while drawing, and nothing covers the map or its zoom buttons. Move the map hands the
 * pointer back to the map. Points are in the map's own pixels.
 *
 * Only the primary pointer draws: a second finger cancels the drag and the two-finger gesture reaches the map (pinch to
 * zoom), so lifting the first finger never draws between the two. While a drag or a two-click rectangle is under way a
 * dashed band shows it, from the press (or the first click) to the pointer (`docs/LESSONS.md` 253).
 */
import type { ScreenPointPort } from './cities-port.js';

/** A pointer that moved less than this between down and up is a click, not a drag. */
const CLICK_SLOP_PX = 4;

/** Where points are measured from once the gesture has no element any more (never while one listens). */
const NO_RECT = { left: 0, top: 0 } as const;

/** The band's look: a dashed outline in the primary colour, under nothing the pointer needs. */
const BAND_STYLE: readonly (readonly [string, string])[] = [
    ['position', 'absolute'],
    ['box-sizing', 'border-box'],
    ['border', '2px dashed var(--md-sys-color-primary, #6750a4)'],
    ['pointer-events', 'none'],
    ['z-index', '1'],
];

/** A touch with two fingers or more: a pinch, which the map takes even while drawing. */
function isPinch(event: Event): boolean {
    return 'touches' in event && (event as TouchEvent).touches.length > 1;
}

export interface AreaSize {
    readonly width: number;
    readonly height: number;
}

/** A rectangle made from one point of the map to another, and the map's size. */
export type AreaDrawn = (from: ScreenPointPort, to: ScreenPointPort, size: AreaSize) => void;

export class AreaGesture {
    readonly #drawn: AreaDrawn;
    #container: HTMLElement | null = null;
    /** Where the press began, while the button is down. */
    #from: ScreenPointPort | null = null;
    /** The pointer that pressed (its moves and its release count; another's do not). */
    #pointer: number | null = null;
    /** The first corner of a two-click rectangle. */
    #corner: ScreenPointPort | null = null;
    /** The dashed band of the rectangle under way, inside the map's element (the map's own drawing stays below it). */
    #band: HTMLElement | null = null;
    #drawing = true;

    constructor(drawn: AreaDrawn) {
        this.#drawn = drawn;
    }

    get drawing(): boolean {
        return this.#drawing;
    }

    /** Listens on the map's element (once; another element replaces it). */
    attach(container: HTMLElement): void {
        if (this.#container === container) {
            return;
        }
        this.detach();
        this.#container = container;
        container.addEventListener('pointerdown', this.#down, { capture: true });
        container.addEventListener('pointermove', this.#move, { capture: true });
        container.addEventListener('pointerup', this.#up, { capture: true });
        container.addEventListener('pointercancel', this.#cancel, { capture: true });
        // The map's own drag starts from these: held back while drawing (the pointer events above already started ours).
        container.addEventListener('mousedown', this.#hold, { capture: true });
        container.addEventListener('touchstart', this.#hold, { capture: true });
        this.#cursor();
    }

    detach(): void {
        const container = this.#container;
        if (container === null) {
            return;
        }
        container.removeEventListener('pointerdown', this.#down, { capture: true });
        container.removeEventListener('pointermove', this.#move, { capture: true });
        container.removeEventListener('pointerup', this.#up, { capture: true });
        container.removeEventListener('pointercancel', this.#cancel, { capture: true });
        container.removeEventListener('mousedown', this.#hold, { capture: true });
        container.removeEventListener('touchstart', this.#hold, { capture: true });
        container.style.removeProperty('cursor');
        this.#reset();
        this.#container = null;
    }

    /** Drawing (the gesture makes the rectangle) or moving the map (the map takes the pointer). */
    setDrawing(drawing: boolean): void {
        this.#drawing = drawing;
        this.#reset();
        this.#cursor();
    }

    /** No drag and no first corner any more: the band goes. */
    #reset(): void {
        this.#from = null;
        this.#pointer = null;
        this.#corner = null;
        this.#band?.remove();
        this.#band = null;
    }

    /** The band from `from` to `to` (a point's own 8 px square when they are one). */
    #show(from: ScreenPointPort, to: ScreenPointPort): void {
        const band = this.#band ?? this.#newBand();
        const style = band.style;
        style.setProperty('left', `${String(Math.min(from.x, to.x) - 4)}px`);
        style.setProperty('top', `${String(Math.min(from.y, to.y) - 4)}px`);
        style.setProperty('width', `${String(Math.abs(to.x - from.x) + 8)}px`);
        style.setProperty('height', `${String(Math.abs(to.y - from.y) + 8)}px`);
    }

    #newBand(): HTMLElement {
        const band = (this.#container?.ownerDocument ?? document).createElement('div');
        band.dataset['areaBand'] = '';
        for (const [name, value] of BAND_STYLE) {
            band.style.setProperty(name, value);
        }
        this.#container?.append(band);
        this.#band = band;
        return band;
    }

    #cursor(): void {
        this.#container?.style.setProperty('cursor', this.#drawing ? 'crosshair' : '');
    }

    #point(event: PointerEvent): ScreenPointPort {
        const rect = this.#container?.getBoundingClientRect() ?? NO_RECT;
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    /** The map's own drag is held back while drawing; two fingers are a pinch, which the map takes. */
    readonly #hold = (event: Event): void => {
        if (this.#drawing && !isPinch(event)) {
            event.stopPropagation();
        }
    };

    readonly #down = (event: PointerEvent): void => {
        if (!this.#drawing || event.button !== 0) {
            return;
        }
        if (!event.isPrimary) {
            this.#reset();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.#from = this.#point(event);
        this.#pointer = event.pointerId;
        this.#capture(event.pointerId);
    };

    /** Keeps the pointer's events on the map while the button is down (a pointer the browser no longer knows: none). */
    #capture(pointerId: number): void {
        try {
            this.#container?.setPointerCapture(pointerId);
        } catch {
            // The pointer is gone already: its up event will not come, and the next press starts again.
        }
    }

    readonly #move = (event: PointerEvent): void => {
        const from = this.#bandStart(event);
        if (from !== null) {
            this.#show(from, this.#point(event));
        }
    };

    /** Where the band starts as this pointer moves: the press (its own pointer only, held from the map), or the first click. */
    #bandStart(event: PointerEvent): ScreenPointPort | null {
        if (this.#from === null) {
            return this.#corner;
        }
        if (event.pointerId !== this.#pointer) {
            return null;
        }
        event.stopPropagation();
        return this.#from;
    }

    readonly #up = (event: PointerEvent): void => {
        const from = this.#from;
        if (from === null || event.pointerId !== this.#pointer) {
            return;
        }
        this.#from = null;
        event.stopPropagation();
        const to = this.#point(event);
        const clicked = Math.hypot(to.x - from.x, to.y - from.y) < CLICK_SLOP_PX;
        const drag = clicked ? this.#secondCorner(to) : { from, to };
        if (drag !== null) {
            this.#reset();
            this.#drawn(drag.from, drag.to, this.#size());
        }
    };

    readonly #cancel = (): void => {
        this.#from = null;
        if (this.#corner === null) {
            this.#reset();
        }
    };

    /** A click: the first corner waits for the second (its marker shows); the second makes the rectangle. */
    #secondCorner(point: ScreenPointPort): { readonly from: ScreenPointPort; readonly to: ScreenPointPort } | null {
        const first = this.#corner;
        if (first !== null) {
            return { from: first, to: point };
        }
        this.#corner = point;
        this.#show(point, point);
        return null;
    }

    #size(): AreaSize {
        return { width: this.#container?.clientWidth ?? 0, height: this.#container?.clientHeight ?? 0 };
    }
}
