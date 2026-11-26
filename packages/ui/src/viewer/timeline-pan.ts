/**
 * A mouse on a scrolling timeline (`density` `scroll`): the visitor drags the years along as a finger does (the owner,
 * 2026-11-14: with a mouse the years beyond the card could not be reached). A press that moves more than
 * `PAN_SLOP_PX` pans the scroller and never selects; one that does not is a click and selects the year under it. The
 * wheel scrolls a lying track along: a vertical wheel and a shift-wheel move it sideways. A pan let go while moving flings
 * on as a finger's does (the owner, 2026-11-14): the speed of the last `SAMPLE_MS` of moves carries the years on and decays
 * by `FRICTION_PER_MS` until it is under `STOP_PX_PER_MS`; a new press stops it, and reduced motion has none.
 */

/** The moves that set a fling's speed: those of the last this many ms before release. */
const SAMPLE_MS = 100;
/** The share of its speed a fling keeps per ms (about the browser's own touch fling). */
const FRICTION_PER_MS = 0.996;
/** The friction as a rate: the speed is `exp(-DECAY_PER_MS * ms)` of what it was. */
const DECAY_PER_MS = -Math.log(FRICTION_PER_MS);
/** A pointer that rested this long (ms) before release flings nothing: the visitor stopped it on purpose. */
const REST_MS = 250;
/** A fling slower than this (px per ms) stops. */
const STOP_PX_PER_MS = 0.02;

/** Px a mouse may move and still click a year; beyond it the press pans the track. */
const PAN_SLOP_PX = 4;

export interface PanHooks {
    readonly vertical: boolean;
    /** The press ended within the slop: a click at this pointer. */
    readonly onClick: (event: PointerEvent) => void;
    /** The press is over (`released`: lifted, not cancelled). */
    readonly onEnd: (released: boolean) => void;
    /** A fling started after release; the function stops it. */
    readonly onFling?: (stop: () => void) => void;
}

/** Time and frames, a fake in the tests. */
export interface Motion {
    readonly now: () => number;
    readonly frame: (callback: () => void) => number;
    readonly cancel: (handle: number) => void;
    readonly reduced: () => boolean;
}

const BROWSER_MOTION: Motion = {
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => {
        cancelAnimationFrame(handle);
    },
    reduced: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
};

interface Sample {
    readonly at: number;
    readonly along: number;
}

/**
 * The speed (px per ms, in pointer units) of the moves in the last `SAMPLE_MS` before the last one (or of the last two); 0 for fewer than two,
 * or when the pointer rested more than `REST_MS` before release `at`.
 */
export function releaseSpeed(samples: readonly Sample[], at: number): number {
    const last = samples.at(-1);
    if (last === undefined || at - last.at > REST_MS) {
        return 0;
    }
    // With no other move in the window (slow frames), the move before the last one still gives the speed.
    const inWindow = samples.find((sample) => sample !== last && last.at - sample.at <= SAMPLE_MS);
    return speedBetween(inWindow ?? samples.at(-2) ?? last, last);
}

function speedBetween(first: Sample, last: Sample): number {
    return last.at > first.at ? (last.along - first.along) / (last.at - first.at) : 0;
}

/** Flings `scroller` on at `speed` (px per ms of scroll), decaying until it stops; returns what stops it at once. */
export function fling(scroller: HTMLElement, speed: number, vertical: boolean, motion: Motion = BROWSER_MOTION): () => void {
    let velocity = speed;
    let last = motion.now();
    // Kept in fractions: a browser drops a scroll of under a pixel, and a slow fling's frames are each under one.
    let along = vertical ? scroller.scrollTop : scroller.scrollLeft;
    let handle = 0;
    const step = (): void => {
        const now = motion.now();
        const elapsed = now - last;
        last = now;
        // The distance the decaying speed covers over the frame (its integral): a late frame still moves its whole share.
        const kept = FRICTION_PER_MS ** elapsed;
        along += (velocity * (1 - kept)) / DECAY_PER_MS;
        velocity *= kept;
        if (vertical) {
            scroller.scrollTop = along;
        } else {
            scroller.scrollLeft = along;
        }
        if (Math.abs(velocity) < STOP_PX_PER_MS) {
            return;
        }
        handle = motion.frame(step);
    };
    if (!motion.reduced() && Math.abs(speed) >= STOP_PX_PER_MS) {
        handle = motion.frame(step);
    }
    return () => {
        motion.cancel(handle);
    };
}

