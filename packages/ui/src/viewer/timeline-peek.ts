/**
 * V13's peek (the owner, 2026-11-13: "the date picker for the year should open on mouse hover over the year in the
 * timeline", and the same day the same idea for a finger): the date menu of a year with several dates shown while a pointer
 * rests on that year, without selecting it (`hcm-dates-peek`).
 *
 * - A mouse or a pen hovering (the pointer's own type, not `(hover: hover) and (pointer: fine)`: a tablet or a touch laptop
 *   with a mouse reports a coarse primary pointer, and a finger never hovers) resting `HOVER_INTENT_MS` on such a year's
 *   point opens it; a sweep across the timeline opens nothing. Moving off the year closes it gently (`PEEK_LEAVE_MS`, so the
 *   mouse can reach the menu, `timeline-dock.ts`); a drag with the button held opens nothing.
 * - A finger scrubbing along the track (`timeline-scrub.ts`) and resting `DWELL_MS` on such a year opens it at once, with
 *   a haptic tick; moving on along the track closes it and the scrub goes on. The finger may slide onto a date and lift to
 *   pick it, or lift on the year: the year is then selected, which opens the menu as before (V13) for a tap.
 *
 * The menu then sits beside the year's point and clear of the card: above a lying timeline, beside a standing one.
 */
import type { DatesOpenDetail } from './timeline-dates.js';
import type { TimelineStop } from './timeline-model.js';
import { tick, type PeekPlace } from './timeline-scrub.js';

/** How long a mouse rests on a year before its dates show. */
export const HOVER_INTENT_MS = 300;
/** How long a finger rests on a year during a scrub before its dates show. */
export const DWELL_MS = 400;
/** How long a mouse peek stays after the mouse left the year and the menu (the way from one to the other). */
export const PEEK_LEAVE_MS = 300;
/** `hcm-dates-peek`: the dates to show without selecting their year, or none (`dates` null, after a delay when `gently`). */
export interface DatesPeekDetail {
    readonly dates: DatesOpenDetail | null;
    readonly gently: boolean;
}

export function datesPeekEvent(detail: DatesPeekDetail): CustomEvent<DatesPeekDetail> {
    return new CustomEvent('hcm-dates-peek', { bubbles: true, composed: true, detail });
}

type Box = DatesOpenDetail['anchor'];

/** The box the peek opens beside: the year's point along the track, the whole card across it (so it never covers the track). */
export function peekAnchor(mark: Box, card: Box, vertical: boolean): Box {
    return vertical
        ? { x: card.x, width: card.width, y: mark.y, height: mark.height }
        : { x: mark.x, width: mark.width, y: card.y, height: card.height };
}

/** What the peek reads of the timeline: its card, its orientation, its stops' points, and the root the menu is in. */
interface PeekCard extends Element {
    readonly orientation: 'horizontal' | 'vertical';
    readonly renderRoot: ParentNode;
}

/** The dates of `stop` (the `index`th) for a peek, beside its point and clear of the card; none for "today". */
export function peekDates(card: PeekCard, stop: TimelineStop, index: number): DatesOpenDetail | null {
    const mark = card.renderRoot.querySelectorAll('.stop')[index];
    if (stop === null || mark === undefined) {
        return null;
    }
    return { year: stop, anchor: peekAnchor(mark.getBoundingClientRect(), card.getBoundingClientRect(), card.orientation === 'vertical') };
}

/** Whether the finger is off the card across the track (towards the menu). */
function offCard(card: PeekCard, event: PointerEvent): boolean {
    const box = card.getBoundingClientRect();
    const [across, from, to] =
        card.orientation === 'vertical' ? [event.clientX, box.left, box.right] : [event.clientY, box.top, box.bottom];
    return across < from || across > to;
}

/** A scrubbing finger against the peek `shown`: over the menu it is the menu's, off the card across the track it holds the year. */
export function peekPlace(card: PeekCard, shown: boolean, event: PointerEvent, lifted: boolean): PeekPlace {
    if (!shown) {
        return 'none';
    }
    const menu = (card.getRootNode() as ParentNode).querySelector('hcm-date-menu');
    if (menu?.touchAt(event.clientX, event.clientY, lifted) === true) {
        return 'menu';
    }
    return offCard(card, event) ? 'beside' : 'track';
}

export type PeekPointer = 'mouse' | 'touch';

/** What the peek asks of the timeline. */
export interface PeekHost {
    /** The dates of stop `index`, anchored for the menu, or null for a year of one date or "today". */
    readonly datesAt: (index: number) => DatesOpenDetail | null;
    readonly send: (detail: DatesPeekDetail) => void;
}

/** The pointer's rest on a stop, timed: it shows the stop's dates after the intent delay and closes them when it moves on. */
export class DatesPeek {
    readonly #host: PeekHost;
    #timer: ReturnType<typeof setTimeout> | undefined;
    /** The stop the pointer rests on now. */
    #index: number | null = null;
    /** The stop whose dates show. */
    #shown: number | null = null;

    constructor(host: PeekHost) {
        this.#host = host;
    }

    /** Whether a peek is shown. */
    shown(): boolean {
        return this.#shown !== null;
    }

    /** The pointer is on stop `index` (each move: only a new stop counts). */
    rest(index: number, pointer: PeekPointer): void {
        if (index === this.#index) {
            return;
        }
        this.#index = index;
        this.#hide(pointer === 'mouse');
        if (this.#host.datesAt(index) === null) {
            return;
        }
        this.#timer = setTimeout(
            () => {
                this.#open(index, pointer);
            },
            pointer === 'touch' ? DWELL_MS : HOVER_INTENT_MS,
        );
    }

    /** The mouse left the track: its peek closes gently. */
    away(): void {
        this.#index = null;
        this.#hide(true);
    }

    /** A press began or ended: nothing waits any more; `close`: the peek shown closes now (else the press's end decides). */
    stop(close: boolean): void {
        this.#index = null;
        clearTimeout(this.#timer);
        if (close && this.#shown !== null) {
            this.#host.send({ dates: null, gently: false });
        }
        this.#shown = null;
    }

    #open(index: number, pointer: PeekPointer): void {
        const dates = this.#host.datesAt(index);
        if (dates === null) {
            return;
        }
        this.#shown = index;
        if (pointer === 'touch') {
            tick();
        }
        this.#host.send({ dates, gently: false });
    }

    /** Nothing waits; the peek shown closes (gently for a mouse). */
    #hide(gently: boolean): void {
        clearTimeout(this.#timer);
        if (this.#shown !== null) {
            this.#shown = null;
            this.#host.send({ dates: null, gently });
        }
    }
}
