import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
    createCompareUi,
    defineHcmCompare,
    dividerKey,
    dividerPercent,
    draggedPosition,
    HCM_COMPARE_TAG,
    type CompareUiEvents,
    type CompareUiProps,
    type HcmCompare,
} from '../../../src/viewer/compare/index.js';
import { defineKitDoubles, fireKitEvent, mountElement, shadowQuery, shadowQueryAll } from '../doubles.js';

/** Swipe compare's surface (M4, V06; docs/research/M4-interfaces.md §3.5–§3.7). */

const PROPS: CompareUiProps = {
    locale: 'en',
    mode: 'swipe',
    position: 0.5,
    mainLabel: 'Corona 1966',
    layerId: null,
    choices: [
        { layerId: 'kh4-1966', label: 'Corona 1966' },
        { layerId: 'kh9-1977', label: 'KH-9 1977' },
        { layerId: null, label: 'Today' },
    ],
    credit: '',
};

interface Heard {
    readonly positions: number[];
    readonly chosen: (string | null)[];
    closed: number;
}

function listen(): { events: CompareUiEvents; heard: Heard } {
    const heard: Heard = { positions: [], chosen: [], closed: 0 };
    const events: CompareUiEvents = {
        onPosition: (position) => heard.positions.push(position),
        onChoose: (layerId) => heard.chosen.push(layerId),
        onClose: () => {
            heard.closed += 1;
        },
    };
    return { events, heard };
}

/** A compare surface over a 1000 × 600 box, or `size` with the viewer's custom properties in `style`. */
async function surface(
    props: Partial<CompareUiProps> = {},
    size = 'width: 1000px; height: 600px;',
): Promise<{ element: HcmCompare; heard: Heard }> {
    const box = document.createElement('div');
    box.style.cssText = `position: relative; ${size}`;
    document.body.append(box);
    const { events, heard } = listen();
    const element = await mountElement<HcmCompare>(HCM_COMPARE_TAG, { props: { ...PROPS, ...props }, events });
    box.append(element);
    await element.updateComplete;
    return { element, heard };
}

describe('the divider', () => {
    it('happyPath_keysMoveTheDividerByOneTenOrToTheEdges', () => {
        const keys = [
            dividerKey('ArrowRight', false, 0.5),
            dividerKey('ArrowDown', false, 0.5),
            dividerKey('ArrowLeft', true, 0.5),
            dividerKey('PageUp', false, 0.5),
            dividerKey('Home', false, 0.5),
            dividerKey('End', true, 0.5),
        ];

        expect(keys).toEqual([0.51, 0.49, 0.4, 0.6, 0, 1]);
        expect(dividerPercent(0.333)).toBe(33);
    });

    it('badPath_otherKeysAndTheEdgesStopIt', () => {
        expect(dividerKey('a', false, 0.5)).toBeNull();
        expect(dividerKey('Escape', false, 0.5)).toBeNull();
        expect([dividerKey('ArrowRight', true, 0.97), dividerKey('PageDown', false, 0.04)]).toEqual([1, 0]);
        expect([draggedPosition(0.5, 250, 1000), draggedPosition(0.5, -900, 1000), draggedPosition(0.4, 30, 0)]).toEqual([0.75, 0, 0.4]);
    });
});

