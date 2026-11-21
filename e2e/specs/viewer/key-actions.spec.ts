import type { Page } from '@playwright/test';

import { analyticsCalls, analyticsManifest, gaEvents, viewerEventProblem } from '../../support/ga4.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The viewer's key actions in GA4 (behaviour V70, the owner's request of 2026-11-13, DECISIONS-for-review.md §200): after
 * Accept, the compass's reset is one `compass_reset` event and every event passes the viewer's own guard (no position, no
 * text); a browser that asks not to be tracked (Do Not Track) is not asked and nothing reaches Google or Firebase.
 */

function banner(page: Page) {
    return viewer(page).locator('hcm-consent-banner');
}

test(
    'After Accept the compass reset is one GA4 event, valid and private',
    { tag: ['@S-V70-HAPPY-KEY-ACTIONS', '@S-V70-BAD-YEAR-DRAG-ONE-EVENT'] },
    async ({ page, lang, mockApis }) => {
        await serveManifest(page, analyticsManifest());
        await openViewer(page, { lang, hash: '16/44.42704/26.0853/45' });
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        // Four years in a row along the timeline: the year where the visitor stops is sent, never the ones passed on the way.
        const timeline = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        await timeline.focus();
        const passed: string[] = [];
        for (let step = 0; step < 4; step += 1) {
            await timeline.press('ArrowLeft');
            // The slider says "Year 1966"; GA4 gets the year itself (or `today`).
            passed.push(/\d{3,4}/.exec((await timeline.getAttribute('aria-valuetext')) ?? '')?.[0] ?? 'today');
        }
        const last = passed.at(-1) ?? '';
        const before = passed.filter((year) => year !== last);
        const years = async (): Promise<string[]> =>
            (await gaEvents(mockApis)).filter((event) => event.name === 'year_change').map((event) => event.params.get('ep.year') ?? '');
        await expect.poll(years).toContain(last);
        expect((await years()).filter((year) => before.includes(year))).toEqual([]);

        await page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true }).click();

        await expect.poll(async () => (await gaEvents(mockApis)).filter((event) => event.name === 'compass_reset').length).toBe(1);
        expect((await years()).filter((year) => year === last)).toHaveLength(1);
        for (const event of await gaEvents(mockApis)) {
            expect(viewerEventProblem(event), event.name).toBeNull();
        }
    },
);

test(
    'A browser that asks not to be tracked gets no banner and sends nothing',
    { tag: '@S-V70-BAD-NO-EVENTS-BEFORE-CONSENT' },
    async ({ page, lang, mockApis }) => {
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
        });
        await serveManifest(page, analyticsManifest());
        await openViewer(page, { lang, hash: '16/44.42704/26.0853/45' });
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);

        await page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true }).click();

        expect(await analyticsCalls(mockApis), 'no analytics request under Do Not Track').toEqual([]);
        expect(await page.evaluate(() => Object.keys(window).filter((key) => key === 'dataLayer' || key === 'gtag'))).toEqual([]);
    },
);
