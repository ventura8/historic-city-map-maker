/**
 * The FAB menu of a landscape phone with the real kit (the Pixel 9 Pro review, P1): at 884 x 322, less Chrome's bars,
 * its seven items lay in one row and ran 263 px off the screen. Every item now lies inside the viewer, in rows that
 * stack upwards from the FAB, while the lying card and the chip step aside; a window too short even for that scrolls
 * the menu and the arrow keys bring the focused item into view.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { FakeStore, readyState } from './fake-store.js';
import { fakeServices, setBox, type Box } from './viewer-harness.js';

/** The Pixel 9 Pro held landscape with Chrome's address bar: 884 x 322 less the bars. */
const PIXEL_LANDSCAPE: Box = { width: 884, height: 290 };
/** The smallest landscape phone with its bars: 568 x 320 less 50 px. */
const SMALL_LANDSCAPE: Box = { width: 568, height: 270 };

async function openMenu(box: Box): Promise<{ element: HcmMapViewer; items: HTMLElement[] }> {
    const element = document.createElement('hcm-map-viewer');
    element.services = fakeServices();
    setBox(element, box);
    element.attach(new FakeStore({ ...readyState(undefined, { year: 1977 }), compactHeight: true }), null);
    document.body.append(element);
    await element.updateComplete;
    await page.getByRole('button', { name: 'Meniu' }).click();
    await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();
    const menu = element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot;
    return { element, items: [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])] };
}

function inside(item: Element, frame: DOMRect): boolean {
    const box = item.getBoundingClientRect();
    return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
}

describe('<hcm-map-viewer> the FAB menu of a landscape phone', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1280, 900);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_atThePixelsSizeEveryItemFitsInRowsAboveTheFabAndTheCardStepsAside', async () => {
        const { element, items } = await openMenu(PIXEL_LANDSCAPE);
        const frame = element.getBoundingClientRect();
        const fab = element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector('.fab')?.getBoundingClientRect();
        const rows = new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)));

        expect(items.length).toBeGreaterThan(5);
        expect(items.filter((item) => !inside(item, frame))).toEqual([]);
        expect(items.every((item) => item.getBoundingClientRect().bottom <= (fab?.top ?? 0))).toBe(true);
        expect(rows.size).toBeLessThan(items.length);
        expect(getComputedStyle(element.shadowRoot?.querySelector('.dock.timeline') ?? element).visibility).toBe('hidden');
        expect(items.every((item) => item.getBoundingClientRect().height >= 48)).toBe(true);
    });

    it('badPath_onTheSmallestLandscapePhoneTheMenuScrollsAndTheArrowsReachItsLastItem', async () => {
        const { element, items } = await openMenu(SMALL_LANDSCAPE);
        const frame = element.getBoundingClientRect();
        const menu = element.shadowRoot?.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector('[role="menu"]');

        expect(menu === null || menu === undefined ? false : inside(menu, frame)).toBe(true);
        expect(items.every((item) => item.getBoundingClientRect().right <= frame.right)).toBe(true);
        await userEvent.keyboard('{End}');
        const last = items.at(-1);
        const visible = menu?.getBoundingClientRect();
        const box = last?.getBoundingClientRect();
        expect((box?.top ?? -1) >= (visible?.top ?? 0) - 1 && (box?.bottom ?? 0) <= (visible?.bottom ?? -1) + 1).toBe(true);
    });
});
