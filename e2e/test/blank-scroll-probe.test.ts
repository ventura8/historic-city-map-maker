import { page } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
    BLANK_TOLERANCE_PX,
    blankScrollViolations,
    drawsContent,
    lowestContent,
    measureBlankScroll,
    movesWithViewport,
    pageBackground,
    type BlankScrollMeasure,
} from '../support/blank-scroll-probe.js';
import { at, clearStage, h, host, stage } from './fixtures.js';

/** e2e/support/blank-scroll-probe.ts: the `no-blank-scroll` checker's probe and rule, on synthetic pages. */

beforeAll(async () => {
    await page.viewport(800, 600);
});

afterEach(() => {
    clearStage();
    for (const element of [document.documentElement, document.body]) {
        element.style.removeProperty('overflow');
        element.style.removeProperty('overscroll-behavior');
        element.style.removeProperty('background');
    }
    document.documentElement.scrollTop = 0;
});

/** A measure of a page that is fine as a document, with `changes`. */
function measure(changes: Partial<BlankScrollMeasure> = {}): BlankScrollMeasure {
    return { shell: false, overscroll: 'auto', scrollHeight: 600, viewportHeight: 600, moved: 0, blank: 0, last: null, ...changes };
}

/** An app shell's root: overflow hidden, no overscroll. */
function makeShell(): void {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
}

describe('blankScrollViolations', () => {
    test('happyPath_aShellAsTallAsTheWindowAndADocumentEndingAtItsLastElement', () => {
        expect(blankScrollViolations(measure({ shell: true, overscroll: 'none', scrollHeight: 601 }))).toEqual([]);
        expect(blankScrollViolations(measure({ scrollHeight: 2000, moved: 1400, blank: BLANK_TOLERANCE_PX + 0.4 }))).toEqual([]);
        // A document shorter than its window has nothing to scroll into, whatever lies under its content.
        expect(blankScrollViolations(measure({ blank: 300 }))).toEqual([]);
    });

    test('badPath_aShellThatScrollsMovesOrOverscrolls', () => {
        const last = { name: 'Map', selector: 'hcm-map-viewer', box: { x: 0, y: 0, width: 800, height: 600 } };
        const found = blankScrollViolations(measure({ shell: true, scrollHeight: 700, moved: 100, last }));
        expect(found.map((violation) => violation.message)).toEqual([
            "the app shell's page is 700 px tall in a 600 px window",
            'scrolling the window moves the app shell 100 px',
            "the app shell's root overscrolls (overscroll-behavior-y: auto, not none)",
        ]);
        expect(found.every((violation) => violation.check === 'no-blank-scroll' && violation.elements[0] === last)).toBe(true);
    });

    test('badPath_aDocumentWithATrailingBlankArea', () => {
        const found = blankScrollViolations(measure({ scrollHeight: 2000, moved: 1400, blank: 240.4 }));
        expect(found).toEqual([
            { check: 'no-blank-scroll', message: 'the page scrolls 240 px of blank space past its last content', elements: [] },
        ]);
    });
});

describe('drawsContent', () => {
    test('happyPath_textPicturesControlsBackgroundsAndBorders', () => {
        const text = h('p', {}, 'Words');
        const control = h('button', {});
        const coloured = h('div', { style: 'background: rgb(10, 20, 30);' });
        const bordered = h('div', { style: 'border-top: 1px solid black;' });
        const pictured = h('div', { style: 'background-image: linear-gradient(red, blue);' });
        stage(text, control, coloured, bordered, pictured);
        for (const element of [text, control, coloured, bordered, pictured]) {
            expect(drawsContent(element, 'rgb(255, 255, 255)')).toBe(true);
        }
    });

    test('badPath_anEmptyBoxOrOneInThePagesOwnColourDrawsNothing', () => {
        const empty = h('div', { style: 'height: 400px;' }, '   ');
        const same = h('div', { style: 'background: rgb(255, 255, 255); border-bottom: 2px none black;' });
        const clearBorder = h('div', { style: 'border-bottom: 2px solid transparent;' });
        stage(empty, same, clearBorder);
        for (const element of [empty, same, clearBorder]) {
            expect(drawsContent(element, 'rgb(255, 255, 255)')).toBe(false);
        }
    });
});