/** Starts a pan on `scroller` from `down`; returns what stops it. */
export function startPan(scroller: HTMLElement, down: PointerEvent, hooks: PanHooks, motion: Motion = BROWSER_MOTION): () => void {
    const origin = { x: down.clientX, y: down.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    // The press is the first sample: a browser that coalesces a quick throw into one move still gives it a speed.
    const samples: Sample[] = [{ at: motion.now(), along: hooks.vertical ? down.clientY : down.clientX }];
    let panning = false;
    const move = (event: PointerEvent): void => {
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        samples.push({ at: motion.now(), along: hooks.vertical ? event.clientY : event.clientX });
        if (!panning && Math.hypot(dx, dy) <= PAN_SLOP_PX) {
            return;
        }
        panning = true;
        scroller.toggleAttribute('data-panning', true);
        if (hooks.vertical) {
            scroller.scrollTop = origin.top - dy;
        } else {
            scroller.scrollLeft = origin.left - dx;
        }
    };
    const up = (event: PointerEvent): void => {
        if (!panning) {
            hooks.onClick(event);
        }
        hooks.onEnd(true);
        if (panning) {
            const stop = fling(scroller, -releaseSpeed(samples, motion.now()), hooks.vertical, motion);
            hooks.onFling?.(stop);
        }
    };
    const cancel = (): void => {
        hooks.onEnd(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
        scroller.removeAttribute('data-panning');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
    };
}

/** A wheel over a lying scrolling track (`along`): its vertical turn (a plain or a shift-wheel) scrolls the track sideways. */
export function wheelAlong(event: WheelEvent, along: boolean): void {
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!along || event.deltaY === 0 || sideways || !(event.currentTarget instanceof HTMLElement)) {
        return;
    }
    event.preventDefault();
    event.currentTarget.scrollBy({ left: event.deltaY });
}

/** Px from a scroller's edge where a dragged thumb scrolls the years on. */
const EDGE_PX = 40;
/** Px per frame an edge scrolls with the pointer at the very edge; deeper past it, up to twice as fast. */
const EDGE_MAX_PX = 12;

/** How far (px per frame, negative towards the start) a pointer at `point` scrolls `scroller` from its edges. */
export function edgeSpeed(rect: DOMRect, point: { readonly clientX: number; readonly clientY: number }, vertical: boolean): number {
    const position = vertical ? point.clientY : point.clientX;
    const start = vertical ? rect.top : rect.left;
    const end = vertical ? rect.bottom : rect.right;
    const depth = (into: number): number => (EDGE_MAX_PX * Math.min(2 * EDGE_PX, Math.max(0, EDGE_PX - into))) / EDGE_PX;
    return depth(end - position) - depth(position - start);
}

/**
 * A dragged thumb near an edge of the scrolling card: the years scroll on each frame while it stays there, and `onScroll`
 * re-selects under the last pointer (the bar is never panned by the drag itself).
 */
export class EdgeScroll {
    readonly #scroller: HTMLElement;
    readonly #vertical: boolean;
    readonly #onScroll: (event: PointerEvent) => void;
    readonly #motion: Motion;
    #point: PointerEvent | null = null;
    #handle = 0;
    #running = false;

    constructor(scroller: HTMLElement, vertical: boolean, onScroll: (event: PointerEvent) => void, motion: Motion = BROWSER_MOTION) {
        this.#scroller = scroller;
        this.#vertical = vertical;
        this.#onScroll = onScroll;
        this.#motion = motion;
    }

    /** The pointer moved: scrolls on while it is within an edge. */
    update(event: PointerEvent): void {
        this.#point = event;
        if (!this.#running && this.#speed() !== 0) {
            this.#running = true;
            this.#handle = this.#motion.frame(this.#step);
        }
    }

    stop(): void {
        this.#running = false;
        this.#motion.cancel(this.#handle);
    }

    #speed(): number {
        return this.#point === null ? 0 : edgeSpeed(this.#scroller.getBoundingClientRect(), this.#point, this.#vertical);
    }

    readonly #step = (): void => {
        const speed = this.#speed();
        if (speed === 0 || this.#point === null) {
            this.#running = false;
            return;
        }
        // Standing, the years grow upwards: the top edge (start of the rect) scrolls towards the start too.
        this.#scroller.scrollBy(this.#vertical ? { top: speed } : { left: speed });
        this.#onScroll(this.#point);
        this.#handle = this.#motion.frame(this.#step);
    };
}
