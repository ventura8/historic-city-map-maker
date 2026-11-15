import { page } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
    accessibleName,
    boxOf,
    clips,
    composedParent,
    deepHit,
    deepQuery,
    deepSelect,
    escapesClipping,
    flatChain,
    flatContains,
    flatHasAttribute,
    flatParent,
    flatText,
    intersect,
    isDrawn,
    isScreenReaderOnly,
    reaches,
    samplePoints,
    standardSheetOverMap,
    scrollsOn,
    selectorOf,
    selectorStep,
    visibleBoxOf,
} from '../support/dom-walk.js';
import { at, clearStage, h, host, stage } from './fixtures.js';

/** e2e/support/dom-walk.ts: the flat tree, what a visitor sees, names and hit tests, on synthetic DOM in Chromium. */

beforeAll(async () => {
    await page.viewport(800, 600);
});

afterEach(() => {
    clearStage();
});

describe('the flat tree', () => {
    test('happyPath_slotsAndShadowHostsAreParents', () => {
        const slotted = h('span', {}, 'slotted');
        const inner = h('b', {}, 'inner');
        const slot = h('slot');
        const card = host('div', { id: 'card' }, [h('section', {}, slot, inner)], slotted);
        stage(card);
        const section = card.shadowRoot?.querySelector('section') ?? null;
        expect(flatParent(slotted)).toBe(slot);
        expect(flatParent(inner)).toBe(section);
        expect(flatParent(section as Element)).toBe(card);
        expect(flatChain(slotted).slice(0, 4)).toEqual([slotted, slot, section, card]);
        expect(flatContains(card, slotted)).toBe(true);
        expect(flatContains(slotted, card)).toBe(false);
        expect(composedParent(inner)).toBe(section);
        expect(composedParent(section as Element)).toBe(card);
        expect(composedParent(document.documentElement)).toBeNull();
    });

    test('happyPath_deepQueriesAndHostScopedSelectors', () => {
        const button = h('button', { class: 'fab' }, 'go');
        const menu = host('t-menu', {}, [h('div', {}, button)]);
        stage(menu, h('button', { class: 'fab' }, 'outside'));
        expect(deepQuery('button.fab')).toHaveLength(2);
        expect(deepSelect('t-menu >>> button.fab')).toEqual([button]);
        expect(deepSelect('t-other >>> button.fab')).toEqual([]);
        expect(deepSelect('div[data-stage] >>> t-menu >>> button')).toEqual([button]);
        expect(deepSelect('button.fab')).toHaveLength(2);
    });
});

