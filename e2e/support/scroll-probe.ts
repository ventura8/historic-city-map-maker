import { deepElements, flatContains, isDrawn, selectorOf, visibleBoxOf } from './dom-walk.js';
import { modalSurfaces } from './layout-probe.js';

/**
 * The in-page half of the state checker's scroll sweep (e2e/support/scroll-sweep.ts, lesson 84 of docs/LESSONS.md): a
 * state's checks measure what is scrolled into view, so a fault below the fold waited for a layout change to be seen.
 * These helpers find what a visitor scrolls (the page, and every box whose content is taller than it and that scrolls
 * vertically; inside the open modal surface only, the rest being inert), list the positions that show its whole content
 * a window at a time, scroll there and back. Every function here is a `function` declaration sent to the page by
 * `libraryScript` (e2e/support/page-script.ts) with the helpers of `DOM_WALK` and `LAYOUT_PROBE`; the unit tests call
 * them on synthetic DOM (e2e/test/scroll-probe.test.ts). Sideways scrolling is a violation of its own (`sideways-scroll`),
 * never swept.
 */

/** What scrolls, as the sweep visits it: its place in the page's registry, a readable name and the positions to visit. */
export interface ScrollerInfo {
    readonly index: number;
    readonly name: string;
    /** `scrollTop` values that show the rest of its content (the current one left out). */
    readonly positions: readonly number[];
}

/** The page's registry of scrollers: the elements `scrollers` found, in order, and where each was. */
interface ScrollRegistry {
    readonly elements: Element[];
    readonly tops: number[];
}

/**
 * The positions that show a scroller's whole content a window at a time: each step three quarters of its height (an
 * element cut at one position's edge is whole at the next), from the top to the end, without the one it is at now; at
 * most 24 (a list far longer than its window is still covered from its top and at its end).
 */
export function sweepPositions(current: number, height: number, max: number): number[] {
    // In the page only function declarations exist (e2e/support/page-script.ts): the limit lives here.
    const limit = 24;
    const step = Math.max(1, Math.floor(height * 0.75));
    const positions: number[] = [];
    for (let top = 0; top < max && positions.length < limit - 1; top += step) {
        positions.push(top);
    }
    positions.push(max);
    return positions.filter((top, index) => Math.abs(top - current) > 1 && positions.indexOf(top) === index);
}

/** Whether the element scrolls vertically: its overflow scrolls there and its content is taller than its box. */
export function scrollsDown(element: Element): boolean {
    const overflow = getComputedStyle(element).overflowY;
    return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1;
}

/**
 * Everything a visitor scrolls vertically on the page as it is now: the page itself (its scrolling element), then every
 * drawn box in document order whose content is taller than it, except a form control's own text (a text area) and,
 * while a modal surface is open, anything outside it. They are kept in the page's registry with their positions.
 */
export function scrollers(): ScrollerInfo[] {
    const modals = modalSurfaces();
    const page = document.scrollingElement;
    const candidates = [
        ...(page !== null && page.scrollHeight > innerHeight + 1 && modals.length === 0 ? [page] : []),
        ...deepElements().filter(
            (element) =>
                element !== page &&
                element !== document.body &&
                !element.matches('textarea, select, input') &&
                isDrawn(element) &&
                scrollsDown(element) &&
                (modals.length === 0 || modals.some((modal) => flatContains(modal, element))),
        ),
    ];
    const registry: ScrollRegistry = { elements: candidates, tops: candidates.map((element) => element.scrollTop) };
    (window as unknown as { hcmScrollers?: ScrollRegistry }).hcmScrollers = registry;
    return candidates.map((element, index) => ({
        index,
        name: element === page ? 'the page' : selectorOf(element),
        positions: sweepPositions(element.scrollTop, element === page ? innerHeight : element.clientHeight, scrollMax(element)),
    }));
}

/** How far the element scrolls down (the page: by its window). */
export function scrollMax(element: Element): number {
    const height = element === document.scrollingElement ? innerHeight : element.clientHeight;
    return Math.max(0, element.scrollHeight - height);
}

/** The registered scroller `index`, or null (none registered, or it left the page). */
export function registeredScroller(index: number): Element | null {
    const element = (window as unknown as { hcmScrollers?: ScrollRegistry }).hcmScrollers?.elements[index];
    return element?.isConnected === true ? element : null;
}

/**
 * Brings the registered scroller `index` into view (its ancestors scroll as little as they must) and scrolls it to
 * `top` at once; answers where it is now (null: it is gone).
 */
export function scrollToPosition([index, top]: readonly [number, number]): number | null {
    const element = registeredScroller(index);
    if (element === null) {
        return null;
    }
    if (element !== document.scrollingElement && visibleBoxOf(element) === null) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    element.scrollTo({ top, behavior: 'instant' });
    return element.scrollTop;
}

/** Scrolls every registered scroller back where `scrollers` found it (innermost first, so outer positions win). */
export function restoreScrollers(): number {
    const registry = (window as unknown as { hcmScrollers?: ScrollRegistry }).hcmScrollers;
    if (registry === undefined) {
        return 0;
    }
    const restored = registry.elements
        .map((element, index) => ({ element, top: registry.tops[index] ?? 0 }))
        .filter(({ element }) => element.isConnected)
        .reverse();
    for (const { element, top } of restored) {
        element.scrollTo({ top, behavior: 'instant' });
    }
    return restored.length;
}

/** Every helper of this module, for `libraryScript`. */
export const SCROLL_PROBE = [
    sweepPositions,
    scrollsDown,
    scrollers,
    scrollMax,
    registeredScroller,
    scrollToPosition,
    restoreScrollers,
] as const;
