import type { Page } from '@playwright/test';

/**
 * Emulates the device's accent colour (DECISIONS-for-review.md §222): Playwright's Chromium is a tab, which Chrome gives
 * no accent of the device, so the page's root names one with `--hcm-device-accent` (as an embedding site may) before any
 * script of the page runs. An init script can run before `<html>` exists: it then waits for it.
 */
export async function emulateDeviceAccent(page: Page, accent: string): Promise<void> {
    await page.addInitScript((value) => {
        const name = (): boolean => {
            const root = document.querySelector('html');
            root?.style.setProperty('--hcm-device-accent', value);
            return root !== null;
        };
        if (!name()) {
            const watch = new MutationObserver(() => {
                if (name()) {
                    watch.disconnect();
                }
            });
            watch.observe(document, { childList: true });
        }
    }, accent);
}
