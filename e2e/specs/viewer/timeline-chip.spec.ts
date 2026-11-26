import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expect, test } from '../../support/test.js';
import {
    fingers,
    lift,
    manyYearsManifest,
    meet,
    pillOn,
    stopCentre,
    timelineCard,
    touch,
    yearChip,
    type Rect,
} from '../../support/timeline.js';
import { currentHash, hashParam, openTimelineCard, openViewer, serveManifest, t } from '../../support/viewer.js';

/**
 * The timeline's year chip and its finger (behaviour V04; the owner, 2026-11-13, 2026-11-14): every year has its label
 * (40 px apart, the card scrolling), so a mouse shows no chip and a finger scrubbing from the year pill shows the year in
 * an M3 plain tooltip above the card; a finger dragged along the track selects each year it enters at once (its layer to the front, V15), the
 * chip naming it clear of the finger, and lifting ends the drag; a fast scrub ends on its last year with no other layer
 * left in front; a swipe that starts on the map pans the map and leaves the timeline alone.
 */

const OBOR_VIEW = '16/44.44763/26.13822';
/** Twenty-one layer years, 1964 to 1984, and today: every other year unlabelled on a phone and a tablet. */
const YEARS = Array.from({ length: 21 }, (_, at) => 1964 + at);
/** The floating controls the chip must leave free. */
const CONTROLS = ['hcm-compass', '.dock.zoom', 'hcm-fab-menu', '.dock.chip [data-layout-check="near-year"]'];

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function controlBoxes(page: Page): Promise<Rect[]> {
    const boxes: Rect[] = [];
    for (const selector of CONTROLS) {
        const found = page.locator('hcm-map-viewer').locator(selector).filter({ visible: true });
        for (const box of await found.evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }),
        )) {
            boxes.push(box);
        }
    }
    return boxes;
}

async function expectChipClear(page: Page, chip: Rect): Promise<void> {
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    expect(chip.x, 'inside the viewport').toBeGreaterThanOrEqual(0);
    expect(chip.y).toBeGreaterThanOrEqual(0);
    expect(chip.x + chip.width).toBeLessThanOrEqual(viewport.width);
    expect(chip.y + chip.height).toBeLessThanOrEqual(viewport.height);
    expect(
        (await controlBoxes(page)).filter((box) => meet(box, chip)),
        'no control under the chip',
    ).toEqual([]);
}

async function openYears(page: Page, lang: Locale, size: { readonly width: number; readonly height: number }): Promise<void> {
    await page.setViewportSize(size);
    await serveManifest(page, manyYearsManifest(YEARS.slice(1), [1964]));
    await openViewer(page, { lang, hash: OBOR_VIEW });
    await openTimelineCard(page);
    await expect(slider(page, lang)).toHaveAttribute('aria-valuemax', '21');
}

test(
    'A finger scrubbing from the year pill shows the year above the timeline, in large type',
    { tag: '@S-V04-HAPPY-YEAR-CHIP' },
    async ({ page, lang }) => {
        await openYears(page, lang, { width: 768, height: 1024 });
        const cdp = await fingers(page);

        await touch(cdp, await pillOn(page, lang, 0), [await stopCentre(page, 1)], false);

        await expect.poll(async () => (await yearChip(page))?.text).toBe('1965');
        const chip = (await yearChip(page))?.box ?? { x: 0, y: 0, width: 0, height: 0 };
        expect(chip.y + chip.height, 'above the card').toBeLessThanOrEqual((await timelineCard(page)).y);
        expect(chip.height, 'the owner: bigger, 40 px at least').toBeGreaterThanOrEqual(40);
        await expect(page.locator('hcm-timeline .tip')).toHaveCSS('font-size', '16px');
        await expectChipClear(page, chip);
        await lift(cdp);
    },
);

