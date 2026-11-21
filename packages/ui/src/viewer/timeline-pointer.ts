/**
 * The pointers on `<hcm-timeline>`'s track. A mouse on a scrolling track pans it (a click selects, `timeline-pan.ts`). A
 * mouse elsewhere or a pen: a press selects the stop under it and a drag goes on
 * selecting until release; hovering shows the year chip on a stop without its own label (`timeline-tip.ts`). A finger
 * scrubs along the track, each year it enters selected at once, the chip naming it (`timeline-scrub.ts`); on a scrolling
 * track a finger elsewhere than on the thumb may scroll the card, so it selects only as a tap, the chip shown while down.
 * Selections during a press are live (`select`, coalesced by the timeline to one event per frame); its end `settle`s them,
 * and only a press the visitor lifted (not a cancelled one) may open the date menu of a year with several dates (V13).
 * The thumb (the year pill) is never a pan (the owner, 2026-11-14, lesson in `docs/LESSONS.md`): pressed by any pointer it
 * moves along the years, the card scrolling on only while it is held at an edge (`EdgeScroll`); a mouse pan flings on after
 * release (`fling`) until it stops or a new press stops it.
 */
import { EdgeScroll, startPan } from './timeline-pan.js';
import { startScrub, type PeekPlace } from './timeline-scrub.js';

/** Px a finger may move on a scrolling track and still tap a year (beyond it the browser scrolls). */
const TAP_SLOP_PX = 8;

