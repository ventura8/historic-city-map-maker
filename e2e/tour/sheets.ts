import type { Locale } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { t, viewer } from '../support/viewer.js';

/** The tour's sheets (e2e/tour/states.ts): which windows have bottom sheets, the open one, its heights; a dialog scrolled down. */

/** A phone held upright: sheets are bottom sheets with three heights (peek, half, full). */
export function hasBottomSheets(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && size.width < 600 && size.height >= 480;
}

/** The open sheet (one at a time) and its box. */
function openSheet(page: Page): { sheet: Locator; box: Locator } {
    const sheet = viewer(page).locator('hcm-sheet[open]');
    return { sheet, box: sheet.locator('section.sheet') };
}

/** Moves the open bottom sheet to `detent` with its handle's arrow keys (one step per press), then waits for it to settle. */
export async function toDetent(page: Page, lang: Locale, detent: 'peek' | 'half' | 'full'): Promise<void> {
    const { sheet, box } = openSheet(page);
    const order = ['peek', 'half', 'full'];
    const now = order.indexOf((await sheet.getAttribute('detent')) ?? 'half');
    const steps = order.indexOf(detent) - now;
    const handle = sheet.getByRole('button', { name: t(lang, 'sheet.resize'), exact: true });
    await handle.focus();
    for (let step = 0; step < Math.abs(steps); step += 1) {
        await handle.press(steps > 0 ? 'ArrowUp' : 'ArrowDown');
    }
    await expect(sheet).toHaveAttribute('detent', detent);
    await expect.poll(() => box.evaluate((element) => element.getAnimations().length), { message: 'the sheet has settled' }).toBe(0);
}

/** Scrolls the scrolling part of `host`'s dialog to its end (About is taller than a phone). */
export async function scrollToEnd(host: Locator): Promise<void> {
    await host.evaluate((element) => {
        const visit = (root: Element | ShadowRoot): void => {
            for (const node of Array.from(root.querySelectorAll('*'))) {
                if (node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
                    node.scrollTop = node.scrollHeight;
                }
                if (node.shadowRoot !== null) {
                    visit(node.shadowRoot);
                }
            }
        };
        visit(element.shadowRoot ?? element);
    });
}
