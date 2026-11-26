import type { Page } from '@playwright/test';
import { encodeHash, type Locale } from '@hcm/shared';

import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, SITE_ORIGIN } from '../../fixtures/world.js';
import { blend, expectColourAt, mapFacts, mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import {
    chooseMenuItem,
    closeModalSheet,
    currentHash,
    engineEvents,
    hashParam,
    isDocked,
    openLayers,
    openPhotoOptions,
    openViewer,
    opacitySlider,
    t,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Deep links and sharing (behaviour V09) and overlay opacity in the URL hash (V23, PLAN Addendum 3): the hash
 * restores the view, the visible layers, the opacities and the open photo; what cannot be read falls back to the
 * defaults; Share copies the page address. Docs: docs/ENGINE_API.md → URL hash v1.
 */

const LONE = 'strandul-opereta-1976';
const LONE_TITLE = 'Ștrandul Operetă';
const EMPTY_VIEW = '15/44.37000/25.97000';
const CITY = { zoom: 14.5, center: [26.085298, 44.427037] } as const;
const CATEGORY = { ro: 'Clădiri dispărute', en: 'Vanished buildings' } as const;
const STREETS = { ro: 'Străzi dispărute', en: 'Vanished streets' } as const;
const LAYER_LABEL = 'Corona 1966 (e2e)';

/** No Web Share API (Linux Chromium has none either): sharing goes through the clipboard. */
function withoutWebShare(): void {
    Reflect.deleteProperty(Navigator.prototype, 'share');
}

/** The clipboard refuses every write, as a browser does without permission. */
function refusingClipboard(): void {
    Reflect.deleteProperty(Navigator.prototype, 'share');
    Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) }),
    });
}

/** The `op=` entries of the hash as a map (order does not matter). */
async function opEntries(page: Page): Promise<Record<string, string>> {
    const op = await hashParam(page, 'op');
    return Object.fromEntries(
        (op ?? '')
            .split(',')
            .filter((entry) => entry !== '')
            .map((entry) => entry.split(':') as [string, string]),
    );
}

async function setWithKeys(page: Page, lang: Locale, name: string, percent: number): Promise<void> {
    const slider = opacitySlider(page, lang, name);
    await slider.focus();
    await slider.press('Home');
    for (let step = 0; step < Math.floor(percent / 10); step += 1) {
        await slider.press('PageUp');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(percent));
}

test(
    'A shared link restores the view, the layer and the photo; Share copies the address',
    { tag: '@S-V09-HAPPY' },
    async ({ page, context, lang }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
        await page.addInitScript(withoutWebShare);
        await openViewer(page, { lang, hash: `17/44.42955/26.09560&layers=${E2E_TILESET_LAYER.id}&photo=${LONE}` });

        const facts = await mapFacts(page);
        expect(facts.zoom).toBeCloseTo(17, 1);
        expect(facts.center[0]).toBeCloseTo(26.0956, 4);
        expect(facts.center[1]).toBeCloseTo(44.42955, 4);
        await expect(page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true })).toHaveAttribute(
            'aria-valuetext',
            t(lang, 'timeline.year', { year: '1966' }),
        );
        await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: LONE }]);

        // A modal sheet (compact, medium) makes the map and its menu inert: the visitor closes it, then shares the view.
        // Closing the photo takes it out of the hash (written once the state settles); a docked pane keeps it there.
        await closeModalSheet(page);
        await expect.poll(() => hashParam(page, 'photo')).toBe(photoKeptOpen(page));
        await chooseMenuItem(page, lang, t(lang, 'action.share'));
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'share.copied') })).toBeVisible();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toBe(page.url());
        expect(new URL(copied).hash).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        expect(new URL(copied).hash.includes(`photo=${LONE}`)).toBe(isDocked(page));
    },
);

test(
    'A link to a photo that does not exist shows a toast and opens nothing',
    { tag: '@S-V09-BAD-UNKNOWN-PHOTO' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&photo=no-such-photo` });

        await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.unknownPhoto') })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect.poll(() => hashParam(page, 'photo')).toBeNull();
    },
);

test('A malformed hash falls back to the city defaults', { tag: '@S-V09-BAD-MALFORMED-HASH' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: 'abc/1e3/NaN&layers=%%%,ghost&op=photos:nan&photo=&lang=xx&zz=1' });

    const facts = await mapFacts(page);
    expect(facts.zoom).toBeCloseTo(CITY.zoom, 1);
    expect(facts.center[0]).toBeCloseTo(CITY.center[0], 4);
    expect(facts.center[1]).toBeCloseTo(CITY.center[1], 4);
    await expect(page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true })).toHaveAttribute(
        'aria-valuetext',
        t(lang, 'timeline.present'),
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await engineEvents(page, 'hcm-error')).toEqual([]);
    await expect.poll(() => currentHash(page)).not.toContain('zz=');
});

test(
    'The legacy hash of the old site opens the same view and is rewritten in the v1 form',
    { tag: '@S-V09-HAPPY-LEGACY-HASH' },
    async ({ page, lang }) => {
        await page.goto(`/bucharest/?lang=${lang}#15.5/44.4271/26.0853/90/!a3!p2`);
        await waitForEngineEvent(page, 'hcm-ready');

        await expect.poll(async () => (await mapFacts(page)).zoom).toBeCloseTo(15.5, 1);
        const facts = await mapFacts(page);
        expect(facts.center[1]).toBeCloseTo(44.4271, 4);
        expect(facts.center[0]).toBeCloseTo(26.0853, 4);
        expect(facts.bearing).toBeCloseTo(90, 0);
        // `?lang=en` names a language other than the page's, so the English project's hash keeps it.
        const v1 = encodeHash({ view: { zoom: 15.5, center: [26.0853, 44.4271], bearing: 90 }, ...(lang === 'en' ? { lang } : {}) }).slice(
            1,
        );
        await expect.poll(() => currentHash(page)).toBe(v1);
        await expect(page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true })).toHaveAttribute(
            'aria-valuetext',
            t(lang, 'timeline.present'),
        );
    },
);

