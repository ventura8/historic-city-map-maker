import type { Page } from '@playwright/test';

import { mapIdle, renderedFeatureIds } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { t, viewer, visibilitySwitch, waitForEngineEvent } from '../../support/viewer.js';
import { WIKIPEDIA_LABEL, openArticle, serveWikipedia } from '../../tour/wikipedia-states.js';

/**
 * M31 the Wikipedia overlay (behaviour V90, docs/research/M31-wikipedia.md): hidden at open, its own switch in Layers, the
 * server's file loaded when it is switched on, one icon per article, a click shows the title, extract, free thumbnail,
 * Read on Wikipedia and the credit; the visitor's browser asks Wikipedia nothing (the firewall fails any such request).
 */

async function boot(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(sitePath('bucharest', { lang, hash: '16/44.44130/26.09730' }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

test(
    'Switched on, the Wikipedia overlay draws its articles and a click opens one with its picture and link',
    { tag: ['@S-V90-HAPPY-OVERLAY', '@S-V90-HAPPY-ARTICLE', '@S-V90-HAPPY-LANGUAGE'] },
    async ({ page, lang }) => {
        let fileRequests = 0;
        page.on('request', (request) => {
            fileRequests += request.url().endsWith('/wikipedia.json') ? 1 : 0;
        });
        await serveWikipedia(page);
        await boot(page, lang);
        const wikipedia = visibilitySwitch(page, lang, WIKIPEDIA_LABEL);

        // Hidden at open: nothing drawn, nothing fetched.
        await expect(wikipedia).toHaveAttribute('aria-checked', 'false');
        expect(fileRequests).toBe(0);
        expect(await renderedFeatureIds(page, 'hcm-poi-')).not.toContain('wikipedia-ro-1');

        await wikipedia.click();
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain('wikipedia-ro-1');
        expect(fileRequests).toBe(1);
        await expect(viewer(page).locator('.pane.leading hcm-layer-panel .attribution')).toContainText('Wikipedia (CC BY-SA 4.0)');

        await openArticle(page, lang);
        const sheet = viewer(page).locator('hcm-poi-detail');
        await expect(sheet).toContainText(
            lang === 'en' ? 'A concert hall in the centre of Bucharest.' : 'Sală de concerte din centrul Bucureștiului.',
        );
        const link = sheet.getByRole('link', { name: t(lang, 'wikipedia.read') });
        await expect(link).toHaveAttribute(
            'href',
            lang === 'en' ? 'https://en.wikipedia.org/wiki/Romanian_Athenaeum' : 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n',
        );
        await expect(sheet).toContainText(t(lang, 'layers.attribution', { attribution: 'Wikipedia (CC BY-SA 4.0)' }));
        await page.screenshot({ path: test.info().outputPath(`wikipedia-article-${lang}.png`) });
    },
);

test(
    'A Wikipedia file that cannot be loaded switches the overlay off and says what to do',
    { tag: '@S-V90-BAD-FILE-FAILS' },
    async ({ page, lang, consoleErrors }) => {
        await serveWikipedia(page, false);
        await boot(page, lang);
        const wikipedia = visibilitySwitch(page, lang, WIKIPEDIA_LABEL);

        await wikipedia.click();

        await expect(
            viewer(page)
                .locator('hcm-snackbar .snackbar')
                .filter({ hasText: t(lang, 'wikipedia.loadFailed') }),
        ).toBeVisible();
        await expect(wikipedia).toHaveAttribute('aria-checked', 'false');
        expect(await renderedFeatureIds(page, 'hcm-poi-')).not.toContain('wikipedia-ro-1');
        // The 404 the browser logs is the only console line of the test.
        expect(consoleErrors.takeMatching(/wikipedia\.json/)).toHaveLength(1);
    },
);
