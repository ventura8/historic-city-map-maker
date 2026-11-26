import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { E2E_TILESET_LAYER } from '../../fixtures/world.js';
import { mapIdle } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { hashParam, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Deep links on first load (the owner, 2026-11-22: `?layer=…#15/…` opened on today): a layer named in the query or the
 * hash opens on, with the timeline at its year, whatever the boot's defaults; an unknown one says so.
 */

const VIEW = '15/44.42700/26.08530';

async function open(page: Page, lang: Locale, query: string, hash: string): Promise<void> {
    await page.goto(`/bucharest/?lang=${lang}&${query}#${hash}`);
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

test(
    'A layer in the link query opens on, at its year, and the link becomes the hash',
    { tag: '@S-V09-HAPPY-QUERY-LAYER' },
    async ({ page, lang }) => {
        await open(page, lang, `layer=${E2E_TILESET_LAYER.id}`, VIEW);

        await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', new RegExp(t(lang, 'timeline.year', { year: '1966' })));
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
        expect(await page.evaluate(() => location.search)).toBe(`?lang=${lang}`);

        // The address bar's link opens the same state in a fresh page.
        const copied = await page.evaluate(() => location.href);
        const fresh = await page.context().newPage();
        await fresh.goto(copied);
        await waitForEngineEvent(fresh, 'hcm-ready');
        await expect(slider(fresh, lang)).toHaveAttribute('aria-valuetext', new RegExp(t(lang, 'timeline.year', { year: '1966' })));
        await fresh.close();
    },
);

test('An unknown layer in the link opens the map without it and says so', { tag: '@S-V09-BAD-UNKNOWN-LAYER' }, async ({ page, lang }) => {
    await open(page, lang, 'layer=not-published', VIEW);

    await expect(
        viewer(page)
            .locator('span')
            .filter({ hasText: t(lang, 'error.unknownLayer') }),
    ).toBeVisible();
    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
});