test(
    'When the link cannot be copied, a toast says so and nothing else changes',
    { tag: '@S-V09-BAD-SHARE-FAILED' },
    async ({ page, lang }) => {
        await page.addInitScript(refusingClipboard);
        // A docked detail pane stays open while the visitor shares; a modal sheet would make the menu inert.
        const photos = [photoKeptOpen(page)].filter((photo) => photo !== null);
        await openViewer(page, { lang, hash: ['17/44.42955/26.09560', ...photos.map((photo) => `photo=${photo}`)].join('&') });
        const heading = page.getByRole('heading', { name: LONE_TITLE });
        await expect(heading).toHaveCount(photos.length);
        const before = page.url();
        const view = await mapFacts(page);

        await chooseMenuItem(page, lang, t(lang, 'action.share'));
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'share.failed') })).toBeVisible();
        expect(page.url()).toBe(before);
        const after = await mapFacts(page);
        expect(after.zoom).toBeCloseTo(view.zoom, 3);
        expect(after.center[0]).toBeCloseTo(view.center[0], 5);
        await expect(heading).toHaveCount(photos.length);
    },
);

/** The photo a share keeps open: LONE in a docked pane (expanded and wider windows), none behind a modal sheet. */
function photoKeptOpen(page: Page): string | null {
    return isDocked(page) ? LONE : null;
}

test('Overlay opacities go into the hash and come back after a reload', { tag: '@S-V23-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
    await openLayers(page, lang);
    await setWithKeys(page, lang, LAYER_LABEL, 40);
    await openPhotoOptions(page, lang);
    await setWithKeys(page, lang, t(lang, 'layers.photos'), 70);
    await setWithKeys(page, lang, CATEGORY[lang], 20);

    await expect.poll(() => opEntries(page)).toEqual({ [E2E_TILESET_LAYER.id]: '40', photos: '70', cladiri: '20' });
    await page.reload();
    await waitForEngineEvent(page, 'hcm-ready');
    await expectColourAt(
        page,
        await mapFraction(page, 0.25, 0.2),
        blend(E2E_TILESET_LAYER.colour, BASEMAP_BACKGROUND, 0.4),
        'the layer at 40 % after the reload',
    );
    await openLayers(page, lang);
    await expect(opacitySlider(page, lang, LAYER_LABEL)).toHaveAttribute('aria-valuenow', '40');
    await openPhotoOptions(page, lang);
    await expect(opacitySlider(page, lang, t(lang, 'layers.photos'))).toHaveAttribute('aria-valuenow', '70');
    await expect(opacitySlider(page, lang, CATEGORY[lang])).toHaveAttribute('aria-valuenow', '20');
    await expect(opacitySlider(page, lang, STREETS[lang])).toHaveAttribute('aria-valuenow', '80');
    expect(await opEntries(page)).toEqual({ [E2E_TILESET_LAYER.id]: '40', photos: '70', cladiri: '20' });
});

test(
    'Opacities out of range in the hash are clamped and written back clamped',
    { tag: '@S-V23-BAD-OUT-OF-RANGE' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}&op=${E2E_TILESET_LAYER.id}:150,photos:-20` });

        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), E2E_TILESET_LAYER.colour, '150 % draws the layer at 100 %');
        // 0 is never written back (the owner, 2026-11-22): photos clamped to 0 leave the link, the layer's 100 % is its default.
        await expect.poll(() => opEntries(page)).toEqual({});
        await openLayers(page, lang);
        await expect(opacitySlider(page, lang, LAYER_LABEL)).toHaveAttribute('aria-valuenow', '100');
        await openPhotoOptions(page, lang);
        await expect(opacitySlider(page, lang, t(lang, 'layers.photos'))).toHaveAttribute('aria-valuenow', '0');
    },
);

test('Unknown overlays and unreadable entries in the hash are ignored', { tag: '@S-V23-BAD-UNKNOWN-OVERLAY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&op=ghost:50,cladiri:abc,photos:10:5` });

    await expectColourAt(page, await mapFraction(page, 0.5, 0.3), BASEMAP_BACKGROUND, 'nothing changed on the map');
    await expect.poll(() => hashParam(page, 'op')).toBeNull();
    await openLayers(page, lang);
    await expect(opacitySlider(page, lang, LAYER_LABEL)).toHaveAttribute('aria-valuenow', '100');
    await openPhotoOptions(page, lang);
    await expect(opacitySlider(page, lang, t(lang, 'layers.photos'))).toHaveAttribute('aria-valuenow', '100');
    await expect(opacitySlider(page, lang, CATEGORY[lang])).toHaveAttribute('aria-valuenow', '100');
    await expect(opacitySlider(page, lang, STREETS[lang])).toHaveAttribute('aria-valuenow', '80');
});
