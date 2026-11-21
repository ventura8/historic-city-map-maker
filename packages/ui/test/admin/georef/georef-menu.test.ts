import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { chooseItem, defineHcmGeorefMenu, type HcmGeorefMenu } from '../../../src/admin/georef/georef-menu.js';
import { LONG_PRESS_MS, menuAt } from '../../../src/admin/georef/georef-menu-host.js';
import type { HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { fitView, scanToPane } from '../../../src/admin/georef/scan-view.js';
import { defineImagery, georefPage, georefState, georefVersion } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll, mount, updated } from '../shell/fake-app.js';

/** The georeferencer's context menu (S-A16-HAPPY-GEOREF-MENU, S-A16-BAD-GEOREF-MENU-READONLY). */

const MAP_TARGET = { geo: { lat: 44.42, lng: 26.12 }, hit: 'g2' };

type Page = Awaited<ReturnType<typeof georefPage>>;

/** The georeferencer, once the menu's chunk is in and its gestures listen. */
async function menuPage(...args: Parameters<typeof georefPage>): Promise<Page> {
    const page = await georefPage(...args);
    await import('../../../src/admin/georef/georef-menu.js');
    await updated(page.element);
    return page;
}

function calls(page: Page): readonly string[] {
    return page.area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && !call.startsWith('setMapFocus'));
}

function viewerOf(page: Page): HcmScanViewer {
    return deep(page.element, 'hcm-scan-viewer') as HcmScanViewer;
}

function canvasOf(page: Page): HTMLCanvasElement {
    const canvas = viewerOf(page).renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    canvas.setPointerCapture = () => undefined;
    return canvas;
}

function mapCanvasOf(page: Page): HTMLElement {
    return deep(deep(page.element, 'hcm-admin-map'), '.canvas');
}

/** Where scan pixel `pixel` is drawn on the page (the scan shown whole). */
function scanPoint(page: Page, pixel: { x: number; y: number }): { x: number; y: number } {
    const viewer = viewerOf(page);
    const box = viewer.getBoundingClientRect();
    const view = fitView({ width: viewer.clientWidth, height: viewer.clientHeight }, { width: 1000, height: 500 });
    const at = scanToPane(view, pixel, 0.5);
    return { x: box.left + at.x, y: box.top + at.y };
}

function rightClick(target: Element, at: { x: number; y: number }): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: at.x, clientY: at.y });
    target.dispatchEvent(event);
    return event;
}

function touch(target: Element, type: string, at: { x: number; y: number }, extra: PointerEventInit = {}): void {
    const init = { bubbles: true, composed: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 7 };
    target.dispatchEvent(new PointerEvent(type, { ...init, clientX: at.x, clientY: at.y, ...extra }));
}

/** The open menu, once its chunk is in. */
async function openMenu(page: Page): Promise<HcmGeorefMenu> {
    await customElements.whenDefined('hcm-georef-menu');
    await updated(page.element);
    const menu = deep(page.element, 'hcm-georef-menu') as HcmGeorefMenu;
    await menu.updateComplete;
    return menu;
}

function menuRoot(menu: HcmGeorefMenu): HTMLElement {
    const root = menu.renderRoot.querySelector<HTMLElement>('[role="menu"]');
    if (root === null) {
        throw new Error('no menu');
    }
    return root;
}