test(
    'A multi-date year shows no chip, under a mouse, the keyboard or a finger',
    { tag: ['@S-V04-BAD-MULTI-DATE-NO-CHIP', '@S-V68-BAD-MULTI-DATE-NO-CHIP'] },
    async ({ page, lang }) => {
        await openYears(page, lang, { width: 768, height: 1024 });
        const first = await stopCentre(page, 0);

        await page.mouse.move(first.x, first.y);
        await page.mouse.move(first.x + 1, first.y);
        expect(await yearChip(page), 'its badge says it has dates; the date menu names them').toBeNull();
        await slider(page, lang).focus();
        await page.keyboard.press('Home');
        await expect(slider(page, lang)).toHaveAttribute('aria-valuenow', '0');
        expect(await yearChip(page), 'the keyboard on 1964').toBeNull();
    },
);

test('A mouse over a labelled year of one date shows no chip', { tag: '@S-V04-BAD-YEAR-CHIP-LABELLED' }, async ({ page, lang }) => {
    await openYears(page, lang, { width: 768, height: 1024 });
    const labelled = await stopCentre(page, 2);

    await page.mouse.move(labelled.x, labelled.y);
    await page.mouse.move(labelled.x + 1, labelled.y);

    expect(await yearChip(page)).toBeNull();
});

/** Where the chip goes clear of the finger: beside a standing card (a phone upright), above a lying one. */
const BESIDE = (chip: Rect, card: Rect): boolean => chip.x >= card.x + card.width;
const ABOVE = (chip: Rect, card: Rect): boolean => chip.y + chip.height <= card.y;

for (const { clear, ...size } of [
    { width: 360, height: 800, clear: BESIDE },
    { width: 768, height: 1024, clear: ABOVE },
]) {
    const where = `${String(size.width)}x${String(size.height)}`;

    test(
        `${where}: a finger dragged across the years selects each one live, the chip following it clear of the finger`,
        { tag: '@S-V04-HAPPY-TOUCH-SCRUB' },
        async ({ page, lang }) => {
            await openYears(page, lang, size);
            const cdp = await fingers(page);
            const card = await timelineCard(page);

            await touch(cdp, await pillOn(page, lang, 4), [await stopCentre(page, 5), await stopCentre(page, 6)], false);

            await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1970' }));
            await expect.poll(async () => (await yearChip(page))?.text).toBe('1970');
            const chip = (await yearChip(page))?.box ?? { x: 0, y: 0, width: 0, height: 0 };
            expect(clear(chip, card), 'clear of the finger: beside a standing card, above a lying one').toBe(true);
            await expect.poll(() => hashParam(page, 'layers')).toBe('e2e-1970');
            await lift(cdp);
            await expect.poll(() => yearChip(page)).toBeNull();
        },
    );

    test(
        `${where}: a fast scrub ends on its last year with no other layer in front, and a swipe on the map leaves the timeline`,
        { tag: '@S-V04-BAD-FAST-SCRUB' },
        async ({ page, lang }) => {
            await openYears(page, lang, size);
            const cdp = await fingers(page);
            const from = await pillOn(page, lang, 4);
            const path = [];
            for (const index of [5, 6, 7, 8, 9, 10, 11, 12]) {
                path.push(await stopCentre(page, index));
            }

            await touch(cdp, from, path, true);

            // Held at the card's edge the years scroll on under the finger (EdgeScroll), so the last year is read, not fixed.
            await expect.poll(async () => Number(await slider(page, lang).getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(12);
            const last = String(1964 + Number(await slider(page, lang).getAttribute('aria-valuenow')));
            await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: last }));
            await expect.poll(() => hashParam(page, 'layers')).toBe(`e2e-${last}`);
            expect(await yearChip(page)).toBeNull();

            const before = await currentHash(page);
            const middle = { x: size.width / 2 + 40, y: size.height / 2 };
            await touch(
                cdp,
                middle,
                [1, 2, 3, 4, 5].map((step) => ({ x: middle.x + 2, y: middle.y - step * 30 })),
                true,
            );
            await expect.poll(async () => (await currentHash(page)).split('&')[0]).not.toBe(before.split('&')[0]);
            await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: last }));
        },
    );
}
