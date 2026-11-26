import { join } from 'node:path';
import process from 'node:process';

import type { Locator, Page } from '@playwright/test';

/**
 * Review screenshots of the admin (docs/TESTING.md → *Review screenshots*): when `HCM_SCREENSHOTS` names a folder
 * (relative to the repository root, e.g. `reports/screenshots/m2b`), `capture(page, name)` saves the page as it is at
 * the four review window sizes, light and dark, as `<name>-<width>x<height>-<scheme>.png`, then puts the page back to
 * its own size and scheme; unset, it does nothing. The state is the one the spec reached, so a capture never drives the
 * app. Only the viewport and the colour scheme change: a phone's touch and pixel ratio stay the project's.
 */

const SIZES = [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
] as const;

const SCHEMES = ['light', 'dark'] as const;

/** The folder of the review screenshots, or null when none is asked for. */
function captureDir(): string | null {
    const dir = process.env['HCM_SCREENSHOTS'] ?? '';
    return dir === '' ? null : join(import.meta.dirname, '../../..', dir);
}

/** Two animation frames: the window class and the layout have followed the new size. */
function settled(page: Page): Promise<void> {
    return page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve();
                    });
                });
            }),
    );
}

export async function capture(page: Page, name: string): Promise<void> {
    const dir = captureDir();
    if (dir === null) {
        return;
    }
    const own = page.viewportSize();
    for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const colorScheme of SCHEMES) {
            await page.emulateMedia({ colorScheme });
            await settled(page);
            await page.screenshot({
                path: join(dir, `${name}-${String(size.width)}x${String(size.height)}-${colorScheme}.png`),
                animations: 'disabled',
                caret: 'hide',
            });
        }
    }
    await page.emulateMedia({ colorScheme: null });
    if (own !== null) {
        await page.setViewportSize(own);
    }
    await settled(page);
}

/**
 * One part of the page (a card, a section) whole, however tall, at a phone's and a desktop's width, light and dark:
 * `<name>-<width>-<scheme>.png`; for a part below the first screen, which `capture` (the window as it is) does not reach.
 * Unset `HCM_SCREENSHOTS`, it does nothing.
 */
export async function captureElement(page: Page, part: Locator, name: string): Promise<void> {
    const dir = captureDir();
    if (dir === null) {
        return;
    }
    const own = page.viewportSize();
    for (const size of [SIZES[0], SIZES[2]]) {
        await page.setViewportSize(size);
        for (const colorScheme of SCHEMES) {
            await page.emulateMedia({ colorScheme });
            await settled(page);
            await part.screenshot({
                path: join(dir, `${name}-${String(size.width)}-${colorScheme}.png`),
                animations: 'disabled',
                caret: 'hide',
            });
        }
    }
    await page.emulateMedia({ colorScheme: null });
    if (own !== null) {
        await page.setViewportSize(own);
    }
    await settled(page);
}