describe('boxes', () => {
    test('happyPath_anInlineLinkOverTwoLinesIsItsLargestLine', () => {
        const link = h('a', { href: '#' }, 'a long link that wraps onto a second line here');
        stage(h('p', { style: at(0, 0, 120, 200) }, 'x ', link));
        const lines = Array.from(link.getClientRects());
        expect(lines.length).toBeGreaterThan(1);
        expect(boxOf(link).width).toBe(Math.max(...lines.map((line) => line.width)));
        const block = h('div', { style: at(5, 6, 7, 8) });
        stage(block);
        expect(boxOf(block)).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    });

    test('happyPath_intersection', () => {
        expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
            x: 5,
            y: 5,
            width: 5,
            height: 5,
        });
        expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBeNull();
    });

    test('happyPath_clippingScrollingAndTheTopLayer', () => {
        const list = h('div', { style: at(0, 0, 100, 50, 'overflow: auto;') }, h('div', { style: 'height: 200px' }));
        const contents = h('div', { style: 'display: contents; overflow: hidden;' });
        const fixed = h('div', { style: 'position: fixed;' });
        const dialog = h('dialog', {}, 'modal');
        stage(list, contents, fixed, dialog);
        expect(clips(list)).toBe(true);
        expect(clips(contents)).toBe(false);
        expect(scrollsOn(list, 'y')).toBe(true);
        expect(scrollsOn(list, 'x')).toBe(false);
        expect(escapesClipping(fixed)).toBe(true);
        expect(escapesClipping(list)).toBe(false);
        (dialog as HTMLDialogElement).showModal();
        expect(escapesClipping(dialog)).toBe(true);
        (dialog as HTMLDialogElement).close();
    });

    test('happyPath_theVisiblePartIsCutByClippingAncestorsAndTheViewport', () => {
        const inside = h('div', { style: at(0, 30, 100, 40) });
        const scrolledAway = h('div', { style: at(0, 120, 100, 40) });
        const list = h('div', { style: at(10, 10, 100, 50, 'overflow: hidden;') }, inside, scrolledAway);
        const pinned = h('div', { style: 'position: fixed; left: 0; top: 0; width: 30px; height: 30px;' });
        const pinnedInList = h('div', { style: at(0, 0, 100, 100, 'overflow: hidden;') }, pinned);
        const offScreen = h('div', { style: at(900, 0, 10, 10) });
        stage(list, pinnedInList, offScreen);
        expect(visibleBoxOf(inside)).toEqual({ x: 10, y: 40, width: 100, height: 20 });
        expect(visibleBoxOf(scrolledAway)).toBeNull();
        expect(visibleBoxOf(pinned)).toEqual({ x: 0, y: 0, width: 30, height: 30 });
        expect(visibleBoxOf(offScreen)).toBeNull();
    });
});

describe('what a visitor sees', () => {
    test('happyPath_drawnHiddenTransparentAndScreenReaderOnly', () => {
        const shown = h('div', { style: at(0, 0, 10, 10) });
        const hidden = h('div', { style: at(0, 0, 10, 10, 'visibility: hidden;') });
        const clear = h('div', { style: at(0, 0, 10, 10, 'opacity: 0;') });
        const empty = h('div', { style: at(0, 0, 0, 10) });
        const srOnly = h('span', { style: at(0, 0, 1, 1, 'overflow: hidden; clip-path: inset(50%);') }, 'for screen readers');
        const clipped = h('span', { style: at(0, 0, 10, 10, 'clip: rect(0px, 0px, 0px, 0px);') }, 'x');
        const tiny = h('span', { style: at(0, 0, 1, 1, 'overflow: hidden;') }, 'x');
        stage(shown, hidden, clear, empty, srOnly, clipped, tiny);
        expect([shown, hidden, clear, empty].map((element) => isDrawn(element))).toEqual([true, false, false, false]);
        expect([srOnly, clipped, tiny, shown].map((element) => isScreenReaderOnly(element))).toEqual([true, true, true, false]);
    });

    test('happyPath_attributesUpTheFlatTree', () => {
        const inner = h('button', {}, 'x');
        const card = host('div', { inert: '' }, [inner]);
        stage(card);
        expect(flatHasAttribute(inner, 'inert')).toBe(true);
        expect(flatHasAttribute(inner, 'aria-hidden', 'true')).toBe(false);
    });
});