/** The share of the track (0..1) under a pointer; vertical tracks grow upwards, horizontal ones leftwards right to left. */
export function trackRatio(
    rect: DOMRect,
    point: { readonly clientX: number; readonly clientY: number },
    vertical: boolean,
    rtl = false,
): number {
    const across = rtl ? rect.right - point.clientX : point.clientX - rect.left;
    const ratio = vertical ? (rect.bottom - point.clientY) / rect.height : across / rect.width;
    return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

/** The press is on the thumb (the year pill) or a part of it. */
function onThumb(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.thumb') !== null;
}

/** What the pointers ask of the timeline. */
export interface TimelinePointerHost {
    readonly vertical: () => boolean;
    readonly rtl: () => boolean;
    /** The track scrolls in its card (`density` `scroll`). */
    readonly scrolls: () => boolean;
    /** The card's scroller, which a mouse drag pans on a scrolling track (`timeline-pan.ts`). */
    readonly scroller: () => HTMLElement | null;
    /** The number of stops. */
    readonly count: () => number;
    /** Selects a stop during a press (live: the timeline sends at most one event per frame). */
    readonly select: (index: number) => void;
    /**
     * The press is over: the last year selected is sent now, and announced if the press changed it; `released` when the
     * visitor lifted it (a tap, a click, the end of a drag or a scrub), not when it was cancelled or replaced.
     */
    readonly settle: (released: boolean) => void;
    readonly focus: () => void;
    readonly dragging: (dragging: boolean) => void;
    /** The chip under a finger at a stop, or none. */
    readonly touchTip: (index: number | null) => void;
    /** A mouse over a stop: the chip if that stop needs one. */
    readonly hint: (index: number) => void;
    readonly hideHint: () => void;
    /** A scrubbing finger against the peek of its year's dates (`timeline-peek.ts`). */
    readonly peek: (event: PointerEvent, lifted: boolean) => PeekPlace;
}

export class TimelinePointer {
    readonly #host: TimelinePointerHost;
    /** Removes the window listeners of the current press (none between presses). */
    #stop: () => void = () => undefined;
    /** Stops the fling of the last pan, if it still moves. */
    #fling: () => void = () => undefined;

    constructor(host: TimelinePointerHost) {
        this.#host = host;
    }

    /** A press on the track (the `pointerdown` listener). */
    readonly onDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
            return;
        }
        this.#fling();
        this.end();
        const track = event.currentTarget as HTMLElement;
        if (event.pointerType === 'touch') {
            this.#touch(track, event);
            return;
        }
        event.preventDefault();
        const scroller = this.#panning(event);
        if (scroller === null) {
            this.#drag(track, event);
        } else {
            this.#pan(track, scroller, event);
        }
    };

    /** The scroller a mouse press pans: on a scrolling track, off the thumb; none otherwise. */
    #panning(event: PointerEvent): HTMLElement | null {
        const pans = event.pointerType === 'mouse' && this.#host.scrolls() && !onThumb(event);
        return pans ? this.#host.scroller() : null;
    }

    /** A mouse on a scrolling track: a drag pans the years, a click without a drag selects the one under it. */
    #pan(track: HTMLElement, scroller: HTMLElement, down: PointerEvent): void {
        this.#stop = startPan(scroller, down, {
            vertical: this.#host.vertical(),
            onClick: (event) => {
                this.#host.select(this.#indexAt(track, event));
                this.#host.focus();
            },
            onEnd: (released) => {
                this.end(released);
            },
            onFling: (stop) => {
                this.#fling = stop;
            },
        });
    }

    /** On a scrolling track, a held thumb near an edge scrolls the years on and re-selects under it; none otherwise. */
    #edges(track: HTMLElement): EdgeScroll | null {
        const scroller = this.#host.scrolls() ? this.#host.scroller() : null;
        return scroller === null
            ? null
            : new EdgeScroll(scroller, this.#host.vertical(), (event) => {
                  this.#host.select(this.#indexAt(track, event));
              });
    }

    /** A finger: a tap on a scrolling track elsewhere than on the thumb (the card may scroll), else a scrub. */
    #touch(track: HTMLElement, event: PointerEvent): void {
        if (this.#host.scrolls() && !onThumb(event)) {
            this.#tapLater(track, event);
            return;
        }
        event.preventDefault();
        this.#scrub(track, event);
    }

    /** A mouse or a pen over the track: the chip of the stop under it, when needed. */
    readonly onHover = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
            this.#host.hint(this.#indexAt(event.currentTarget as HTMLElement, event));
        }
    };

    readonly onLeave = (): void => {
        this.#host.hideHint();
    };

    /** Ends the current press, if any: what it selected is settled (`released`: the visitor lifted it). */
    end(released = false): void {
        this.#host.dragging(false);
        this.#host.touchTip(null);
        this.#stop();
        this.#stop = () => undefined;
        this.#host.settle(released);
    }

    /** A finger along the track: the chip names the year under it, lifting selects it. */
    #scrub(track: HTMLElement, down: PointerEvent): void {
        const edges = this.#edges(track);
        const stop = startScrub(down, {
            vertical: this.#host.vertical(),
            indexAt: (event) => {
                edges?.update(event);
                return this.#indexAt(track, event);
            },
            onIndex: (index) => {
                this.#host.touchTip(index);
            },
            onSelect: (index) => {
                this.#host.select(index);
            },
            peek: (event, lifted) => this.#host.peek(event, lifted),
            onEnd: (released) => {
                edges?.stop();
                this.#stop = () => undefined;
                this.end(released);
                this.#host.focus();
            },
        });
        this.#stop = () => {
            edges?.stop();
            stop();
        };
    }

    /** A finger lifted within `TAP_SLOP_PX` of where it went down selects there; a scroll (the browser's cancel) does not. */
    #tapLater(track: HTMLElement, down: PointerEvent): void {
        this.#host.touchTip(this.#indexAt(track, down));
        const up = (event: PointerEvent): void => {
            const tap = Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) <= TAP_SLOP_PX;
            if (tap) {
                this.#host.select(this.#indexAt(track, event));
            }
            this.end(tap);
            if (tap) {
                this.#host.focus();
            }
        };
        const cancel = (): void => {
            this.end();
        };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        this.#stop = () => {
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }

    /** A mouse or a pen: selects under it from the press until release. */
    #drag(track: HTMLElement, event: PointerEvent): void {
        const edges = this.#edges(track);
        const move = (moveEvent: PointerEvent): void => {
            edges?.update(moveEvent);
            this.#host.select(this.#indexAt(track, moveEvent));
        };
        const up = (): void => {
            this.end(true);
        };
        const cancel = (): void => {
            this.end();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        this.#stop = () => {
            edges?.stop();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
        this.#host.dragging(true);
        this.#host.select(this.#indexAt(track, event));
        this.#host.focus();
    }

    /** The stop under a pointer on the track. */
    #indexAt(track: HTMLElement, event: PointerEvent): number {
        const ratio = trackRatio(track.getBoundingClientRect(), event, this.#host.vertical(), this.#host.rtl());
        return Math.round(ratio * (this.#host.count() - 1));
    }
}