function items(menu: HcmGeorefMenu): HTMLButtonElement[] {
    return [...menu.renderRoot.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

function labels(menu: HcmGeorefMenu): string[] {
    return items(menu).map((item) => item.textContent.trim());
}

function menuShown(page: Page): boolean {
    return deepAll(page.element, 'hcm-georef-menu').length > 0;
}

function key(target: Element, name: string, extra: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
    return event;
}

describe('the georeferencer context menu', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aRightClickOnTheScanOffersAddThereAndAddsExactlyThere @S-A16-HAPPY-GEOREF-MENU', async () => {
        const page = await menuPage(georefState({ canUndo: true }));
        const canvas = canvasOf(page);
        canvas.focus();

        const event = rightClick(canvas, scanPoint(page, { x: 600, y: 400 }));
        const menu = await openMenu(page);
        const first = items(menu)[0];

        expect(event.defaultPrevented).toBe(true);
        expect(labels(menu)).toEqual(['Add a point here', 'Undo']);
        expect(menuRoot(menu).getAttribute('aria-label')).toBe('Point actions');
        expect(menu.shadowRoot?.activeElement).toBe(first);
        expect(await axeViolations(page.element)).toEqual([]);
        first?.click();
        await updated(page.element);
        const [made = ''] = calls(page);
        const added = JSON.parse(made.replace(/^addAt /, '')) as { pixel: { x: number; y: number } };
        expect(made.startsWith('addAt ')).toBe(true);
        expect([added.pixel.x, added.pixel.y].map((value) => Math.round(value / 10))).toEqual([60, 40]);
        expect(menuShown(page)).toBe(false);
        expect(viewerOf(page).shadowRoot?.activeElement).toBe(canvas);
    });

    it('happyPath_onAPointTheMenuMovesOrDeletesItAndUndoes', async () => {
        const page = await menuPage(georefState({ canUndo: true }));
        const canvas = canvasOf(page);
        const chosen: string[] = [];
        for (const index of [1, 2, 3]) {
            rightClick(canvas, scanPoint(page, { x: 1000, y: 900 }));
            const menu = await openMenu(page);
            chosen.push(labels(menu).join('|'));
            items(menu)[index]?.click();
            await updated(page.element);
        }

        expect(chosen[0]).toBe('Add a point here|Move this point|Delete this point|Undo');
        expect(calls(page)).toEqual(['pickUp "g3" "scan"', 'remove "g3"', 'undo']);
    });

    it('happyPath_onTheMapThePlaceAndThePairComeFromTheStore', async () => {
        const page = await menuPage(georefState({ map: 'ready' }), {}, { mapTarget: MAP_TARGET });
        const map = mapCanvasOf(page);
        const box = deep(page.element, 'hcm-admin-map').getBoundingClientRect();

        rightClick(map, { x: box.left + 30, y: box.top + 40 });
        const menu = await openMenu(page);
        const offered = labels(menu);
        items(menu)[0]?.click();
        rightClick(map, { x: box.left + 30, y: box.top + 40 });
        items(await openMenu(page))[1]?.click();

        expect(offered).toEqual(['Add a point here', 'Move this point', 'Delete this point']);
        expect(calls(page)).toEqual([
            'mapTarget {"x":30,"y":40}',
            'addAt {"geo":{"lat":44.42,"lng":26.12}}',
            'mapTarget {"x":30,"y":40}',
            'pickUp "g2" "map"',
        ]);
    });
});

describe('the georeferencer context menu: touch', () => {
    beforeAll(defineImagery);
    afterEach(() => {
        vi.useRealTimers();
        cleanup();
    });

    it('happyPath_aTouchHeldStillOpensItAndIsNoClick', async () => {
        const page = await menuPage(georefState({ adding: true }));
        const canvas = canvasOf(page);
        const at = scanPoint(page, { x: 600, y: 400 });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        touch(canvas, 'pointerdown', at);
        touch(canvas, 'pointermove', { x: at.x + 3, y: at.y });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        touch(canvas, 'pointerup', at);
        const click = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
        canvas.dispatchEvent(click);
        const swallowed = click.defaultPrevented;
        const native = rightClick(canvas, at);
        vi.useRealTimers();
        const menu = await openMenu(page);

        expect([swallowed, native.defaultPrevented]).toEqual([true, true]);
        expect(labels(menu)).toEqual(['Add a point here']);
        expect(calls(page)).toEqual([]);
    });

    it('badPath_aTouchThatDriftsOrEndsEarlyOrAMouseOpensNothing', async () => {
        const page = await menuPage();
        const canvas = canvasOf(page);
        const at = scanPoint(page, { x: 600, y: 400 });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        touch(canvas, 'pointerdown', at);
        touch(canvas, 'pointermove', { x: at.x + 30, y: at.y });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        touch(canvas, 'pointerup', at);
        touch(canvas, 'pointerdown', at);
        touch(canvas, 'pointerup', at);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        touch(canvas, 'pointerdown', at, { pointerType: 'mouse', pointerId: 1 });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        touch(deep(page.element, 'h2'), 'pointerdown', at);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        rightClick(deep(page.element, 'h2'), at);
        await updated(page.element);

        expect(menuShown(page)).toBe(false);
    });

    it('happyPath_aTouchsOwnContextMenuBeforeTheTimerIsTheLongPress', async () => {
        const page = await menuPage();
        const canvas = canvasOf(page);
        const at = scanPoint(page, { x: 600, y: 400 });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        touch(canvas, 'pointerdown', at);
        rightClick(canvas, at);
        vi.useRealTimers();
        const menu = await openMenu(page);

        expect(labels(menu)).toEqual(['Add a point here']);
    });
});