describe('names', () => {
    test('happyPath_textThroughSlotsAndShadowRootsWithoutHiddenParts', () => {
        const icon = host('t-icon', { 'aria-hidden': 'true' }, ['menu']);
        const label = host('t-label', {}, [h('slot')], 'Slotted');
        const fallback = host('t-fallback', {}, [h('slot', {}, 'Fallback')]);
        stage(icon, label, fallback);
        expect(flatText(icon)).toBe('');
        expect(flatText(label).trim()).toBe('Slotted');
        expect(flatText(fallback).trim()).toBe('Fallback');
        expect(flatText(document.createComment('x'))).toBe('');
    });

    test('happyPath_theAccessibleNameInOrderOfPrecedence', () => {
        const labelled = h('button', { 'aria-label': 'Meniu' }, 'ignored');
        const heading = h('span', { id: 'heading' }, 'Straturi');
        const byId = h('section', { 'aria-labelledby': 'heading missing' });
        const input = h('input', { id: 'field' });
        const label = h('label', { for: 'field' }, 'Token');
        const image = h('img', { alt: 'Foto' });
        const titled = h('div', { title: 'Titlu' });
        const long = h('button', {}, 'x'.repeat(80));
        const hidden = h('input', { type: 'hidden', title: 'Secret' });
        stage(labelled, heading, byId, label, input, image, titled, long, hidden);
        expect(accessibleName(hidden)).toBe('Secret');
        expect([labelled, byId, input, image, titled].map((element) => accessibleName(element))).toEqual([
            'Meniu',
            'Straturi',
            'Token',
            'Foto',
            'Titlu',
        ]);
        expect(accessibleName(long)).toBe(`${'x'.repeat(57)}...`);
    });

    test('happyPath_aReadableSelectorPath', () => {
        const button = h('button', { id: 'go', class: 'fab interactive extra', 'data-layout-check': 'menu' });
        const menu = host('t-menu', { class: 'dock' }, [button]);
        stage(menu);
        expect(selectorStep(button)).toBe('button#go.fab.interactive[data-layout-check=menu]');
        expect(selectorOf(button)).toBe('t-menu.dock > button#go.fab.interactive[data-layout-check=menu]');
    });
});

describe('hit tests', () => {
    test('happyPath_theDeepestElementThroughShadowRoots', () => {
        const inner = h('button', { style: at(0, 0, 50, 50) }, 'x');
        const card = host('t-card', { style: at(0, 0, 50, 50) }, [inner]);
        const empty = host('t-empty', { style: at(100, 0, 50, 50) }, []);
        stage(card, empty);
        expect(deepHit(25, 25)).toBe(inner);
        expect(deepHit(125, 25)).toBe(empty);
        expect(deepHit(-5, -5)).toBeNull();
    });

    test('happyPath_samplePoints', () => {
        expect(samplePoints({ x: 0, y: 0, width: 100, height: 50 }, false)).toEqual([
            { x: 50, y: 25 },
            { x: 20, y: 10 },
            { x: 20, y: 40 },
            { x: 80, y: 10 },
            { x: 80, y: 40 },
        ]);
        expect(samplePoints({ x: 0, y: 0, width: 100, height: 50 }, true)).toEqual([{ x: 50, y: 25 }]);
        expect(samplePoints({ x: 0, y: 0, width: 3, height: 50 }, false)).toHaveLength(1);
    });

    test('happyPath_aHitReachesTheElementOrAPassThroughOne', () => {
        const child = h('span', {}, 'child');
        const button = h('button', { style: at(0, 0, 50, 50) }, child);
        const passThrough = h('div', { style: 'pointer-events: none;' });
        const around = h('div', {}, passThrough);
        stage(button, around);
        expect(reaches(button, child)).toBe(true);
        expect(reaches(button, around)).toBe(false);
        expect(reaches(button, null)).toBe(false);
        expect(reaches(passThrough, around)).toBe(true);
    });
});

describe('standardSheetOverMap', () => {
    test('happyPath_aStandardSheetOverTheMapIsByDesign_butAModalOneOrAnotherElementIsNot', () => {
        const canvas = document.createElement('canvas');
        canvas.className = 'mapboxgl-canvas';
        const sheet = document.createElement('hcm-sheet');
        const part = document.createElement('div');
        sheet.append(part);
        document.body.append(canvas, sheet);

        expect(standardSheetOverMap(canvas, part)).toBe(true);
        sheet.setAttribute('modal', '');
        expect(standardSheetOverMap(canvas, part)).toBe(false);
        expect(standardSheetOverMap(canvas, canvas)).toBe(false);
        expect(standardSheetOverMap(canvas, null)).toBe(false);
        expect(standardSheetOverMap(part, part)).toBe(false);
        canvas.remove();
        sheet.remove();
    });
});
