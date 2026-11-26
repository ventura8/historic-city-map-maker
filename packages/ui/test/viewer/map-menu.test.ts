/**
 * The map's menu (the owner, 2026-11-09; V62): what opens it (a right click without a drag, a long press, the ContextMenu
 * key), where it stands, its items and how it closes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HCM_MAP_MENU_TAG, MAP_MENU_ITEMS, defineHcmMapMenu, menuOrigin, placeAt, type HcmMapMenu } from '../../src/viewer/map-menu.js';
import { LONG_PRESS_MS, MapMenuTrigger, watchMapMenu, type MenuPoint } from '../../src/viewer/map-menu-trigger.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

const VIEW = { center: [26.1, 44.43] as [number, number], zoom: 16, bearing: 0 };

function pointer(target: Element, type: string, init: PointerEventInit): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
}

function context(target: Element, x: number, y: number): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(event);
    return event;
}

function mapBox(): HTMLElement {
    const map = document.createElement('div');
    map.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
    document.body.append(map);
    return map;
}

describe('MapMenuTrigger', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    it('happyPath_aRightClickOpensAtThePointOnRelease', () => {
        const map = mapBox();
        const opened: MenuPoint[] = [];
        const stop = watchMapMenu(map, (point) => opened.push(point));

        pointer(map, 'pointerdown', { button: 2, pointerType: 'mouse', clientX: 50, clientY: 60 });
        const event = context(map, 50, 60);
        expect(opened).toEqual([]);
        pointer(map, 'pointerup', { button: 2, pointerType: 'mouse', clientX: 50, clientY: 60 });
        context(map, 70, 80);
        stop();
        context(map, 1, 1);

        expect(event.defaultPrevented).toBe(true);
        expect(opened).toEqual([
            { x: 50, y: 60 },
            { x: 70, y: 80 },
        ]);
    });

    it('badPath_aRightDragRotatesAndOpensNothing', () => {
        const map = mapBox();
        const open = vi.fn();
        const trigger = new MapMenuTrigger(map, open);

        pointer(map, 'pointerdown', { button: 2, pointerType: 'mouse', clientX: 50, clientY: 60 });
        context(map, 50, 60);
        pointer(map, 'pointermove', { pointerType: 'mouse', clientX: 120, clientY: 60 });
        pointer(map, 'pointerup', { pointerType: 'mouse', clientX: 120, clientY: 60 });
        context(map, 120, 60);
        trigger.stop();

        expect(open).not.toHaveBeenCalled();
    });

    it('happyPath_aLongPressOpensOnceAndTheBrowsersOwnMenuEventIsTheSameGesture', () => {
        vi.useFakeTimers();
        const map = mapBox();
        const open = vi.fn();
        const trigger = new MapMenuTrigger(map, open);

        pointer(map, 'pointerdown', { pointerType: 'touch', clientX: 30, clientY: 40 });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        context(map, 30, 40);
        pointer(map, 'pointerup', { pointerType: 'touch', clientX: 30, clientY: 40 });
        trigger.stop();

        expect(open.mock.calls).toEqual([[{ x: 30, y: 40 }]]);
    });

    it.each([
        ['a move', 'pointermove', { pointerType: 'touch', clientX: 80, clientY: 40 }],
        ['a second finger', 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 90, clientY: 90 }],
        ['an early release', 'pointerup', { pointerType: 'touch', clientX: 30, clientY: 40 }],
    ] as const)('badPath_%sCancelsTheLongPress', (_name, type, init) => {
        vi.useFakeTimers();
        const map = mapBox();
        const open = vi.fn();
        const trigger = new MapMenuTrigger(map, open);

        pointer(map, 'pointerdown', { pointerType: 'touch', clientX: 30, clientY: 40 });
        pointer(map, type, init);
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        trigger.stop();

        expect(open).not.toHaveBeenCalled();
    });

    it('happyPath_aFingerOnTheMapAndTheLongPressThatOpenedTheMenuStartNoTextSelection', () => {
        vi.useFakeTimers();
        const map = mapBox();
        const trigger = new MapMenuTrigger(map, vi.fn());
        const select = (): boolean => !map.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));

        pointer(map, 'pointerdown', { pointerType: 'touch', clientX: 30, clientY: 40 });
        const whileDown = select();
        vi.advanceTimersByTime(LONG_PRESS_MS);
        pointer(map, 'pointerup', { pointerType: 'touch', clientX: 30, clientY: 40 });
        const afterTheMenu = select();
        trigger.stop();

        expect([whileDown, afterTheMenu]).toEqual([true, true]);
    });

    it('badPath_aMouseOnTheMapKeepsTheBrowsersSelectionAndATapReleasedLetsItGo', () => {
        vi.useFakeTimers();
        const map = mapBox();
        const trigger = new MapMenuTrigger(map, vi.fn());
        const select = (): boolean => !map.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));

        pointer(map, 'pointerdown', { pointerType: 'mouse', clientX: 30, clientY: 40 });
        const mouse = select();
        pointer(map, 'pointerup', { pointerType: 'mouse', clientX: 30, clientY: 40 });
        pointer(map, 'pointerdown', { pointerType: 'touch', clientX: 30, clientY: 40 });
        pointer(map, 'pointerup', { pointerType: 'touch', clientX: 30, clientY: 40 });
        const afterATap = select();
        trigger.stop();
        const stopped = select();

        expect([mouse, afterATap, stopped]).toEqual([false, false, false]);
    });

    it('happyPath_theContextMenuKeyAndShiftF10OpenAtTheCentre', () => {
        const map = mapBox();
        const open = vi.fn();
        const trigger = new MapMenuTrigger(map, open);

        map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
        map.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
        map.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true }));
        trigger.stop();

        expect(open.mock.calls).toEqual([[{ x: 200, y: 150 }], [{ x: 200, y: 150 }]]);
    });
});

describe('placeAt and menuOrigin', () => {
    it('happyPath_theCentreIsTheViewsCentreAndEastIsRightOrUpWhenTurned', () => {
        const size = { width: 400, height: 300 };
        const centre = placeAt({ x: 200, y: 150 }, VIEW, size);
        const right = placeAt({ x: 300, y: 150 }, VIEW, size);
        const up = placeAt({ x: 200, y: 50 }, { ...VIEW, bearing: 90 }, size);

        expect(centre.lng).toBeCloseTo(26.1, 6);
        expect(centre.lat).toBeCloseTo(44.43, 6);
        expect(right.lng).toBeGreaterThan(26.1);
        expect(up.lng).toBeCloseTo(right.lng, 6);
    });

    it('badPath_aMenuNearAnEdgeMovesBackInside', () => {
        const map = { width: 360, height: 640 };
        const menu = { width: 220, height: 112 };

        expect(menuOrigin({ x: 340, y: 620 }, menu, map)).toEqual({ x: 132, y: 520 });
        expect(menuOrigin({ x: 2, y: 3 }, menu, map)).toEqual({ x: 8, y: 8 });
    });
});

describe('<hcm-map-menu>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmMapMenu();
        defineHcmMapMenu();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    async function menu(point: MenuPoint | null): Promise<HcmMapMenu> {
        const element = await mountElement<HcmMapMenu>(HCM_MAP_MENU_TAG, { point, view: VIEW, locale: 'en' });
        element.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
        element.point = point === null ? null : { ...point };
        await element.updateComplete;
        return element;
    }

    it('happyPath_itsItemsLinkToStreetViewAndCopyThePlace', async () => {
        const element = await menu({ x: 200, y: 150 });
        const events = recordEvents(element, 'hcm-map-menu-copy', 'hcm-close');

        const link = shadowQuery(element, '[data-item="street-view"]') as HTMLAnchorElement;
        expect(shadowQuery(element, '[role="menu"]').getAttribute('aria-label')).toBe('Map menu');
        expect(link.href).toContain('map_action=pano&viewpoint=44.43,26.1');
        expect([link.target, link.rel]).toEqual(['_blank', 'noopener noreferrer']);
        expect(element.shadowRoot?.activeElement).toBe(link);
        shadowQuery(element, '[data-item="copy"]').click();

        expect(events).toEqual([
            { type: 'hcm-map-menu-copy', detail: { text: '44.430000, 26.100000' } },
            { type: 'hcm-close', detail: null },
        ]);
        expect(MAP_MENU_ITEMS.map((item) => item.id)).toEqual(['street-view', 'copy', 'share']);
    });

    it('happyPath_shareALinkToThisViewAsksTheViewerAndCloses', async () => {
        const element = await menu({ x: 200, y: 150 });
        const events = recordEvents(element, 'hcm-map-menu-share', 'hcm-map-menu-copy', 'hcm-close');
        const share = shadowQuery(element, '[data-item="share"]');

        share.click();

        expect([share.localName, share.textContent.trim()]).toEqual(['button', 'Share a link to this view']);
        expect(events).toEqual([
            { type: 'hcm-map-menu-share', detail: null },
            { type: 'hcm-close', detail: null },
        ]);
    });

    it('badPath_escAndAPressOutsideClose', async () => {
        const element = await menu({ x: 390, y: 290 });
        const events = recordEvents(element, 'hcm-close');
        const items = shadowQueryAll(element, '.item');
        const key = (name: string): void => {
            shadowQuery(element, '[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true }));
        };

        key('ArrowDown');
        expect(element.shadowRoot?.activeElement).toBe(items[1]);
        key('End');
        key('Home');
        key('ArrowUp');
        expect(element.shadowRoot?.activeElement).toBe(items[2]);
        key('x');
        key('Escape');
        items[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        const box = shadowQuery(element, '.menu').getBoundingClientRect();

        expect(events).toHaveLength(2);
        expect(box.right).toBeLessThanOrEqual(400);
        expect(box.bottom).toBeLessThanOrEqual(300);
    });

    it('happyPath_closedTheFocusGoesBackToWhatHadIt', async () => {
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        const element = await menu(null);
        element.point = { x: 10, y: 10 };
        await element.updateComplete;
        expect(element.shadowRoot?.activeElement?.getAttribute('data-item')).toBe('street-view');
        element.point = { x: 40, y: 40 };
        await element.updateComplete;

        element.point = null;
        await element.updateComplete;

        expect(document.activeElement).toBe(opener);
    });

    it('badPath_closedByAPressOnAnotherControlTheFocusStaysThere', async () => {
        const [opener, other] = [document.createElement('button'), document.createElement('button')];
        document.body.append(opener, other);
        opener.focus();
        const element = await menu(null);
        element.point = { x: 10, y: 10 };
        await element.updateComplete;
        other.focus();

        element.point = null;
        await element.updateComplete;

        expect(document.activeElement).toBe(other);
    });

    it('badPath_closedItRendersNothingAndAPressOutsideDoesNothing', async () => {
        const element = await menu({ x: 10, y: 10 });
        element.point = null;
        await element.updateComplete;
        const events = recordEvents(element, 'hcm-close');
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        element.remove();

        expect(shadowQueryAll(element, '[role="menu"]')).toEqual([]);
        expect(events).toEqual([]);
    });
});
