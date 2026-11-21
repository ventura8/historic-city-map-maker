import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import type { ViewerLocale } from '@hcm/shared';
import { test, type Page } from '@playwright/test';

import { settleAnimations } from './layout.js';

/**
 * The visual audit's screenshots of every checked state (docs/TESTING.md → *Review screenshots*): with
 * `HCM_STATE_SCREENSHOTS=<folder>` (relative to the repository root; `reports/` is git-ignored), `expectStateSound`
 * saves each state, before its checks run, as `<folder>/<state id>/<width>x<height>-<scheme>-<lang>.png` at the project's
 * own viewport and colour scheme. `HCM_STATE_SCREENSHOT_SIZES` (`360x800,915x412`) and `HCM_STATE_SCREENSHOT_SCHEMES`
 * (`light,dark`) take those sizes and schemes instead, by resizing the page where the spec left it (the admin, whose
 * projects are three sizes in light), then put the page back. Unset, nothing is saved. A screenshot is evidence for a
 * person to look at: what the checkers cannot see (a control that moves, a colour that is wrong but contrasted) is
 * found there, and each finding then gets a check of its own.
 */

interface Size {
    readonly width: number;
    readonly height: number;
}

type Scheme = 'light' | 'dark';

/** The folder of the state screenshots, or null when none is asked for. */
function shotsDir(): string | null {
    const dir = process.env['HCM_STATE_SCREENSHOTS'] ?? '';
    return dir === '' ? null : join(import.meta.dirname, '../..', dir);
}

/** `HCM_STATE_SCREENSHOT_SIZES` as sizes (`<width>x<height>`, comma-separated), or the page's own size. */
function sizesOf(own: Size): Size[] {
    const listed = (process.env['HCM_STATE_SCREENSHOT_SIZES'] ?? '').split(',').filter((entry) => entry !== '');
    const sizes = listed.map((entry) => {
        const match = /^(\d+)x(\d+)$/.exec(entry.trim());
        if (match === null) {
            throw new Error(`HCM_STATE_SCREENSHOT_SIZES: "${entry}" is not <width>x<height>`);
        }
        return { width: Number(match[1]), height: Number(match[2]) };
    });
    return sizes.length > 0 ? sizes : [own];
}

/** `HCM_STATE_SCREENSHOT_SCHEMES` as colour schemes, or the project's own. */
function schemesOf(own: Scheme): Scheme[] {
    const listed = (process.env['HCM_STATE_SCREENSHOT_SCHEMES'] ?? '').split(',').filter((entry) => entry !== '');
    return listed.length > 0 ? listed.map((entry) => (entry === 'dark' ? 'dark' : 'light')) : [own];
}

/** Saves the state `id` the page is in (see the module comment); does nothing without `HCM_STATE_SCREENSHOTS`. */
export async function saveStateShots(page: Page, id: string, lang: ViewerLocale): Promise<void> {
    const dir = shotsDir();
    if (dir === null) {
        return;
    }
    const own = page.viewportSize() ?? { width: 0, height: 0 };
    const ownScheme: Scheme = test.info().project.use.colorScheme === 'dark' ? 'dark' : 'light';
    const sizes = sizesOf(own);
    const schemes = schemesOf(ownScheme);
    await mkdir(join(dir, id), { recursive: true });
    for (const size of sizes) {
        await page.setViewportSize(size);
        for (const scheme of schemes) {
            await page.emulateMedia({ colorScheme: scheme });
            await settleAnimations(page);
            const file = `${String(size.width)}x${String(size.height)}-${scheme}-${lang}.png`;
            await page.screenshot({ path: join(dir, id, file), animations: 'disabled', caret: 'hide' });
        }
    }
    await page.emulateMedia({ colorScheme: ownScheme });
    await page.setViewportSize(own);
    await settleAnimations(page);
}
