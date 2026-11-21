import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { openTimelineCard, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The scroll hint and the start at the selected year (behaviour V04; the owner, 2026-11-14): a scrolling timeline fades
 * each edge with years beyond it and puts a labelled 48 px button there that pages that way and names the furthest year
 * it hides; the card opens on the selected year, centred when it can be, never at today when another year is chosen.
 */

const OBOR_VIEW = '16/44.44763/26.13822';
const FIRST = 1924;

/** The fixture's layers plus one per year from 1924 to 1984, so the timeline has sixty-three stops. */
function manifestOf(): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const extra = Array.from({ length: 61 }, (_, at) => FIRST + at)
        .filter((year) => !served.some((layer) => layer['year'] === year))
        .map((year) => ({ ...xyz, id: `e2e-${String(year)}`, year, label: { ro: `Strat ${String(year)}`, en: `Layer ${String(year)}` } }));
    return { ...manifest, layers: [...served, ...extra].map((layer, order) => ({ ...layer, order: order + 1 })) };
}

/** The selected year's distance from the card's centre along the timeline, and whether it is inside the card. */
async function selectedPlace(page: Page): Promise<{ readonly off: number; readonly inView: boolean }> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const vertical = element.getAttribute('orientation') === 'vertical';
            const view = element.shadowRoot?.querySelector('.scroller')?.getBoundingClientRect() ?? new DOMRect();
            const stop = element.shadowRoot?.querySelector('.stop.selected')?.getBoundingClientRect() ?? new DOMRect();
            const along = (box: DOMRect, start: 'left' | 'top', size: 'width' | 'height') => box[start] + box[size] / 2;
            const off = vertical
                ? along(stop, 'top', 'height') - along(view, 'top', 'height')
                : along(stop, 'left', 'width') - along(view, 'left', 'width');
            const inView = stop.left >= view.left && stop.right <= view.right && stop.top >= view.top && stop.bottom <= view.bottom;
            return { off: Math.abs(off), inView };
        });
}

const SIZES = [
    { width: 1440, height: 900 },
    { width: 360, height: 800 },
] as const;

test(
    'A scrolling timeline names its hidden years at each edge and a press there shows the next page',
    { tag: '@S-V04-HAPPY-SCROLL-HINT' },
    async ({ page, lang }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf());
        for (const size of SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: `${OBOR_VIEW}&layers=e2e-1954` });
            await openTimelineCard(page);
            const where = `${String(size.width)}x${String(size.height)}`;
            const earlier = page.getByRole('button', { name: t(lang, 'timeline.earlier', { year: String(FIRST) }), exact: true });
            const later = page.getByRole('button', { name: t(lang, 'timeline.later', { year: t(lang, 'timeline.present') }), exact: true });
            await expect(earlier, `${where}: the earlier years' button`).toBeVisible();
            await expect(later, `${where}: the later years' button`).toBeVisible();
            await expect(earlier).toContainText(String(FIRST));
            const box = (await earlier.boundingBox()) ?? { width: 0, height: 0 };
            expect(Math.min(box.width, box.height), `${where}: a 48 px target`).toBeGreaterThanOrEqual(48);
            const before = await selectedPlace(page);
            await earlier.focus();
            await page.keyboard.press('Enter');
            await expect
                .poll(async () => (await selectedPlace(page)).off, `${where}: the years moved a page`)
                .toBeGreaterThan(before.off + 100);
            await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('density', 'scroll');
        }
    },
);

test(
    'A timeline whose years fit, or that rests as its pill, shows no scroll buttons',
    { tag: '@S-V04-BAD-SCROLL-HINT-FITS' },
    async ({ page, lang }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('density', 'roomy');
        await expect(viewer(page).locator('hcm-timeline .edge')).toHaveCount(0);

        await serveManifest(page, manifestOf());
        await page.setViewportSize({ width: 360, height: 800 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
        await expect(viewer(page).locator('hcm-timeline .edge'), 'the idle pill').toHaveCount(0);
    },
);

test(
    'The timeline opens on the chosen year, centred, on a desktop and on a phone',
    { tag: '@S-V04-HAPPY-START-AT-YEAR' },
    async ({ page, lang }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf());
        for (const size of SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: `${OBOR_VIEW}&layers=e2e-1954` });
            await openTimelineCard(page);
            const where = `${String(size.width)}x${String(size.height)}`;
            await expect.poll(async () => (await selectedPlace(page)).off, `${where}: 1954 centred`).toBeLessThanOrEqual(2);
        }
    },
);

test(
    'A year at the far end opens in view at its edge, never a blank card or today',
    { tag: '@S-V04-BAD-START-AT-YEAR-EDGE' },
    async ({ page, lang }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf());
        for (const size of SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: `${OBOR_VIEW}&layers=e2e-${String(FIRST)}` });
            await openTimelineCard(page);
            const where = `${String(size.width)}x${String(size.height)}`;
            await expect.poll(async () => (await selectedPlace(page)).inView, `${where}: ${String(FIRST)} in view`).toBe(true);
            const later = page.getByRole('button', { name: t(lang, 'timeline.later', { year: t(lang, 'timeline.present') }), exact: true });
            await expect(later, `${where}: today is hidden, named at its edge`).toBeVisible();
        }
    },
);
