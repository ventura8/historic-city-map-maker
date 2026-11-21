import { page } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
    registeredScroller,
    restoreScrollers,
    scrollers,
    scrollMax,
    scrollsDown,
    scrollToPosition,
    sweepPositions,
} from '../support/scroll-probe.js';
import { at, clearStage, h, host, stage } from './fixtures.js';

/** e2e/support/scroll-probe.ts: what the state checker's scroll sweep finds and how it scrolls, on synthetic DOM. */

beforeAll(async () => {
    await page.viewport(800, 600);
});

afterEach(() => {
    clearStage();
    delete (window as unknown as { hcmScrollers?: unknown }).hcmScrollers;
    document.documentElement.scrollTop = 0;
});

/** The element `found` (a test's own fixture, so its absence is a broken test). */
function present<T>(found: T | null | undefined): T {
    if (found === null || found === undefined) {
        throw new Error('the fixture is not on the page');
    }
    return found;
}

/** A box `height` px tall whose content is `content` px tall, scrolling as `overflow` says. */
function pane(height: number, content: number, overflow = 'auto', name = 'pane'): HTMLElement {
    return h(
        'div',
        { class: name, style: at(0, 0, 300, height, `overflow-y: ${overflow};`) },
        h('div', { style: `height: ${String(content)}px;` }),
    );
}

describe('sweepPositions', () => {
    test('happyPath_threeQuartersOfTheWindowAtATimeFromTheTopToTheEnd', () => {
        expect(sweepPositions(0, 400, 1000)).toEqual([300, 600, 900, 1000]);
        expect(sweepPositions(600, 400, 1000)).toEqual([0, 300, 900, 1000]);
    });

    test('badPath_theEndOnceAndAtMostTwentyFourPositions', () => {
        expect(sweepPositions(0, 400, 300)).toEqual([300]);
        expect(sweepPositions(300, 400, 300)).toEqual([0]);
        const long = sweepPositions(0, 100, 10_000);
        expect(long).toHaveLength(23);
        expect(long.slice(0, 2)).toEqual([75, 150]);
        expect(long.at(-1)).toBe(10_000);
        expect(sweepPositions(0, 0, 10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
});

describe('scrollers', () => {
    test('happyPath_everyBoxTallerInsideThanItsHeightThatScrolls', () => {
        stage(
            pane(200, 900, 'auto', 'list'),
            pane(200, 900, 'hidden', 'cut'),
            pane(200, 100, 'auto', 'short'),
            h('textarea', { style: at(400, 0, 100, 40) }, 'a\n'.repeat(40)),
        );

        const found = scrollers();

        expect(found.map((scroller) => scroller.name)).toEqual(['div.list']);
        expect(found[0]?.positions).toEqual([150, 300, 450, 600, 700]);
        expect(scrollsDown(present(document.querySelector('.cut')))).toBe(false);
    });

    test('happyPath_inAShadowRootTooAndThePageItself', () => {
        stage(
            host('t-sheet', { style: at(0, 0, 300, 200) }, [pane(200, 500, 'scroll', 'sheet-body')]),
            h('div', { style: at(0, 0, 10, 3000) }),
        );

        const found = scrollers();

        expect(found.map((scroller) => scroller.name)).toEqual(['the page', 't-sheet > div.sheet-body']);
        expect(found[0]?.positions.at(-1)).toBe(scrollMax(present(document.scrollingElement)));
    });

    test('badPath_withAModalOpenOnlyWhatScrollsInsideItCounts', () => {
        const inside = h(
            'div',
            { class: 'inside', style: 'width: 200px; height: 100px; overflow-y: auto;' },
            h('div', { style: 'height: 400px;' }),
        );
        const dialog = h('dialog', {}, inside);
        stage(pane(200, 900, 'auto', 'outside'), dialog);
        (dialog as HTMLDialogElement).showModal();

        expect(scrollers().map((scroller) => scroller.name)).toEqual(['div.inside']);
        (dialog as HTMLDialogElement).close();
    });
});

describe('scrolling', () => {
    test('happyPath_aScrollerIsScrolledThereAndBack', () => {
        stage(pane(200, 900, 'auto', 'list'));
        const [list] = scrollers();

        expect(scrollToPosition([list?.index ?? -1, 450])).toBe(450);
        expect(registeredScroller(0)?.scrollTop).toBe(450);
        expect(restoreScrollers()).toBe(1);
        expect(registeredScroller(0)?.scrollTop).toBe(0);
    });

    test('happyPath_aScrollerOutOfViewIsBroughtIntoViewFirst', () => {
        const inner = pane(100, 400, 'auto', 'inner');
        inner.setAttribute('style', at(0, 500, 300, 100, 'overflow-y: auto;'));
        const outer = h(
            'div',
            { class: 'outer', style: at(0, 0, 300, 200, 'overflow-y: auto;') },
            h('div', { style: 'height: 700px; position: relative;' }, inner),
        );
        stage(outer);
        const found = scrollers();
        const index = found.findIndex((scroller) => scroller.name.endsWith('div.inner'));

        expect(scrollToPosition([index, 300])).toBe(300);
        expect(outer.scrollTop).toBeGreaterThan(0);
        restoreScrollers();
        expect([outer.scrollTop, inner.scrollTop]).toEqual([0, 0]);
    });

    test('badPath_aScrollerThatLeftThePageOrANeverFoundOneIsSkipped', () => {
        expect(restoreScrollers()).toBe(0);
        expect(scrollToPosition([0, 10])).toBeNull();
        const root = stage(pane(200, 900, 'auto', 'list'));
        scrollers();
        root.remove();

        expect(registeredScroller(0)).toBeNull();
        expect(scrollToPosition([0, 10])).toBeNull();
        expect(restoreScrollers()).toBe(0);
    });
});
