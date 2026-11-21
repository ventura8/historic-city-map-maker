import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { openTimelineCard, openViewer, serveManifest, t } from '../../support/viewer.js';

/**
 * A mouse on a timeline with more years than its card holds (the owner, 2026-11-14: a finger could scroll it, a mouse
 * could not): a drag pans the years and selects none, a click still selects, the wheel scrolls it sideways.
 */
const OBOR_VIEW = '16/44.44763/26.13822';

function manyYears(): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const extra = Array.from({ length: 61 }, (_, at) => 1924 + at)
        .filter((year) => !served.some((layer) => layer['year'] === year))
        .map((year) => ({ ...xyz, id: `e2e-${String(year)}`, year, label: { ro: `Strat ${String(year)}`, en: `Layer ${String(year)}` } }));
    return { ...manifest, layers: [...served, ...extra].map((layer, order) => ({ ...layer, order: order + 1 })) };
}

async function scrollingCard(page: Page, lang: 'ro' | 'en') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 768, height: 1024 });
    await serveManifest(page, manyYears());
    await openViewer(page, { lang, hash: OBOR_VIEW });
    await openTimelineCard(page);
    const thumb = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
    await expect(page.locator('hcm-timeline')).toHaveAttribute('density', 'scroll');
    const box = await page.locator('hcm-timeline .scroller').boundingBox();
    if (box === null) {
        throw new Error('the timeline card has no box');
    }
    // On the track itself: since the 56 px labels (198edc45) the scroller's bottom 16 px lie below it.
    const track = await page.locator('hcm-timeline .track').boundingBox();
    return { thumb, y: track === null ? box.y + box.height / 2 : track.y + track.height / 2, box };
}

function scrollLeft(page: Page): Promise<number> {
    return page.locator('hcm-timeline .scroller').evaluate((scroller) => Math.abs(scroller.scrollLeft));
}

test(
    'A mouse drag on a timeline that scrolls pans the years and selects none',
    { tag: '@S-V04-HAPPY-MOUSE-PAN' },
    async ({ page, lang }) => {
        const { thumb, y, box } = await scrollingCard(page, lang);
        await thumb.focus();
        await thumb.press('End');
        await thumb.press('Home');
        const before = await scrollLeft(page);
        const selected = await thumb.getAttribute('aria-valuenow');
        const start = box.x + box.width / 2;

        await page.mouse.move(start, y);
        await page.mouse.down();
        await page.mouse.move(start - 60, y, { steps: 4 });
        await page.mouse.move(start - 160, y, { steps: 4 });
        await page.mouse.up();

        await expect.poll(() => scrollLeft(page), 'the drag scrolled the years').toBeGreaterThan(before + 100);
        await expect(thumb).toHaveAttribute('aria-valuenow', selected ?? '0');

        const wheeled = await scrollLeft(page);
        await page.mouse.move(start, y);
        await page.mouse.wheel(0, -120);
        await expect.poll(() => scrollLeft(page), 'the wheel scrolled the years back').toBeLessThan(wheeled);
    },
);

test(
    'A mouse click on a timeline that scrolls still selects the year under it',
    { tag: '@S-V04-BAD-MOUSE-PAN-CLICK' },
    async ({ page, lang }) => {
        const { thumb, y, box } = await scrollingCard(page, lang);
        await thumb.focus();
        await thumb.press('Home');
        const x = box.x + box.width * 0.75;

        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 2, y);
        await page.mouse.up();

        await expect(thumb).not.toHaveAttribute('aria-valuenow', '0');
    },
);

async function thumbCentre(page: Page): Promise<{ readonly x: number; readonly y: number }> {
    const box = await page.locator('hcm-timeline .thumb').boundingBox();
    if (box === null) {
        throw new Error('the thumb has no box');
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test(
    'A mouse drag of the year pill selects the years under it and never pans the bar',
    { tag: '@S-V04-HAPPY-PILL-DRAG' },
    async ({ page, lang }) => {
        const { thumb, box } = await scrollingCard(page, lang);
        await thumb.focus();
        await thumb.press('Home');
        const before = await scrollLeft(page);
        const pill = await thumbCentre(page);

        await page.mouse.move(pill.x, pill.y);
        await page.mouse.down();
        await page.mouse.move(pill.x + 120, pill.y, { steps: 6 });
        await page.mouse.up();

        await expect(thumb).not.toHaveAttribute('aria-valuenow', '0');
        expect(Math.abs((await scrollLeft(page)) - before), 'the bar stayed where it was').toBeLessThan(2);

        const held = await thumbCentre(page);
        const scrolled = await scrollLeft(page);
        const valueBefore = Number(await thumb.getAttribute('aria-valuenow'));
        await page.mouse.move(held.x, held.y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 4, held.y, { steps: 6 });
        await expect.poll(() => scrollLeft(page), 'held at the edge, the bar scrolls on').toBeGreaterThan(scrolled + 40);
        await page.mouse.up();
        expect(Number(await thumb.getAttribute('aria-valuenow'))).toBeGreaterThan(valueBefore);
    },
);

async function fling(page: Page, y: number, start: number): Promise<number> {
    await page.mouse.move(start, y);
    await page.mouse.down();
    // A quick throw: the moves follow each other as fast as the browser takes them.
    await page.mouse.move(start - 200, y, { steps: 10 });
    await page.mouse.up();
    return scrollLeft(page);
}

test('A mouse fling keeps the years moving after release', { tag: '@S-V04-HAPPY-PAN-FLING' }, async ({ page, lang }) => {
    const { thumb, y, box } = await scrollingCard(page, lang);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await thumb.focus();
    await thumb.press('Home');

    const released = await fling(page, y, box.x + box.width * 0.8);

    // The drag itself moves the years exactly 200 px; the fling carries them on past that (the reduced-motion row stays at 200).
    expect(released).toBeGreaterThanOrEqual(200);
    await expect.poll(() => scrollLeft(page), 'the fling carried the years on after release').toBeGreaterThan(205);
    await expect(thumb).toHaveAttribute('aria-valuenow', '0');
});

test('With reduced motion a mouse pan stops at once on release', { tag: '@S-V04-BAD-PAN-REDUCED' }, async ({ page, lang }) => {
    const { thumb, y, box } = await scrollingCard(page, lang);
    await thumb.focus();
    await thumb.press('Home');

    const still = await fling(page, y, box.x + box.width * 0.8);
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                let left = 20;
                const next = (): void => {
                    left -= 1;
                    if (left > 0) {
                        requestAnimationFrame(next);
                    } else {
                        resolve(null);
                    }
                };
                requestAnimationFrame(next);
            }),
    );

    expect(await scrollLeft(page)).toBe(still);
});