describe('the georeferencer context menu: the keyboard, closing and read-only', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theKeyboardOpensItAtThePaneCentreWalksItAndEscGivesTheFocusBack', async () => {
        const page = await menuPage(georefState({ canUndo: true, map: 'ready' }), {}, { mapTarget: null });
        const canvas = canvasOf(page);
        canvas.focus();

        const opened = key(canvas, 'ContextMenu');
        const menu = await openMenu(page);
        const root = menuRoot(menu);
        const focused = (): string => (menu.shadowRoot?.activeElement as HTMLElement | null)?.textContent.trim() ?? '';
        key(root, 'ArrowDown');
        const down = focused();
        key(root, 'ArrowDown');
        const wrapped = focused();
        key(root, 'End');
        const end = focused();
        key(root, 'Home');
        const home = focused();
        key(root, 'ArrowUp');
        const up = focused();
        key(root, 'x');
        const escape = key(root, 'Escape');
        await updated(page.element);

        expect(opened.defaultPrevented).toBe(true);
        expect([down, wrapped, end, home, up]).toEqual(['Undo', 'Add a point here', 'Undo', 'Add a point here', 'Undo']);
        expect([escape.defaultPrevented, menuShown(page)]).toEqual([true, false]);
        expect(calls(page)).toEqual([]);
        expect(viewerOf(page).shadowRoot?.activeElement).toBe(canvas);

        // Shift+F10 on the map: its centre; the store has no map there and Undo is all it offers.
        mapCanvasOf(page).focus();
        key(mapCanvasOf(page), 'F10', { shiftKey: true });
        const onMap = await openMenu(page);
        expect(labels(onMap)).toEqual(['Undo']);
        key(menuRoot(onMap), 'Tab');
        await updated(page.element);
        expect(menuShown(page)).toBe(false);
        expect(calls(page)[0]).toMatch(/^mapTarget \{"x":[\d.]+,"y":[\d.]+\}$/);
    });

    it('badPath_aMapWithNothingToOfferOpensNoMenuAndOtherKeysNothing', async () => {
        const page = await menuPage(georefState({ map: 'ready' }), {}, { mapTarget: null });

        key(mapCanvasOf(page), 'F10');
        key(mapCanvasOf(page), 'ContextMenu');
        rightClick(mapCanvasOf(page), { x: 10, y: 10 });
        await updated(page.element);

        expect(menuShown(page)).toBe(false);
    });

    it('happyPath_aPressOutsideOrTheFocusLeavingClosesIt', async () => {
        const page = await menuPage();
        const canvas = canvasOf(page);
        rightClick(canvas, scanPoint(page, { x: 600, y: 400 }));
        const menu = await openMenu(page);

        items(menu)[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        const stillOpen = menuShown(page);
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        await updated(page.element);
        const afterOutside = menuShown(page);
        rightClick(canvas, scanPoint(page, { x: 600, y: 400 }));
        const again = await openMenu(page);
        const root = menuRoot(again);
        root.dispatchEvent(new FocusEvent('focusout', { relatedTarget: items(again)[0] ?? null }));
        const inside = menuShown(page);
        root.dispatchEvent(new FocusEvent('focusout', { relatedTarget: canvas }));
        await updated(page.element);

        expect([stillOpen, afterOutside, inside, menuShown(page)]).toEqual([true, false, true, false]);
        expect(calls(page)).toEqual([]);
    });

    it('badPath_aReadOnlyVersionsMenuOffersNothingThatEdits @S-A16-BAD-GEOREF-MENU-READONLY', async () => {
        const page = await menuPage(georefState({ canUndo: true, version: georefVersion({ editable: false, state: 'rejected' }) }));
        const canvas = canvasOf(page);

        rightClick(canvas, scanPoint(page, { x: 1000, y: 900 }));
        const menu = await openMenu(page);
        const [only] = items(menu);
        only?.click();
        await updated(page.element);

        expect(labels(menu)).toEqual(['This version takes no points: nothing to change here']);
        expect(only?.getAttribute('aria-disabled')).toBe('true');
        expect(menuShown(page)).toBe(true);
        expect(calls(page)).toEqual([]);
        expect(await axeViolations(page.element)).toEqual([]);
    });

    it('badPath_aMenuChunkThatDoesNotLoadIsLoggedAndTheBrowsersMenuStays', async () => {
        const prototype = customElements.get('hcm-georef-page')?.prototype as { menuChunk: () => Promise<unknown> };
        const chunk = vi.spyOn(prototype, 'menuChunk').mockRejectedValue(new Error('chunk 404'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const page = await georefPage(georefState());
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalled();
        });

        const event = rightClick(canvasOf(page), scanPoint(page, { x: 600, y: 400 }));
        const logged = warn.mock.calls[0];
        chunk.mockRestore();
        warn.mockRestore();

        expect(logged).toEqual(['[georef-page] the context menu did not load', { error: 'Error: chunk 404' }]);
        expect([event.defaultPrevented, menuShown(page)]).toEqual([false, false]);
    });

    it('happyPath_aPickedUpPointSaysWhereToClickAndTheScanPicks', async () => {
        const page = await menuPage(georefState({ moving: { id: 'g2', pane: 'map' } }));

        expect(deep(page.element, '[data-state="moving"]').textContent).toContain('Moving point 2: click its new place on the map.');
        expect(viewerOf(page).adding).toBe(true);
    });
});

