import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
    activeName,
    backgroundBehind,
    contentPlace,
    contrastKind,
    controlContrasts,
    deepActive,
    expectedStops,
    focusIdOf,
    focusStopOf,
    ringBoxOf,
    ringCutterOf,
    focusView,
    isGroupStop,
    landmarkRole,
    landmarks,
    openPopups,
    partColours,
    recordFocus,
    refreshStop,
    rememberFocus,
    restoreFocus,
    ringColourOf,
    type FocusStop,
} from '../support/a11y-probe.js';
import { at, clearStage, h, host, stage } from './fixtures.js';

/** e2e/support/a11y-probe.ts: the Tab walk's stops, focus rings, non-text contrast and landmarks, on synthetic DOM. */

beforeAll(async () => {
    await page.viewport(800, 600);
});

afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    clearStage();
});

const RING = h(
    'style',
    {},
    'button:focus-visible { outline: 3px solid rgb(0, 0, 0); } .shadow:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(0, 0, 255); }',
);

describe('backgrounds and rings', () => {
    test('happyPath_theBackgroundBehindIsCompositedFromTheAncestors', () => {
        const child = h('span', {}, 'x');
        const translucent = h('div', { style: 'background: rgba(0, 0, 0, 0.5);' }, child);
        stage(h('div', { style: 'background: rgb(255, 255, 255);' }, translucent));
        expect(backgroundBehind(child)?.map((channel) => Math.round(channel))).toEqual([128, 128, 128, 1]);
        const bare = h('span');
        stage(bare);
        expect(backgroundBehind(bare)).toEqual([255, 255, 255, 1]);
    });

    test('happyPath_overTheMapItCannotBeMeasured', () => {
        const button = h('button');
        stage(h('div', {}, h('canvas', { class: 'mapboxgl-canvas' }), h('div', {}, button)));
        expect(backgroundBehind(button)).toBeNull();
    });

    test('happyPath_theRingIsTheOutlineOrTheFocusShadow', async () => {
        const outlined = h('button', { style: at(0, 0, 50, 30) }, 'Outlined');
        const shadowed = h('button', { class: 'shadow', style: at(100, 0, 50, 30) }, 'Shadowed');
        const bare = h('div', { tabindex: '0', style: at(200, 0, 50, 30, 'outline: none;') }, 'Bare');
        stage(RING, outlined, shadowed, bare);
        await userEvent.keyboard('{Tab}');
        expect(ringColourOf(outlined)).toEqual([0, 0, 0, 1]);
        const stop = focusStopOf(outlined);
        expect(stop.ring).toBe(true);
        expect(stop.ringContrast).toBeCloseTo(21, 3);
        await userEvent.keyboard('{Tab}');
        expect(ringColourOf(shadowed)).toEqual([0, 0, 255, 1]);
        await userEvent.keyboard('{Tab}');
        expect(ringColourOf(bare)).toBeNull();
        expect(focusStopOf(bare).ring).toBe(false);
        expect(focusStopOf(outlined).ring).toBe(false);
    });

    test('badPath_aRingPastTheEdgeOfABoxThatHidesItsOverflow_happyPath_oneDrawnInsideOrInAScroller', async () => {
        // The visual audit: the bottom sheet's drag handle sat at the sheet's top edge and its ring rose past it.
        const atEdge = h('button', { style: at(10, 0, 48, 48) }, 'Edge');
        const inside = h('button', { style: at(70, 0, 48, 48, 'outline-offset: -4px;') }, 'Inside');
        const sheet = h('section', { class: 'sheet', style: at(0, 20, 200, 100, 'overflow: hidden;') }, atEdge, inside);
        const list = h('div', { style: at(300, 20, 200, 100, 'overflow: auto;') }, h('button', { style: 'margin: 0' }, 'Listed'));
        stage(RING, sheet, list);
        await userEvent.keyboard('{Tab}');
        expect(ringBoxOf(atEdge)).toEqual({ x: 7, y: 17, width: 54, height: 54 });
        expect(focusStopOf(atEdge).ringCutBy).toContain('section.sheet');
        await userEvent.keyboard('{Tab}');
        expect(focusStopOf(inside).ringCutBy).toBeNull();
        await userEvent.keyboard('{Tab}');
        expect(focusStopOf(list.children[0] ?? list).ringCutBy).toBeNull();
        expect(ringBoxOf(h('div'))).toBeNull();
        expect(ringCutterOf(atEdge)).toBeNull();
    });

    test('happyPath_aHiddenElementHasNoView', () => {
        const hidden = h('button', { style: 'display: none;' });
        stage(hidden);
        expect(focusView(hidden)).toEqual({ box: null, obscured: false });
    });
});

