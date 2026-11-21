/**
 * A finger on the timeline (the owner, 2026-11-13): dragged along the track it scrubs through the years, each year it
 * enters selected at once (its layer to the front), the chip naming it clear of the finger (`timeline-tip.ts`); lifting
 * ends the drag; a tap selects the year under it. Locked to the track's axis like the opacity slider (`touchIntent`,
 * DECISIONS §178b): a finger that first moves across the track, more than `TOUCH_SLOP_PX`, is a swipe, not a scrub, and
 * selects nothing (nothing is selected before the finger has moved along the track or lifted). Each new year under the
 * finger gives a light tick (`navigator.vibrate`) where the device has one and the visitor did not ask for reduced motion.
 * While the dates of the year under the finger show (V13's peek, `timeline-peek.ts`), the finger off the track holds the
 * year (`beside`) and over the menu slides along its dates (`menu`); lifted there, the date under it is picked, not the year.
 */
import { touchIntent } from '../components/slider.js';

/** How long the tick of a new year lasts, in ms. */
const TICK_MS = 8;

export interface ScrubHooks {
    /** The track runs up and down (a phone held upright). */
    readonly vertical: boolean;
    /** The stop under a pointer event. */
    readonly indexAt: (event: PointerEvent) => number;
    /** The stop under the finger changed (also once at the press): the chip follows it. */
    readonly onIndex: (index: number) => void;
    /** The year under a finger moving along the track, or under one lifted where it went down (a tap). */
    readonly onSelect: (index: number) => void;
    /** The finger is up (`released`), or the press was cancelled (the browser took it). */
    readonly onEnd: (released: boolean) => void;
    /** Where the finger is against a peek of the year's dates (`lifted`: it is up, the menu picks the date under it). */
    readonly peek?: (event: PointerEvent, lifted: boolean) => PeekPlace;
}

/** A finger against the peek: none shown, on the track, off the track (the year held), over the menu. */
export type PeekPlace = 'none' | 'track' | 'beside' | 'menu';

/** A light tick where the device vibrates and motion is welcome. */
export function tick(win: Window = window): void {
    if (typeof win.navigator.vibrate === 'function' && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        win.navigator.vibrate(TICK_MS);
    }
}

/** A pointer's place in the track's axes: along it, then across it. */
type Axes = (event: PointerEvent) => { readonly x: number; readonly y: number };

const LYING: Axes = (event) => ({ x: event.clientX, y: event.clientY });
const STANDING: Axes = (event) => ({ x: event.clientY, y: event.clientX });

type Intent = 'wait' | 'drag' | 'scroll';

/** Where the finger is against a peek of its year's dates; `none` without the hook. */
function placeOf(hooks: ScrubHooks, event: PointerEvent, lifted: boolean): PeekPlace {
    return hooks.peek === undefined ? 'none' : hooks.peek(event, lifted);
}

/**
 * The finger's intent after a move. A finger that rested until the dates showed (`place` not `none`) is scrubbing: moving
 * across then is towards the menu, not a scroll.
 */
function nextIntent(intent: Intent, place: PeekPlace, start: { readonly x: number; readonly y: number }, along: typeof start): Intent {
    if (intent !== 'wait') {
        return intent;
    }
    return place === 'none' ? touchIntent(start, along.x, along.y) : 'drag';
}

type PointerHandlers = Readonly<Record<'pointermove' | 'pointerup' | 'pointercancel', (event: PointerEvent) => void>>;

/** Listens on `win` to the events of pointer `id` only; returns what stops it. */
function listenTo(win: Window, id: number, handlers: PointerHandlers): () => void {
    const listen = (event: Event): void => {
        const pointer = event as PointerEvent;
        if (pointer.pointerId === id) {
            handlers[event.type as keyof PointerHandlers](pointer);
        }
    };
    for (const type of Object.keys(handlers)) {
        win.addEventListener(type, listen);
    }
    return () => {
        for (const type of Object.keys(handlers)) {
            win.removeEventListener(type, listen);
        }
    };
}

/** Starts a scrub at `down`; returns what removes its listeners (called at the end too). */
export function startScrub(down: PointerEvent, hooks: ScrubHooks, win: Window = window): () => void {
    const axes = hooks.vertical ? STANDING : LYING;
    const start = axes(down);
    let intent: Intent = 'wait';
    let index = hooks.indexAt(down);
    hooks.onIndex(index);
    /** A new stop under the finger: a tick, and the chip follows it. */
    const enter = (next: number): void => {
        if (next !== index) {
            index = next;
            tick(win);
            hooks.onIndex(index);
        }
    };
    /** The finger moved: a swipe across ends the press; along the track the chip follows and the year is selected. */
    const step = (event: PointerEvent): void => {
        const place = placeOf(hooks, event, false);
        if (place === 'beside' || place === 'menu') {
            return;
        }
        intent = nextIntent(intent, place, start, axes(event));
        if (intent === 'scroll') {
            finish(false);
            return;
        }
        enter(hooks.indexAt(event));
        if (intent === 'drag') {
            hooks.onSelect(index);
        }
    };
    /** Lifted over the peek's menu the date under it was picked; elsewhere the year under the finger is selected. */
    const lift = (event: PointerEvent): void => {
        const picked = placeOf(hooks, event, true) === 'menu';
        if (!picked) {
            hooks.onSelect(index);
        }
        finish(!picked);
    };
    const stop = listenTo(win, down.pointerId, {
        pointermove: step,
        pointerup: lift,
        pointercancel: () => {
            finish(false);
        },
    });
    function finish(released: boolean): void {
        stop();
        hooks.onEnd(released);
    }
    return stop;
}