describe('<hcm-georef-menu>', () => {
    beforeAll(() => {
        defineHcmGeorefMenu();
    });
    afterEach(cleanup);

    it('badPath_keptInsideTheWindowNearItsEdge', async () => {
        const menu = await mount<HcmGeorefMenu>(
            html`<hcm-georef-menu .menu=${{ pane: 'map', at: { x: innerWidth + 50, y: -20 }, end: null, hit: 'g1' }}></hcm-georef-menu>`,
        );
        await menu.updateComplete;
        const box = menuRoot(menu).getBoundingClientRect();

        expect(box.right).toBeLessThanOrEqual(innerWidth - 8);
        expect(box.top).toBe(8);
    });

    it('badPath_anUnknownChoiceOrAnAddWithoutAPlaceDoesNothing', () => {
        const heard: string[] = [];
        const intents = new Proxy({}, { get: (_target, name) => () => heard.push(String(name)) }) as never;

        chooseItem('none', { pane: 'map', at: { x: 0, y: 0 }, end: null, hit: null }, intents);
        chooseItem('add', { pane: 'map', at: { x: 0, y: 0 }, end: null, hit: null }, intents);
        chooseItem('move', { pane: 'map', at: { x: 0, y: 0 }, end: null, hit: null }, null);
        const bare = document.createElement('div');

        expect(heard).toEqual([]);
        expect(menuAt(bare, { x: 0, y: 0 }, intents, true)).toBeNull();
    });
});
