import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { connectPad, countPadReads, disconnectPad, installFakePads, nextFrames, padReads, pressButton } from '../../support/gamepad.js';
import { focused, type FocusInfo } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { currentHash, menuButton, openViewer, t, viewer } from '../../support/viewer.js';

/**
 * Games consoles and the 10-foot view (behaviours V65 and V66, docs/research/viewer-input.md §6): spatial navigation with
 * the D-pad, the arrow keys and the Xbox's key emulation, a pad's loop that ends with the pad, and a TV's window (1920 ×
 * 1080, a coarse pointer: Playwright's touch emulation) with a focus ring read from across the room. No console was
 * available: a fake Gamepad API (e2e/support/gamepad.ts) and Chromium stand in for them.
 */

const AT_1966 = '15/44.42700/26.08530&layers=e2e-1966';
const TV = { viewport: { width: 1920, height: 1080 }, hasTouch: true } as const;
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;

function timeline(page: Page, lang: Locale): ReturnType<Page['getByRole']> {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

/** Presses D-pad down until the timeline has the focus, at most `tries` times; the controls passed on the way. */
async function dpadDownToTimeline(page: Page, lang: Locale, tries = 8): Promise<readonly FocusInfo[]> {
    const passed: FocusInfo[] = [];
    const name = t(lang, 'timeline.label');
    for (let press = 0; press < tries; press += 1) {
        await pressButton(page, DPAD.down);
        const now = await focused(page);
        if (now !== null) {
            passed.push(now);
        }
        if (now?.role === 'slider' && now.name === name) {
            return passed;
        }
    }
    return passed;
}

async function outlineWidth(page: Page): Promise<number> {
    return page.evaluate(() => {
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
        }
        return active === null ? 0 : Number.parseFloat(getComputedStyle(active).outlineWidth);
    });
}

test.describe('Spatial navigation (V65)', () => {
    test.use(TV);

    test(
        'The D-pad goes round the controls, reaches the timeline and steps its year at once',
        { tag: '@S-V65-HAPPY-DPAD-ROUND' },
        async ({ page, lang }) => {
            await installFakePads(page);
            await openViewer(page, { lang, hash: AT_1966 });
            await connectPad(page);

            const passed = await dpadDownToTimeline(page, lang);
            expect(passed.at(-1)?.role, 'the D-pad reached the timeline').toBe('slider');
            expect(passed.every((control) => control.outlined)).toBe(true);

            const year = await timeline(page, lang).getAttribute('aria-valuetext');
            await pressButton(page, DPAD.right);
            await expect(timeline(page, lang)).not.toHaveAttribute('aria-valuetext', year ?? '');
            await pressButton(page, DPAD.left);
            await expect(timeline(page, lang)).toHaveAttribute('aria-valuetext', year ?? '');

            await pressButton(page, DPAD.up);
            await expect.poll(async () => (await focused(page))?.role).not.toBe('slider');
            await expect.poll(async () => (await focused(page))?.outlined).toBe(true);
        },
    );

    test('The arrow keys move the focus the way they point', { tag: '@S-V65-HAPPY-ARROWS' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: AT_1966 });
        await menuButton(page, lang).focus();
        const start = await focused(page);

        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => (await focused(page))?.name).not.toBe(start?.name);
        await expect.poll(async () => (await focused(page))?.ringVisible).toBe(true);
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => (await focused(page))?.name).toBe(start?.name);
    });

    test('On the map the arrows still pan it and the focus stays', { tag: '@S-V65-BAD-MAP-KEEPS-ARROWS' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: AT_1966 });
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');
        await canvas.focus();
        const before = await currentHash(page);

        await page.keyboard.press('ArrowRight');

        await expect.poll(() => currentHash(page)).not.toBe(before);
        expect((await focused(page))?.tag).toBe('canvas');
    });

    test("The Xbox's key emulation is asked for and its keys act", { tag: '@S-V65-HAPPY-XBOX-KEYS' }, async ({ page, lang }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'gamepadInputEmulation', { value: 'mouse', writable: true, configurable: true });
        });
        await openViewer(page, { lang, hash: AT_1966 });
        expect(await page.evaluate(() => (navigator as unknown as { gamepadInputEmulation: string }).gamepadInputEmulation)).toBe(
            'keyboard',
        );
        const key = async (name: string): Promise<void> => {
            await page.evaluate((pressed) => {
                let target: Element = document.activeElement ?? document.body;
                while (target.shadowRoot?.activeElement) {
                    target = target.shadowRoot.activeElement;
                }
                target.dispatchEvent(new KeyboardEvent('keydown', { key: pressed, bubbles: true, composed: true, cancelable: true }));
            }, name);
        };

        await key('GamepadDPadDown');
        await expect.poll(async () => (await focused(page))?.host).not.toBe('');
        await key('GamepadView');
        await expect(page.getByRole('dialog', { name: t(lang, 'input.help') })).toBeVisible();
        await key('GamepadB');
        await expect(page.getByRole('dialog', { name: t(lang, 'input.help') })).toBeHidden();
    });

    test('A pad that leaves ends the loop: nothing reads the pads any more', { tag: '@S-V65-BAD-DISCONNECT' }, async ({ page, lang }) => {
        await installFakePads(page);
        await countPadReads(page);
        await openViewer(page, { lang, hash: AT_1966 });
        await connectPad(page);
        await nextFrames(page);
        const polling = await padReads(page);
        await nextFrames(page);
        expect(await padReads(page), 'the loop reads the pad every frame').toBeGreaterThan(polling);

        await disconnectPad(page);
        await nextFrames(page);
        const stopped = await padReads(page);
        await nextFrames(page);
        await nextFrames(page);

        expect(await padReads(page)).toBe(stopped);
    });
});

test.describe('The 10-foot view (V66)', () => {
    test.describe('on a TV', () => {
        test.use(TV);

        test(
            'A ring twice as thick and 48 px buttons, read from across the room',
            { tag: '@S-V66-HAPPY-TV-RING' },
            async ({ page, lang }) => {
                await openViewer(page, { lang, hash: AT_1966 });
                expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(false);
                await menuButton(page, lang).focus();
                await page.keyboard.press('ArrowUp');

                await expect.poll(() => outlineWidth(page)).toBe(6);
                // Its buttons are 48 px to the eye, and its text a quarter larger.
                const zoomIn = await page.getByRole('button', { name: t(lang, 'viewer.zoomIn'), exact: true }).boundingBox();
                expect(zoomIn?.height).toBe(48);
            },
        );
    });

    test.describe('with a mouse', () => {
        test.use({ viewport: TV.viewport, hasTouch: false });

        test('A large screen with a mouse keeps the desk ring', { tag: '@S-V66-BAD-FINE-POINTER' }, async ({ page, lang }) => {
            await openViewer(page, { lang, hash: AT_1966 });
            await menuButton(page, lang).focus();
            await page.keyboard.press('ArrowUp');

            await expect.poll(() => outlineWidth(page)).toBe(3);
            const zoomIn = await page.getByRole('button', { name: t(lang, 'viewer.zoomIn'), exact: true }).boundingBox();
            expect(zoomIn?.height).toBe(40);
        });
    });
});