describe('the Tab walk', () => {
    test('happyPath_recordsEachStopThenTheFocusLeavingThePage', async () => {
        const first = h('button', { style: at(0, 0, 50, 30) }, 'First');
        const second = h('button', { style: at(0, 100, 50, 30) }, 'Second');
        stage(RING, first, second);
        await userEvent.keyboard('{Tab}');
        const one = (await recordFocus()) as FocusStop;
        await userEvent.keyboard('{Tab}');
        const two = (await recordFocus()) as FocusStop;
        expect([one.name, two.name]).toEqual(['First', 'Second']);
        expect(one.id).toBe(focusIdOf(first));
        expect(one.id).not.toBe(two.id);
        expect(one.scope).toBe('document');
        expect(two.content.top).toBe(100);
        second.blur();
        expect(await recordFocus()).toEqual({ left: true });
    });

    test('happyPath_aHiddenOrCoveredStopIsMeasuredAgainAFrameLater', async () => {
        const covered = h('button', { style: at(0, 0, 50, 30) }, 'Covered');
        const cover = h('div', { style: at(0, 0, 50, 30, 'background: red;') });
        stage(covered, cover);
        covered.focus();
        setTimeout(() => {
            cover.remove();
        });
        const stop = (await recordFocus()) as FocusStop;
        expect(stop.name).toBe('Covered');
        const record = { box: null, obscured: true };
        refreshStop(record, covered);
        expect(record.box).not.toBeNull();
    });

    test('happyPath_theFocusGoesBackWhereItWas', () => {
        const button = h('button', {}, 'Back');
        const other = h('button', {}, 'Other');
        stage(button, other);
        button.focus();
        rememberFocus();
        other.focus();
        restoreFocus();
        expect(deepActive()).toBe(button);
        expect(activeName()).toBe('Back');
        other.focus();
        button.remove();
        restoreFocus();
        expect(activeName()).toBe('');
        delete (window as unknown as { hcmFocusBefore?: unknown }).hcmFocusBefore;
        restoreFocus();
        expect(deepActive()).toBeNull();
    });

    test('happyPath_theShadowRootsActiveElement', () => {
        const inner = h('button', {}, 'Inner');
        stage(host('t-card', {}, [inner]));
        inner.focus();
        expect(deepActive()).toBe(inner);
        expect(focusStopOf(inner).scope).toBe('t-card');
        expect(contentPlace(inner).top).toBe(inner.getBoundingClientRect().top + scrollY);
    });

    test('happyPath_whatTabShouldReach', () => {
        const checked = h('input', { type: 'radio', name: 'theme', checked: '' });
        stage(
            h('button', {}, 'One'),
            h('button', { disabled: '' }, 'Off'),
            h('button', { inert: '' }, 'Inert'),
            h('button', { 'aria-hidden': 'true' }, 'Hidden'),
            h('input', { type: 'radio', name: 'theme' }),
            checked,
            h('input', { type: 'radio', name: 'size' }),
            h('input', { type: 'radio', name: 'size' }),
            h('div', { role: 'button', tabindex: '-1' }, 'Roving'),
        );
        expect(expectedStops().map((stop) => stop.name)).toEqual(['One', '', '']);
        expect(isGroupStop(checked)).toBe(true);
        expect(isGroupStop(h('input', { type: 'radio' }))).toBe(true);
    });

    test('happyPath_insideAnOpenModalOnly_andThePopupsOnTop', () => {
        stage(
            h('button', { style: at(0, 0, 50, 30) }, 'Outside'),
            h('section', { 'aria-modal': 'true', style: at(100, 100, 300, 300) }, h('button', {}, 'Inside')),
            h('div', { role: 'menu', style: at(500, 0, 100, 100) }, 'Menu'),
        );
        expect(expectedStops().map((stop) => stop.name)).toEqual(['Inside']);
        expect(openPopups()).toEqual(['section', 'div']);
    });
});

