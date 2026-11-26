import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { blend, expectColourAt, mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { hashParam, openLayers, openViewer, serveManifest, t, visibilitySwitch } from '../../support/viewer.js';

/**
 * The owner's requests of 2026-11-09 and 2026-11-13 (behaviours V03 and V07): a historical layer switched on moves the
 * timeline to its year and comes to the front, above a newer opaque one too (V15); the other layers stack by date, the
 * newest on top, whatever the admin's `order`; a photo's
 * date leads to the map of its layer year, or its chips to the near ones, the photo staying open. Pixel probes read the
 * synthetic tile colours in an empty corner of the city.
 */

const EMPTY_VIEW = '15/44.37000/25.97000';
const LABEL_1966 = 'Corona 1966 (e2e)';
const LABEL_1980: Readonly<Record<Locale, string>> = { ro: 'Fotografie aeriană 1980 (e2e)', en: 'Aerial photo 1980 (e2e)' };

function timelineSlider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function closePanel(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

/** The fixture with the admin's `order` against the dates (1966 above 1980) and both layers opaque. */
function withOrderAgainstDates(): Json {
    const manifest = siteManifestData();
    const [older, newer] = manifest['layers'] as [Json, Json];
    older['order'] = 9;
    newer['order'] = 1;
    newer['opacity'] = 1;
    return manifest;
}

test('A layer switched on moves the timeline to its year', { tag: '@S-V03-HAPPY-LAYER-MOVES-TIMELINE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: EMPTY_VIEW });
    const probe = await mapFraction(page, 0.5, 0.3);
    await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));

    await openLayers(page, lang);
    await visibilitySwitch(page, lang, LABEL_1966).click();
    await closePanel(page, lang);

    await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 tiles');
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
});

test(
    "A layer of another year than the timeline's shows; switching every layer off leaves the timeline",
    { tag: '@S-V03-BAD-LAYER-OF-ANOTHER-YEAR' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
        const probe = await mapFraction(page, 0.5, 0.3);
        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));

        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LABEL_1980[lang]).click();
        await closePanel(page, lang);

        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
        await expectColourAt(page, probe, blend(E2E_XYZ_LAYER.colour, E2E_TILESET_LAYER.colour, 0.8), '1980 at 80 % over 1966');
        await expect.poll(() => hashParam(page, 'layers')).toBe(`${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}`);

        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LABEL_1980[lang]).click();
        await visibilitySwitch(page, lang, LABEL_1966).click();
        await closePanel(page, lang);
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'no layer');
        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    },
);

test('Layers stack by date, the newest on top, whatever their order', { tag: '@S-V03-HAPPY-STACK-BY-DATE' }, async ({ page, lang }) => {
    await serveManifest(page, withOrderAgainstDates());
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}` });

    await expectColourAt(page, await mapFraction(page, 0.5, 0.3), E2E_XYZ_LAYER.colour, 'the 1980 tiles over the 1966 ones');
});

test(
    'The older layer switched on last comes to the front, and its link keeps it there',
    { tag: '@S-V03-HAPPY-CHOSEN-LAYER-FRONT' },
    async ({ page, lang }) => {
        await serveManifest(page, withOrderAgainstDates());
        await openViewer(page, { lang, hash: EMPTY_VIEW });

        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LABEL_1980[lang]).click();
        await visibilitySwitch(page, lang, LABEL_1966).click();
        await closePanel(page, lang);

        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
        const probe = await mapFraction(page, 0.5, 0.3);
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 tiles over the opaque 1980 ones');
        await expect.poll(() => hashParam(page, 'layers')).toBe(`${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);

        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}` });
        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), E2E_TILESET_LAYER.colour, 'the link keeps 1966 on top');
    },
);

test(
    'The front layer switched off leaves the newer one showing, the timeline where it was',
    { tag: '@S-V03-BAD-FRONT-SWITCHED-OFF' },
    async ({ page, lang }) => {
        await serveManifest(page, withOrderAgainstDates());
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}` });
        const probe = await mapFraction(page, 0.5, 0.3);
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 tiles on top');

        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LABEL_1966).click();
        await closePanel(page, lang);

        await expectColourAt(page, probe, E2E_XYZ_LAYER.colour, 'the 1980 tiles once 1966 is off');
        await expect(timelineSlider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);
    },
);

test(
    "A photo of a layer's year shows the map of that year, the photo still open",
    { tag: '@S-V07-HAPPY-MAP-OF-YEAR' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '18/44.42275/26.08670&photo=arionoaia-1980' });
        const mapOf = t(lang, 'photo.mapOf', { year: '1980' });

        await page.getByRole('button', { name: new RegExp(`, ${mapOf}$`, 'u') }).click();

        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);
        expect(await hashParam(page, 'photo')).toBe('arionoaia-1980');
    },
);

test(
    'A photo between layer years offers the near ones, nearest first; one far from every layer offers none',
    { tag: '@S-V07-BAD-NO-LAYER-OF-ITS-YEAR' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '18/44.42936/26.09545&photo=strandul-opereta-1976' });
        const chips = page.getByRole('button', { name: new RegExp(t(lang, 'photo.mapOf', { year: '\\d{4}' }), 'u') });

        await expect(chips).toHaveCount(2);
        await expect(chips.first()).toHaveAccessibleName(t(lang, 'photo.mapOf', { year: '1980' }));
        await expect(chips.last()).toHaveAccessibleName(t(lang, 'photo.mapOf', { year: '1966' }));
        await chips.last().click();
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
        expect(await hashParam(page, 'photo')).toBe('strandul-opereta-1976');

        await openViewer(page, { lang, hash: '16/44.44763/26.13822&photo=parcul-ferdinand-1930' });
        await expect(page.getByRole('button', { name: t(lang, 'photo.locate') })).toBeVisible();
        await expect(chips).toHaveCount(0);
    },
);
