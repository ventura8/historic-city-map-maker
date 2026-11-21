import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_DATE_MENU_TAG, HcmDateMenu, dateMenuOrigin, defineHcmDateMenu, sideRoom } from '../../src/viewer/hcm-date-menu.js';
import { recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

const ITEMS = [
    { id: 'b', date: '12 aprilie 1966', label: 'Corona A' },
    { id: 'a', date: '3 septembrie 1966', label: 'Corona B' },
    { id: 'c', date: '1966', label: 'Hartă 1966' },
];
const ANCHOR = { x: 200, y: 500, width: 64, height: 40 };
const ROOM = { width: 400, height: 700 };

async function menu(properties: Partial<HcmDateMenu> = {}): Promise<HcmDateMenu> {
    defineHcmDateMenu();
    const holder = document.createElement('div');
    holder.style.cssText = 'position: relative; width: 400px; height: 700px';
    const element = document.createElement(HCM_DATE_MENU_TAG);
    Object.assign(element, { items: ITEMS, selected: 'a', label: 'Datele din 1966', anchor: ANCHOR, ...properties });
    holder.append(element);
    document.body.append(holder);
    await element.updateComplete;
    return element;
}

function key(element: HcmDateMenu, name: string): void {
    shadowQuery(element, '[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

function focusedItem(element: HcmDateMenu): string | null | undefined {
    return element.shadowRoot?.activeElement?.getAttribute('data-item');
}

describe('<hcm-date-menu>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theDatesAsRadioItemsTheOneOnTopCheckedAndFocused', async () => {
        const element = await menu();

        await expect.element(page.getByRole('menu', { name: 'Datele din 1966' })).toBeVisible();
        const items = shadowQueryAll(element, '[role="menuitemradio"]');
        expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
        expect(items.every((item) => item.getBoundingClientRect().height >= 48)).toBe(true);
        expect(focusedItem(element)).toBe('a');
    });

    it('happyPath_arrowsHomeEndMoveAndAPressPicks', async () => {
        const element = await menu({ selected: null });
        const events = recordEvents(element, 'hcm-date-pick', 'hcm-close');
        expect(focusedItem(element)).toBe('b');

        key(element, 'ArrowDown');
        expect(focusedItem(element)).toBe('a');
        key(element, 'End');
        expect(focusedItem(element)).toBe('c');
        key(element, 'ArrowDown');
        expect(focusedItem(element)).toBe('b');
        key(element, 'ArrowUp');
        expect(focusedItem(element)).toBe('c');
        key(element, 'Home');
        expect(focusedItem(element)).toBe('b');
        key(element, 'x');
        shadowQuery(element, '[data-item="c"]').click();

        expect(events).toEqual([{ type: 'hcm-date-pick', detail: { layerId: 'c' } }]);
    });

    it('badPath_escOrAPressElsewhereClosesWithoutAPickTabDoesNot', async () => {
        const element = await menu();
        const events = recordEvents(element, 'hcm-date-pick', 'hcm-close');

        key(element, 'Escape');
        key(element, 'Tab');
        shadowQuery(element, '.scrim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(events.map((event) => event.type)).toEqual(['hcm-close', 'hcm-close']);
    });

    it('badPath_closedItRendersNothing', async () => {
        const element = await menu({ anchor: null });

        expect(element.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    });

    it('happyPath_standingItOpensOnTheTrailingSideAndInsideTheViewer', async () => {
        const element = await menu({ vertical: true, anchor: { x: 16, y: 300, width: 68, height: 48 } });
        const box = shadowQuery(element, '.menu').getBoundingClientRect();
        const host = element.getBoundingClientRect();

        expect(box.left).toBe(16 + 68 + 8);
        expect(box.bottom).toBeLessThanOrEqual(host.bottom - 42);
    });

    it('happyPath_lyingItOpensAboveTheAnchorCentred', () => {
        const origin = dateMenuOrigin(ANCHOR, { width: 100, height: 150 }, ROOM, 'above');

        expect(origin).toEqual({ x: 182, y: 342 });
    });

    it('badPath_nearAnEdgeItStaysInsideAndOffTheLegalStrip', () => {
        expect(dateMenuOrigin({ x: 0, y: 10, width: 40, height: 40 }, { width: 100, height: 150 }, ROOM, 'above')).toEqual({ x: 8, y: 8 });
        expect(dateMenuOrigin({ x: 380, y: 690, width: 20, height: 10 }, { width: 100, height: 150 }, ROOM, 'end')).toEqual({
            x: 292,
            y: 508,
        });
        expect(dateMenuOrigin({ x: 300, y: 300, width: 68, height: 48 }, { width: 100, height: 100 }, ROOM, 'start')).toEqual({
            x: 192,
            y: 274,
        });
    });

    it('happyPath_besideAStandingTimelineItIsNoWiderThanTheRoomPastIt', () => {
        const card = { x: 16, y: 16, width: 68, height: 600 };

        expect(sideRoom(card, 360, 'end')).toBe(360 - 84 - 16);
        expect(sideRoom({ ...card, x: 276 }, 360, 'start')).toBe(260);
        expect(sideRoom(card, 1024, 'above')).toBe(280);
        expect(sideRoom({ ...card, x: 200 }, 300, 'end')).toBe(112);
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmDateMenu();
        defineHcmDateMenu();

        expect(customElements.get(HCM_DATE_MENU_TAG)).toBe(HcmDateMenu);
    });
});

describe('<hcm-date-menu> as a peek (a pointer resting on the year)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    function centre(element: Element): { readonly x: number; readonly y: number } {
        const box = element.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }

    it('happyPath_noScrimAndTheFocusStaysWhereItWas', async () => {
        const element = await menu({ peek: true });

        expect(element.shadowRoot?.querySelector('.scrim')).toBeNull();
        expect(focusedItem(element)).toBeUndefined();
        await expect.element(page.getByRole('menu', { name: 'Datele din 1966' })).toBeVisible();
    });

    it('happyPath_aFingerSlidingOverItMarksTheDateAndLiftingPicksIt', async () => {
        const element = await menu({ peek: true });
        const events = recordEvents(element, 'hcm-date-pick');
        const item = shadowQuery(element, '[data-item="c"]');
        const at = centre(item);

        expect(element.touchAt(at.x, at.y, false)).toBe(true);
        expect(item.hasAttribute('data-armed')).toBe(true);
        expect(element.touchAt(at.x, at.y, true)).toBe(true);

        expect(events).toEqual([{ type: 'hcm-date-pick', detail: { layerId: 'c' } }]);
    });

    it('badPath_aFingerOffTheMenuMarksNothingAndPicksNothing', async () => {
        const element = await menu({ peek: true });
        const events = recordEvents(element, 'hcm-date-pick');
        const at = centre(shadowQuery(element, '[data-item="a"]'));
        element.touchAt(at.x, at.y, false);

        expect(element.touchAt(1, 1, true)).toBe(false);
        expect(shadowQueryAll(element, '[data-armed]')).toHaveLength(0);
        expect(events).toEqual([]);
        const closed = await menu({ anchor: null });
        expect(closed.touchAt(1, 1, true)).toBe(false);
    });

    it('happyPath_itKeepsClearOfTheControlsItIsGiven', async () => {
        const control = { x: 180, y: 380, width: 140, height: 120 };
        const element = await menu({ peek: true, avoid: () => [control] });
        const box = shadowQuery(element, '.menu').getBoundingClientRect();
        const host = element.getBoundingClientRect();
        const at = control;

        const meets = box.left < at.x + control.width && at.x < box.right && box.top < at.y + control.height && at.y < box.bottom;
        expect(meets).toBe(false);
        expect(box.bottom).toBeLessThanOrEqual(ANCHOR.y + host.y - 8);
    });

    it('happyPath_theMouseEnteringAndLeavingSaysSoAFingerDoesNot', async () => {
        const element = await menu({ peek: true });
        const events = recordEvents(element, 'hcm-date-menu-pointer');
        const box = shadowQuery(element, '.menu');

        box.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        box.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        box.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));

        expect(events.map((event) => event.detail)).toEqual([{ inside: true }, { inside: false }]);
    });
});