describe('movesWithViewport and pageBackground', () => {
    test('happyPath_fixedStickyAndTheirContentStayPut', () => {
        const inFixed = h('span', {}, 'bar');
        const sticky = h('div', { style: 'position: sticky; top: 0;' }, 'head');
        stage(h('div', { style: 'position: fixed; bottom: 0;' }, inFixed), sticky);
        expect(movesWithViewport(inFixed)).toBe(true);
        expect(movesWithViewport(sticky)).toBe(true);
    });

    test('badPath_contentInTheFlowScrollsWithThePage', () => {
        const flowing = h('p', {}, 'text');
        stage(flowing);
        expect(movesWithViewport(flowing)).toBe(false);
    });

    test('happyPath_theBodysBackgroundOrElseTheRoots', () => {
        document.documentElement.style.background = 'rgb(1, 2, 3)';
        expect(pageBackground()).toBe('rgb(1, 2, 3)');
        document.body.style.background = 'rgb(4, 5, 6)';
        expect(pageBackground()).toBe('rgb(4, 5, 6)');
    });
});

describe('lowestContent', () => {
    test('happyPath_theLowestVisibleContentThroughShadowRoots', () => {
        const deep = h('p', { style: at(0, 400, 100, 30) }, 'deep');
        stage(h('p', { style: at(0, 100, 100, 20) }, 'high'), host('x-low', {}, [deep]));
        expect(lowestContent()?.element).toBe(deep);
        expect(lowestContent()?.box.y).toBe(400);
    });

    test('badPath_fixedBarsHiddenTextAndEmptyPagesAreNotContent', () => {
        expect(lowestContent()).toBeNull();
        const shown = h('p', { style: at(0, 100, 100, 20) }, 'shown');
        const hidden = h('p', { style: `${at(0, 500, 100, 20)} visibility: hidden;` }, 'hidden');
        const readerOnly = h('p', { style: `${at(0, 550, 1, 1)} overflow: hidden; clip-path: inset(50%);` }, 'reader');
        stage(shown, hidden, readerOnly, h('nav', { style: 'position: fixed; bottom: 0; height: 40px;' }, 'bar'));
        expect(lowestContent()?.element).toBe(shown);
    });
});

describe('measureBlankScroll', () => {
    test('happyPath_aDocumentEndsAtItsLastElement', () => {
        stage(h('p', { style: at(0, 1480, 200, 40) }, 'The end'));
        document.documentElement.scrollTop = 200;
        const measured = measureBlankScroll();
        expect(measured.shell).toBe(false);
        expect(measured.scrollHeight).toBeGreaterThan(600);
        expect(measured.blank).toBeLessThanOrEqual(BLANK_TOLERANCE_PX);
        expect(measured.last?.name).toBe('The end');
        expect(blankScrollViolations(measured)).toEqual([]);
        // The window is put back where it was.
        expect(document.documentElement.scrollTop).toBe(200);
    });

    test('badPath_aFixturePageWithATrailingBlankAreaFails', () => {
        stage(h('p', { style: at(0, 900, 200, 40) }, 'The end'), h('div', { style: at(0, 940, 10, 500) }));
        const found = blankScrollViolations(measureBlankScroll());
        expect(found).toHaveLength(1);
        expect(found[0]?.message).toMatch(/^the page scrolls 50\d px of blank space past its last content$/);
        expect(found[0]?.elements[0]?.name).toBe('The end');
    });

    test('happyPath_aShellAsTallAsTheWindow', () => {
        makeShell();
        stage(h('p', { style: at(0, 500, 200, 40) }, 'Inside'));
        const measured = measureBlankScroll();
        expect(measured).toMatchObject({ shell: true, overscroll: 'none', moved: 0, viewportHeight: 600 });
        expect(blankScrollViolations(measured)).toEqual([]);
    });

    test('badPath_aShellTallerThanTheWindowMovesWhenTheWindowScrolls', () => {
        makeShell();
        document.documentElement.style.overscrollBehavior = 'contain';
        stage(h('p', { style: at(0, 700, 200, 40) }, 'Below'));
        const messages = blankScrollViolations(measureBlankScroll()).map((violation) => violation.message);
        expect(messages).toHaveLength(3);
        expect(messages[1]).toMatch(/^scrolling the window moves the app shell \d+ px$/);
        expect(messages[2]).toBe("the app shell's root overscrolls (overscroll-behavior-y: contain, not none)");
        expect(document.documentElement.scrollTop).toBe(0);
    });

    test('badPath_anEmptyPageHasNoLastContent', () => {
        document.body.style.overflow = 'clip';
        const measured = measureBlankScroll();
        expect(measured.shell).toBe(true);
        expect(measured.last).toBeNull();
        expect(measured.blank).toBe(600);
    });
});
