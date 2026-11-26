import type { CDPSession, Locator, Page } from '@playwright/test';

import { E2E_TILESET_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, opacitySlider } from '../../support/viewer.js';

/**
 * An opacity slider under a finger (behaviour V22; the Pixel Tablet, 2026-11-12: a swipe meant to scroll the Layers panel
 * set a layer to 4 %). The slider leaves an upward or downward swipe to the browser (`touch-action: pan-y`) and moves
 * the value only once the finger has gone 8 px more sideways than up or down (packages/ui/src/components/slider.ts).
 * The fingers are Chromium's own touch events (CDP `Input.dispatchTouchEvent`), so the browser decides about the scroll
 * as it does on a device.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';
const EMPTY_VIEW = '15/44.37000/25.97000';

interface Point {
    readonly x: number;
    readonly y: number;
}

/** The slider element's box (the handle is inside its shadow root). */
async function sliderBox(
    handle: Locator,
): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
    return handle.evaluate((element) => {
        const rect = ((element.getRootNode() as ShadowRoot).host as HTMLElement).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
}

/** A finger from `from` to `to` in `steps` moves, then lifted. */
async function swipe(cdp: CDPSession, from: Point, to: Point, steps: number): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= steps; step += 1) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const y = from.y + ((to.y - from.y) * step) / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function fingers(page: Page): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    return cdp;
}

async function openSlider(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
    const slider = opacitySlider(page, lang, LAYER_LABEL);
    await openLayers(page, lang);
    await slider.scrollIntoViewIfNeeded();
    return slider;
}

test('A finger dragged sideways along an opacity slider moves its value', { tag: '@S-V22-HAPPY-TOUCH-DRAG' }, async ({ page, lang }) => {
    const slider = await openSlider(page, lang);
    const cdp = await fingers(page);
    const box = await sliderBox(slider);
    const y = box.y + box.height / 2;
    // From the 100 % end to 30 %: the handle's centre travels the track minus its 16 px (slider.ts HANDLE_SPAN_PX).
    await swipe(cdp, { x: box.x + box.width - 8, y }, { x: box.x + 8 + 0.3 * (box.width - 16), y }, 8);

    await expect(slider).toHaveAttribute('aria-valuenow', '30');
});

test(
    'A finger swiping up or down across an opacity slider leaves its value alone',
    { tag: '@S-V22-BAD-TOUCH-VERTICAL-SWIPE' },
    async ({ page, lang }) => {
        const slider = await openSlider(page, lang);
        const before = await slider.getAttribute('aria-valuenow');
        const cdp = await fingers(page);
        const box = await sliderBox(slider);
        // Down the left third of the track, slightly slanted as a thumb swipes: the scroll the device test meant.
        const x = box.x + box.width / 3;
        await swipe(cdp, { x, y: box.y + box.height / 2 }, { x: x + 6, y: box.y + box.height / 2 + 120 }, 8);
        await swipe(cdp, { x, y: box.y + box.height / 2 }, { x: x - 6, y: box.y + box.height / 2 - 120 }, 8);

        await expect(slider).toHaveAttribute('aria-valuenow', before ?? '');
        await expect(slider).not.toBeFocused();
    },
);