describe('<hcm-compare>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmCompare();
        defineHcmCompare();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_swipeShowsTheSecondMapTheDividerAndTheBar', async () => {
        const { element } = await surface({ credit: 'Source: USGS EROS' });

        const handle = page.getByRole('slider', { name: 'Divider between the maps' });
        await expect.element(handle).toHaveAttribute('aria-valuenow', '50');
        await expect.element(handle).toHaveAttribute('aria-valuetext', 'Corona 1966: 50%, Today: 50%');
        await expect.element(page.getByRole('group', { name: 'Comparison' })).toBeVisible();
        await expect.element(page.getByRole('combobox', { name: 'Compare with' })).toHaveValue('');
        await expect.element(page.getByText('Source: USGS EROS')).toBeVisible();
        expect(element.getAttribute('mode')).toBe('swipe');
        expect(element.style.getPropertyValue('--hcm-compare-at')).toBe('50%');
        const second = shadowQuery(element, '.second');
        expect(second.hasAttribute('inert')).toBe(true);
        expect(getComputedStyle(second).clipPath).toBe('inset(0px 0px 0px 50%)');
        await expect(element.mapContainer()).resolves.toBe(second);
    });

    it('happyPath_theKeyboardSettlesTheDividerAndEscCloses', async () => {
        const { element, heard } = await surface();
        const handle = shadowQuery(element, '.handle');

        handle.focus();
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
        await userEvent.keyboard('{End}');
        await userEvent.keyboard('{Tab}');
        handle.focus();
        await userEvent.keyboard('{Escape}');

        expect(heard.positions).toEqual([0.51, 0.4, 1]);
        expect(heard.closed).toBe(1);
    });

    it('happyPath_theChooserAndCloseTellTheSession', async () => {
        const { element, heard } = await surface();

        await page.getByRole('combobox', { name: 'Compare with' }).selectOptions('KH-9 1977');
        const select = shadowQuery(element, 'select') as HTMLSelectElement;
        select.value = '';
        select.dispatchEvent(new Event('change'));
        await page.getByRole('button', { name: 'Close the comparison' }).click();

        expect(heard.chosen).toEqual(['kh9-1977', null]);
        expect(heard.closed).toBe(1);
    });

    it('happyPath_aCompactWindowTogglesTheOneMapBetweenTheSides', async () => {
        const { element, heard } = await surface({ mode: 'toggle', position: 1, layerId: 'kh9-1977' });
        const toggle = shadowQuery(element, 'hcm-segmented-button') as HTMLElement & { value: string; label: string };

        fireKitEvent(toggle, 'hcm-change', { value: 'compared' });
        fireKitEvent(toggle, 'hcm-change', { value: 'main' });

        expect([toggle.value, toggle.label]).toEqual(['main', 'Side shown']);
        expect(heard.positions).toEqual([0, 1]);
        expect(shadowQueryAll(element, '.handle')).toEqual([]);
        // The container stays for a parked second map, unseen; the toggle mounts no map into it.
        expect(getComputedStyle(shadowQuery(element, '.second')).visibility).toBe('hidden');
        await expect(element.mapContainer()).resolves.toBeNull();
    });

    it('badPath_theBarBeginsAfterAStandingTimelineAndTheHandleEndsAboveALyingOne', async () => {
        // The owner, 2026-11-08: upright phones stand the timeline on the leading edge, short windows lay it at the foot.
        const upright = await surface({ mode: 'toggle' }, 'width: 375px; height: 700px; --hcm-top-start: 96px;');
        const bar = shadowQuery(upright.element, '.bar').getBoundingClientRect();
        expect(bar.left - upright.element.getBoundingClientRect().left).toBeGreaterThanOrEqual(96);
        document.body.replaceChildren();

        const short = await surface({ mode: 'swipe' }, 'width: 915px; height: 412px;');
        const handle = shadowQuery(short.element, '.handle').getBoundingClientRect();
        const box = short.element.getBoundingClientRect();
        expect(box.bottom - handle.bottom).toBeGreaterThanOrEqual(42 + 84 + 8 + 40 + 8);
        // The map's centre stays the map's: a tap there is a tap on the map (the tour samples it).
        expect(box.top + box.height / 2 - handle.bottom).toBeGreaterThanOrEqual(8);
        expect(handle.top - box.top).toBeGreaterThanOrEqual(16 + 56 + 8);
    });

    it('badPath_theToggleOnTheComparedSideAndASideWithoutAChoice', async () => {
        const { element } = await surface({ mode: 'toggle', position: 0, layerId: 'gone' });
        const toggle = shadowQuery(element, 'hcm-segmented-button') as HTMLElement & {
            value: string;
            options: readonly { readonly label: string }[];
        };

        expect(toggle.value).toBe('compared');
        expect(toggle.options.map((option) => option.label)).toEqual(['Corona 1966', '']);
    });

    it('badPath_nothingRendersBeforeTheSessionSetsItsProps', async () => {
        const element = await mountElement<HcmCompare>(HCM_COMPARE_TAG);

        expect(element.shadowRoot?.children).toHaveLength(0);
        expect(element.hasAttribute('mode')).toBe(false);
        expect(() => {
            element.events.onClose();
            element.events.onPosition(1);
            element.events.onChoose(null);
        }).not.toThrow();
    });

    it('badPath_aKeyTheDividerDoesNotUseIsLeftToThePage', async () => {
        const { element, heard } = await surface();
        const key = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });

        shadowQuery(element, '.handle').dispatchEvent(key);

        expect(key.defaultPrevented).toBe(false);
        expect(heard.positions).toEqual([]);
    });

    it('badPath_aRemovedSurfaceHasNoMapContainer', async () => {
        const { element } = await surface();

        element.remove();

        await expect(element.mapContainer()).resolves.toBeNull();
    });
});

