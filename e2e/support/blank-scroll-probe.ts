import { accessibleName, deepElements, flatChain, isDrawn, isScreenReaderOnly, selectorOf, visibleBoxOf, type Rect } from './dom-walk.js';
import type { ElementRef, Violation } from './violations.js';

/**
 * The tour's `no-blank-scroll` checker (docs/TESTING.md → *The tour's checkers*; the owner's request for beta.1: "make sure
 * you can never scroll down past our app's limit, into blank space, in none of our screens"). Two kinds of page:
 *
 * - an **app shell** (the viewer, the admin's frame, the start page's app): the root hides its overflow, the shell is as
 *   tall as the window and only its inner panes scroll; the page itself never scrolls (its scroll height is the window's,
 *   scrolling the window to its end leaves the shell where it was) and never rubber-bands past its edge
 *   (`overscroll-behavior-y: none` on the root, iOS's and Android's overscroll and pull to refresh);
 * - a **document** (the landing page, the legal pages, 404 and the start-up page, the admin's sign-in panels): the page
 *   scrolls, and it ends at its last element: scrolled to its end, the lowest visible content (a text, a picture, a
 *   control, a box with its own background or border) reaches the window's bottom within `BLANK_TOLERANCE_PX`.
 *
 * The in-page half (`measureBlankScroll`, a `function` declaration sent with the helpers of `DOM_WALK`) scrolls the
 * window to its end, measures, and scrolls it back; the pure rule (`blankScrollViolations`) judges the measure. The unit
 * tests run both on synthetic pages (e2e/test/blank-scroll-probe.test.ts).
 */

/** What the probe measured on the page. */
export interface BlankScrollMeasure {
    /** The root (`html` or `body`) hides its block overflow: the page is an app shell. */
    readonly shell: boolean;
    /** The root's `overscroll-behavior-y`. */
    readonly overscroll: string;
    readonly scrollHeight: number;
    readonly viewportHeight: number;
    /** How far the window moved when it was scrolled to its end. */
    readonly moved: number;
    /** At the end, the window's bottom minus the lowest visible content's bottom (the blank under the content). */
    readonly blank: number;
    /** The lowest visible content at the end (null: nothing drawn). */
    readonly last: ElementRef | null;
}

/** Blank space a document may keep under its last element at the end of its scroll (a margin, not an empty area). */
export const BLANK_TOLERANCE_PX = 16;

/** Whether the element draws something of its own: text, a replaced element or a control, a background or a border. */
export function drawsContent(element: Element, pageBackground: string): boolean {
    if (element.matches('img, svg, canvas, video, picture, iframe, input, button, select, textarea, hr, progress, meter')) {
        return true;
    }
    if (Array.from(element.childNodes).some((node) => node instanceof Text && node.data.trim() !== '')) {
        return true;
    }
    const style = getComputedStyle(element);
    const transparent = 'rgba(0, 0, 0, 0)';
    const background = style.backgroundColor !== transparent && style.backgroundColor !== pageBackground;
    // A box with a visible border on any side is a drawn box down to its bottom edge (a footer's rule above its links).
    const border = ['top', 'right', 'bottom', 'left'].some(
        (side) =>
            parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
            style.getPropertyValue(`border-${side}-style`) !== 'none' &&
            style.getPropertyValue(`border-${side}-color`) !== transparent,
    );
    return background || border || style.backgroundImage !== 'none';
}

/** Whether the element stays put while the page scrolls (it or an ancestor is fixed or sticky, or in the top layer). */
export function movesWithViewport(element: Element): boolean {
    return flatChain(element).some((node) => {
        const position = getComputedStyle(node).position;
        return position === 'fixed' || position === 'sticky' || node.matches(':modal, :popover-open');
    });
}

/** The page's own background colour: the body's, or the root's when the body has none. */
export function pageBackground(): string {
    const body = getComputedStyle(document.body).backgroundColor;
    return body === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : body;
}

/** The lowest visible content of the page as it is scrolled now, and its visible box (null: nothing drawn). */
export function lowestContent(): { readonly element: Element; readonly box: Rect } | null {
    const background = pageBackground();
    let lowest: { element: Element; box: Rect } | null = null;
    for (const element of deepElements()) {
        if (element === document.documentElement || element === document.body || !isDrawn(element)) {
            continue;
        }
        if (movesWithViewport(element) || isScreenReaderOnly(element) || !drawsContent(element, background)) {
            continue;
        }
        const box = visibleBoxOf(element);
        if (box !== null && (lowest === null || box.y + box.height > lowest.box.y + lowest.box.height)) {
            lowest = { element, box };
        }
    }
    return lowest;
}

/**
 * Runs in the page: scrolls the window to its end, measures what `BlankScrollMeasure` says, and scrolls it back where
 * it was.
 */
export function measureBlankScroll(): BlankScrollMeasure {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const hides = (overflow: string): boolean => overflow === 'hidden' || overflow === 'clip';
    const page = document.scrollingElement ?? document.documentElement;
    const start = scrollY;
    scrollTo({ top: page.scrollHeight, behavior: 'instant' });
    const moved = scrollY - start;
    const lowest = lowestContent();
    const bottom = lowest === null ? 0 : lowest.box.y + lowest.box.height;
    const last = lowest === null ? null : { name: accessibleName(lowest.element), selector: selectorOf(lowest.element), box: lowest.box };
    scrollTo({ top: start, behavior: 'instant' });
    return {
        shell: hides(root.overflowY) || hides(body.overflowY),
        overscroll: root.overscrollBehaviorY,
        scrollHeight: page.scrollHeight,
        viewportHeight: innerHeight,
        moved,
        blank: Math.max(0, innerHeight - bottom),
        last,
    };
}

/** Every in-page helper of the checker, for `libraryScript` (with `DOM_WALK`). */
export const BLANK_SCROLL_PROBE = [drawsContent, movesWithViewport, pageBackground, lowestContent, measureBlankScroll] as const;

/** The `no-blank-scroll` violations of a measure (see the module's comment). */
export function blankScrollViolations(measure: BlankScrollMeasure): Violation[] {
    const elements = measure.last === null ? [] : [measure.last];
    const round = (value: number): string => String(Math.round(value));
    const found: string[] = [];
    if (measure.shell && measure.scrollHeight > measure.viewportHeight + 1) {
        found.push(`the app shell's page is ${round(measure.scrollHeight)} px tall in a ${round(measure.viewportHeight)} px window`);
    }
    if (measure.shell && measure.moved > 1) {
        found.push(`scrolling the window moves the app shell ${round(measure.moved)} px`);
    }
    if (measure.shell && measure.overscroll !== 'none') {
        found.push(`the app shell's root overscrolls (overscroll-behavior-y: ${measure.overscroll}, not none)`);
    }
    if (!measure.shell && measure.scrollHeight > measure.viewportHeight + 1 && Math.round(measure.blank) > BLANK_TOLERANCE_PX) {
        found.push(`the page scrolls ${round(measure.blank)} px of blank space past its last content`);
    }
    return found.map((message) => ({ check: 'no-blank-scroll', message, elements }));
}
