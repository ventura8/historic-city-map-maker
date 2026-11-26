import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { manyYearsManifest } from '../../support/timeline.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * A year of two undated plans picked after a pan (the owner, 2026-11-22, at 1943): the bar keeps the picked year in view,
 * and each opacity row names its plan, not only the year.
 */

const YEARS = Array.from({ length: 60 }, (_, at) => 1930 + at);

function twoUndatedPlans(): Record<string, unknown> {
    const manifest = manyYearsManifest(YEARS);
    const layers = manifest['layers'] as Record<string, unknown>[];
    const base = layers.find((layer) => layer['year'] === 1943) ?? {};
    const twin = { ...base, id: 'e2e-1943-twin', label: { ro: 'Plan geamăn 1943 (e2e)', en: 'Twin plan 1943 (e2e)' } };
    return { ...manifest, layers: [...layers, { ...twin, order: layers.length + 1 }] };
}

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

test(
    'A year of two plans picked after a pan stays in view and names each plan',
    { tag: ['@S-V13-HAPPY-PICKED-YEAR-IN-VIEW', '@S-V13-BAD-ROWS-NAMED-NOT-YEAR'] },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await serveManifest(page, twoUndatedPlans());
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        const timeline = viewer(page).locator('hcm-timeline');
        // Pan the bar to its far end first, as a drag does, then pick 1943 with a click on its stop.
        await timeline.evaluate((element) => {
            const scroller = element.shadowRoot?.querySelector<HTMLElement>('.scroller');
            if (scroller) {
                scroller.scrollLeft = 0;
            }
        });
        await timeline.locator('.stop', { hasText: '1943' }).first().click();

        await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', new RegExp(t(lang, 'timeline.year', { year: '1943' })));
        const inView = await timeline.evaluate((element) => {
            const scroller = element.shadowRoot?.querySelector('.scroller')?.getBoundingClientRect();
            const stop = element.shadowRoot?.querySelector('.stop.selected')?.getBoundingClientRect();
            return scroller !== undefined && stop !== undefined && stop.left >= scroller.left - 1 && stop.right <= scroller.right + 1;
        });
        expect(inView, 'the picked year stays in view').toBe(true);

        const names = await viewer(page).locator('hcm-date-menu .opacity-name').allTextContents();
        expect(names.length).toBeGreaterThanOrEqual(3);
        expect(
            names.slice(1).every((name) => name.trim() !== '1943'),
            'each row names its plan',
        ).toBe(true);
    },
);
