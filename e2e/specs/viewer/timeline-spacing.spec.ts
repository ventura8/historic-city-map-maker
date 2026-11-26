import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { openTimelineCard, openViewer, serveManifest, viewer } from '../../support/viewer.js';

/**
 * The years' spacing on the timeline (behaviour V04; the owner, 2026-11-14: "the spacing is way nuked"): every year is
 * exactly 40 px from the next (`YEAR_GAP_PX`) at every window size and both ways, never stretched to the card nor spread
 * by date. Years that fit start at the card's leading edge (44 px in lying, 24 px below the top standing, today first);
 * years that do not fit scroll, still 40 px apart. The pill sits on its own year.
 */

const OBOR_VIEW = '16/44.44763/26.13822';
const GAP_PX = 40;

/** The fixture's layers plus one per year in `years`, so the timeline has those stops. */
function manifestOf(years: readonly number[]): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const extra = years
        .filter((year) => !served.some((layer) => layer['year'] === year))
        .map((year) => ({ ...xyz, id: `e2e-${String(year)}`, year, label: { ro: `Strat ${String(year)}`, en: `Layer ${String(year)}` } }));
    return { ...manifest, layers: [...served, ...extra].map((layer, order) => ({ ...layer, order: order + 1 })) };
}

interface Spacing {
    readonly density: string | null;
    readonly gaps: readonly number[];
    /** Lying, the first year's centre from the card's left; standing, today's from its top. */
    readonly lead: number;
    /** The pill's centre from its year's centre, along the timeline. */
    readonly pillOff: number;
}

/** Measures the stops' label centres along the timeline (a hidden label keeps its box), the lead and the pill's offset. */
async function spacing(page: Page): Promise<Spacing> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const vertical = element.getAttribute('orientation') === 'vertical';
            const along = (box: DOMRect): number => (vertical ? box.top + box.height / 2 : box.left + box.width / 2);
            const root = element.shadowRoot;
            const labels = [...(root?.querySelectorAll('.stop .label') ?? [])].map((label) => along(label.getBoundingClientRect()));
            const card = element.getBoundingClientRect();
            const thumb = root?.querySelector('.thumb')?.getBoundingClientRect();
            const selected = root?.querySelector('.stop.selected .label')?.getBoundingClientRect();
            return {
                density: element.getAttribute('density'),
                gaps: labels.slice(1).map((centre, at) => Math.abs(centre - (labels[at] ?? 0))),
                lead: vertical ? (labels.at(-1) ?? 0) - card.top : (labels[0] ?? 0) - card.left,
                pillOff: thumb && selected ? Math.abs(along(thumb) - along(selected)) : Number.NaN,
            };
        });
}

function expectEvenGaps(view: Spacing, where: string): void {
    expect(view.gaps.length, `${where}: several years`).toBeGreaterThan(1);
    expect(Math.min(...view.gaps), `${where}: the narrowest gap`).toBeGreaterThanOrEqual(GAP_PX - 1);
    expect(Math.max(...view.gaps), `${where}: the widest gap`).toBeLessThanOrEqual(GAP_PX + 1);
    expect(view.pillOff, `${where}: the pill on its year`).toBeLessThanOrEqual(1);
}

const SIZES = [
    { width: 768, height: 1024, lead: 44 },
    { width: 1440, height: 900, lead: 44 },
    { width: 2560, height: 1300, lead: 44 },
    { width: 360, height: 800, lead: 24 },
] as const;

test(
    'The years that fit stand exactly 40 px apart from the leading edge at 768, 1440 and 2560 px and upright at 360 px',
    { tag: '@S-V04-HAPPY-YEAR-GAP-FIXED' },
    async ({ page, lang }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf([1964, 1966, 1968]));
        for (const size of SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await openTimelineCard(page);
            const where = `${String(size.width)}x${String(size.height)}`;
            await expect.poll(async () => (await spacing(page)).density, `${where}: the years fit`).toBe('roomy');
            const view = await spacing(page);
            expectEvenGaps(view, where);
            expect(Math.abs(view.lead - size.lead), `${where}: from the leading edge`).toBeLessThanOrEqual(1);
        }
    },
);

test(
    'Sixty years keep exactly 40 px apart and scroll, never squeezed or stretched, at every size',
    { tag: '@S-V04-BAD-YEAR-GAP-MANY' },
    async ({ page, lang }) => {
        // The live map, 2026-11-14: sixty-two years and today.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf(Array.from({ length: 61 }, (_, at) => 1924 + at)));
        for (const size of SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await openTimelineCard(page);
            const where = `${String(size.width)}x${String(size.height)}`;
            await expect.poll(async () => (await spacing(page)).density, `${where}: the card scrolls`).toBe('scroll');
            expectEvenGaps(await spacing(page), where);
        }
    },
);