describe('non-text contrast', () => {
    test('happyPath_whichControlsNeedABoundary', () => {
        stage(
            h('div', { role: 'switch', tabindex: '0' }),
            h('input', { type: 'checkbox' }),
            h('input', { type: 'text' }),
            h('button', {}, h('hcm-icon', { name: 'close' }, 'close')),
            h('button', {}, 'Save'),
            h('button', {}, h('hcm-icon', {}, '')),
        );
        const kinds = Array.from(document.querySelectorAll('[data-stage] > *')).map((element) => contrastKind(element));
        expect(kinds).toEqual(['state', 'state', 'field', 'icon', null, 'icon']);
    });

    test('badPath_aFaintSwitchAndAFaintIcon_happyPath_aStrongField', () => {
        stage(
            h(
                'div',
                { style: 'background: rgb(255, 255, 255);' },
                h(
                    'div',
                    { role: 'switch', tabindex: '0', style: 'width: 52px; height: 32px; background: rgb(240, 240, 240);' },
                    h('span', { style: 'display: block; width: 10px; height: 10px; background: rgb(230, 230, 230);' }),
                ),
                h('input', { type: 'text', 'aria-label': 'Token', style: 'border: 1px solid rgb(0, 0, 0); background: transparent;' }),
                h(
                    'button',
                    { 'aria-label': 'Close', style: 'color: rgb(200, 200, 200); background: transparent; border: 0;' },
                    h('hcm-icon', { name: 'close' }, 'close'),
                ),
                h('button', { disabled: '' }, 'Off'),
            ),
        );
        const found = controlContrasts().map((control) => [control.kind, control.ratio < 3]);
        expect(found).toEqual([
            ['state', true],
            ['field', false],
            ['icon', true],
        ]);
        expect(partColours(h('div'))).toHaveLength(0);
    });

    test('happyPath_theShadowPartsOfAControl_andNothingToMeasureOverTheMap', () => {
        const track = h('span', { style: 'display: block; width: 20px; height: 10px; background: rgb(0, 0, 0);' });
        const toggle = host('t-toggle', { role: 'switch', tabindex: '0', style: at(0, 0, 40, 20) }, [track]);
        stage(toggle);
        expect(partColours(toggle)).toEqual([[0, 0, 0, 1]]);
        clearStage();
        stage(
            h('div', {}, h('canvas', { class: 'mapboxgl-canvas' }), h('div', { role: 'switch', tabindex: '0', style: at(0, 0, 40, 20) })),
        );
        expect(controlContrasts()).toEqual([]);
    });
});

describe('landmarks', () => {
    test('happyPath_explicitAndImplicitRoles', () => {
        const roles = [
            h('div', { role: 'navigation' }),
            h('div', { role: 'button' }),
            h('main'),
            h('nav'),
            h('aside'),
            h('search'),
            h('header'),
            h('footer'),
            h('form', { 'aria-label': 'Search' }),
            h('form'),
            h('section', { 'aria-labelledby': 'title' }, h('h2', { id: 'title' }, 'Layers')),
            h('section'),
            h('article', {}, h('header')),
        ];
        stage(...roles);
        expect(roles.map((element) => landmarkRole(element))).toEqual([
            'navigation',
            null,
            'main',
            'navigation',
            'complementary',
            'search',
            'banner',
            'contentinfo',
            'form',
            null,
            'region',
            null,
            null,
        ]);
        expect(landmarkRole(roles[12]?.firstElementChild ?? h('div'))).toBeNull();
    });

    test('happyPath_onlyDrawnLandmarksWithTheirNames', () => {
        stage(
            h('nav', { 'aria-label': 'Main', style: at(0, 0, 100, 30) }, 'x'),
            h('nav', { style: 'display: none;' }),
            h('nav', { inert: '', style: at(0, 50, 100, 30) }, 'y'),
            h('div', { role: 'button', style: at(0, 100, 100, 30) }, 'z'),
        );
        expect(landmarks().map((landmark) => [landmark.role, landmark.name])).toEqual([['navigation', 'Main']]);
    });
});