describe('<hcm-compare> dragged', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmCompare();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aDragMovesTheClipAtOnceAndSettlesOnRelease', async () => {
        const { element, heard } = await surface();
        const handle = shadowQuery(element, '.handle');
        const box = handle.getBoundingClientRect();
        // The mouse is always an active pointer (id 1), so the handle may capture it; a touch (id 8) starts nothing meanwhile.
        const pointer = { pointerId: 1, bubbles: true, clientY: box.top + 24 };

        handle.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: box.left + 24 }));
        handle.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, pointerId: 8, clientX: box.left + 600 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { ...pointer, pointerId: 8, clientX: box.left + 400 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: box.left + 224 }));
        await element.updateComplete;
        const live = element.style.getPropertyValue('--hcm-compare-at');
        handle.dispatchEvent(new PointerEvent('pointerup', { ...pointer, pointerId: 8, clientX: box.left + 400 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: box.left + 224 }));
        await element.updateComplete;

        expect(live).toBe('70%');
        expect(heard.positions).toEqual([0.7]);
        expect(element.live).toBeNull();
    });

    it('badPath_aDragCutShortByTheToggleStartsAfreshInSwipe', async () => {
        const { element, heard } = await surface();
        const handle = shadowQuery(element, '.handle');
        const box = handle.getBoundingClientRect();
        handle.dispatchEvent(
            new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, clientX: box.left + 24, clientY: box.top + 24 }),
        );

        element.props = { ...PROPS, mode: 'toggle' };
        await element.updateComplete;
        element.props = PROPS;
        await element.updateComplete;
        const again = shadowQuery(element, '.handle');
        again.dispatchEvent(
            new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, clientX: box.left + 24, clientY: box.top + 24 }),
        );
        again.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true, clientX: box.left + 124, clientY: box.top + 24 }));

        expect(heard.positions).toEqual([0.6]);
    });
});

describe('createCompareUi', () => {
    beforeAll(() => {
        defineKitDoubles();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theSurfaceGoesAfterTheMapAndWaitsForMapboxCss', async () => {
        const pane = document.createElement('div');
        const anchor = document.createElement('div');
        pane.append(anchor, document.createElement('p'));
        document.body.append(pane);
        const { events } = listen();

        const ui = createCompareUi(anchor, 'data:text/css,.mapboxgl-canary%7Bcolor:red%7D', events);
        ui.update(PROPS);
        const container = await ui.mapContainer();

        const element = anchor.nextElementSibling as HcmCompare;
        expect(element.localName).toBe(HCM_COMPARE_TAG);
        expect(container).toBe(shadowQuery(element, '.second'));
        expect(element.shadowRoot?.querySelector('link')?.getAttribute('href')).toContain('data:text/css');
    });

    it('happyPath_removingTheSurfaceGivesTheFocusBack', async () => {
        const opener = document.createElement('button');
        const anchor = document.createElement('div');
        document.body.append(opener, anchor);
        opener.focus();
        const ui = createCompareUi(anchor, '', listen().events);
        ui.update(PROPS);
        await ui.mapContainer();
        shadowQuery(anchor.nextElementSibling as HcmCompare, '.handle').focus();

        ui.remove();

        expect(document.activeElement).toBe(opener);
        expect(anchor.nextElementSibling).toBeNull();
    });

    it('badPath_removingASurfaceWithoutTheFocusLeavesTheFocusAlone', () => {
        const elsewhere = document.createElement('button');
        const anchor = document.createElement('div');
        document.body.append(anchor, elsewhere);
        const ui = createCompareUi(anchor, '', listen().events);
        ui.update({ ...PROPS, mode: 'toggle' });
        elsewhere.focus();

        ui.remove();

        expect(document.activeElement).toBe(elsewhere);
    });
});

describe('@hcm/ui/viewer/compare', () => {
    it('happyPath_theSurfaceIsReachedOnlyThroughItsOwnEntry', async () => {
        const root = await import('../../../src/index.js');
        const viewer = await import('../../../src/viewer/index.js');
        const compare = await import('../../../src/viewer/compare/index.js');

        expect(new Set(Object.keys(compare))).toEqual(
            new Set([
                'HCM_COMPARE_TAG',
                'HcmCompare',
                'createCompareUi',
                'defineHcmCompare',
                'dividerKey',
                'dividerPercent',
                'draggedPosition',
            ]),
        );
        expect(Object.keys(root).filter((name) => /compare/i.test(name))).toEqual([]);
        expect(Object.keys(viewer).filter((name) => /compare/i.test(name))).toEqual([]);
    });
});
