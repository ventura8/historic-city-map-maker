import type { Locator, Page } from '@playwright/test';
import { destinationPoint, type Locale } from '@hcm/shared';

import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, type Rgb } from '../../fixtures/world.js';
import {
    blend,
    colourDistance,
    expectColourAt,
    mapFraction,
    mapIdle,
    probeArea,
    screenPointOf,
    type LngLat,
    type ScreenPoint,
} from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { openLayers,
    openPhotoOptions, openViewer, opacitySlider, t, visibilitySwitch } from '../../support/viewer.js';

/**
 * Live overlay opacity (behaviour V22, PLAN Addendum 3): every overlay of the Layers panel (a historical layer, the
 * photos, a POI category) has a 0–100 % slider whose value the map follows while it moves, before it is released.
 * Pixel probes read the synthetic colours of the e2e world (fixtures/world.ts) and the fixture POIs
 * (scripts/seed/e2e-pois.json); an overlay at a fraction of its opacity is the linear blend of the overlay at 100 %
 * and the map without it, which the probes check whatever the panel covers (a modal sheet's scrim included).
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';
/** An empty corner of the city (no photo, no POI within kilometres): only the basemap and the rasters draw here. */
const EMPTY_VIEW = '15/44.37000/25.97000';
const CATEGORY = { ro: 'Clădiri dispărute', en: 'Vanished buildings' } as const;
const STREETS = { ro: 'Străzi dispărute', en: 'Vanished streets' } as const;

/** A photo without others nearby and its view cone (bearing 35.6°, cones are 60 m long). */
const LONE_PHOTO = { location: [26.095447, 44.429359] as LngLat, bearing: 35.6 };
const LONE_PHOTO_VIEW = '18/44.42955/26.09560';
/** The fixture POIs (M1-interfaces §10) and probe spots away from labels, outlines and photo markers. */
const POI_VIEW = '16/44.42680/26.08720';
const CLADIRE: LngLat = [26.0872, 44.4285];
const CVARTAL_INSIDE: LngLat = [26.0863, 44.42695];
const STRADA_ON_LINE: LngLat = [26.0882, 44.42598];

const MIN_CONTRAST = 40;

/** The page point of the track position of `percent` on an `hcm-slider` whose handle is `handle`. */
async function trackPoint(handle: Locator, percent: number): Promise<ScreenPoint> {
    const box = await handle.evaluate((element) => {
        const rect = ((element.getRootNode() as ShadowRoot).host as HTMLElement).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    // The handle's centre travels the track minus the 16 px of the handle and its gaps (packages/ui slider.ts).
    return { x: box.x + 8 + (percent / 100) * (box.width - 16), y: box.y + box.height / 2 };
}

/** Sets a slider with the keyboard: Home, then PageUp (+10) and ArrowRight (+1) until `percent`. */
async function setWithKeys(slider: Locator, percent: number): Promise<void> {
    await slider.focus();
    await slider.press('Home');
    for (let step = 0; step < Math.floor(percent / 10); step += 1) {
        await slider.press('PageUp');
    }
    for (let step = 0; step < percent % 10; step += 1) {
        await slider.press('ArrowRight');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(percent));
}

/** Closes the Layers panel (Esc on a modal sheet; the docked pane's close button otherwise). */
async function closeLayers(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
    await mapIdle(page);
}

function expectContrast(top: Rgb, bottom: Rgb, what: string): void {
    expect(colourDistance(top, bottom), `${what} stands out from the map without it`).toBeGreaterThan(MIN_CONTRAST);
}

test('Dragging a historical layer slider fades the layer live, before release', { tag: '@S-V22-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
    const slider = opacitySlider(page, lang, LAYER_LABEL);
    await openLayers(page, lang);
    await slider.scrollIntoViewIfNeeded();
    await mapIdle(page);
    const probe = await mapFraction(page, 0.25, 0.2);
    const full = await probeArea(page, probe);

    const at100 = await trackPoint(slider, 100);
    await page.mouse.move(at100.x, at100.y);
    await page.mouse.down();
    const at0 = await trackPoint(slider, 0);
    await page.mouse.move(at0.x, at0.y, { steps: 4 });
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await mapIdle(page);
    const none = await probeArea(page, probe);
    expectContrast(full, none, 'the layer at 100 %');
    const at30 = await trackPoint(slider, 30);
    await page.mouse.move(at30.x, at30.y, { steps: 4 });
    await expect(slider).toHaveAttribute('aria-valuenow', '30');
    await expectColourAt(page, probe, blend(full, none, 0.3), 'the layer at 30 % while the slider is held');
    await page.mouse.up();

    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'layers.opacityValue', { percent: '30' }));
    await expect(
        page.getByRole('status').filter({ hasText: t(lang, 'layers.opacityChanged', { name: LAYER_LABEL, percent: '30' }) }),
    ).toBeAttached();
    await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toHaveAttribute('aria-checked', 'true');
});

test(
    'The photos slider at 50 % halves the contrast of the markers and the view cones',
    { tag: '@S-V22-HAPPY-PHOTOS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: LONE_PHOTO_VIEW });
        const marker = await screenPointOf(page, LONE_PHOTO.location);
        // The camera disc above its glyph (the view cone leaves it to the north-east), and the cone's axis.
        const onMarker = { x: marker.x, y: marker.y - 8 };
        const inCone = await screenPointOf(page, destinationPoint(LONE_PHOTO.location, LONE_PHOTO.bearing, 30));
        const markerFull = await probeArea(page, onMarker, 1);
        const coneFull = await probeArea(page, inCone);
        expectContrast(markerFull, BASEMAP_BACKGROUND, 'the camera marker');
        expect(colourDistance(coneFull, BASEMAP_BACKGROUND), 'the view cone is drawn').toBeGreaterThan(8);

        await openLayers(page, lang);
        await openPhotoOptions(page, lang);
        await setWithKeys(opacitySlider(page, lang, t(lang, 'layers.photos')), 50);
        await closeLayers(page, lang);

        await expectColourAt(page, onMarker, blend(markerFull, BASEMAP_BACKGROUND, 0.5), 'the marker at 50 %', { radius: 1 });
        await expectColourAt(page, inCone, blend(coneFull, BASEMAP_BACKGROUND, 0.5), 'the cone at 50 %', { tolerance: 4 });
    },
);

test('A POI category slider fades its icons and fills, not the other categories', { tag: '@S-V22-HAPPY-POI' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: POI_VIEW });
    const icon = await screenPointOf(page, CLADIRE);
    const onIcon = { x: icon.x, y: icon.y + 10 };
    const inBlock = await screenPointOf(page, CVARTAL_INSIDE);
    const onLine = await screenPointOf(page, STRADA_ON_LINE);
    const iconFull = await probeArea(page, onIcon, 1);
    const blockFull = await probeArea(page, inBlock);
    const lineBefore = await probeArea(page, onLine, 0);
    expectContrast(iconFull, BASEMAP_BACKGROUND, 'the point icon');
    expectContrast(lineBefore, BASEMAP_BACKGROUND, 'the street line');

    await openLayers(page, lang);
    await setWithKeys(opacitySlider(page, lang, CATEGORY[lang]), 20);
    await expect(opacitySlider(page, lang, STREETS[lang])).toHaveAttribute('aria-valuenow', '80');
    await closeLayers(page, lang);

    await expectColourAt(page, onIcon, blend(iconFull, BASEMAP_BACKGROUND, 0.2), 'the point icon at 20 %', { radius: 1 });
    await expectColourAt(page, inBlock, blend(blockFull, BASEMAP_BACKGROUND, 0.2), 'the block fill at 20 %', { tolerance: 4 });
    await expectColourAt(page, onLine, lineBefore, 'the street line keeps its opacity', { radius: 0 });
});

test(
    'Keyboard limits: End, Home and Page keys stop at 0 and 100 and keep the overlay listed',
    { tag: '@S-V22-BAD-KEYBOARD-LIMITS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
        await openLayers(page, lang);
        const slider = opacitySlider(page, lang, LAYER_LABEL);
        await slider.focus();

        await slider.press('End');
        await slider.press('ArrowRight');
        await expect(slider).toHaveAttribute('aria-valuenow', '100');
        await slider.press('PageDown');
        await expect(slider).toHaveAttribute('aria-valuenow', '90');
        await slider.press('PageDown');
        await expect(slider).toHaveAttribute('aria-valuenow', '80');
        await slider.press('PageUp');
        await expect(slider).toHaveAttribute('aria-valuenow', '90');
        await slider.press('Home');
        await slider.press('ArrowLeft');
        await slider.press('PageDown');
        await expect(slider).toHaveAttribute('aria-valuenow', '0');
        await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'layers.opacityValue', { percent: '0' }));

        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toHaveAttribute('aria-checked', 'true');
        await closeLayers(page, lang);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), BASEMAP_BACKGROUND, 'the layer at 0 % is invisible');
    },
);

test(
    'A hidden overlay stays hidden while its slider moves, then shows at the new opacity',
    { tag: '@S-V22-BAD-HIDDEN-OVERLAY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
        const probe = await mapFraction(page, 0.5, 0.3);
        const full = await probeArea(page, probe);
        expectContrast(full, BASEMAP_BACKGROUND, 'the layer at 100 %');
        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, LAYER_LABEL);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await setWithKeys(opacitySlider(page, lang, LAYER_LABEL), 60);
        await closeLayers(page, lang);
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'the hidden layer draws nothing');

        await openLayers(page, lang);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(opacitySlider(page, lang, LAYER_LABEL)).toHaveAttribute('aria-valuenow', '60');
        await closeLayers(page, lang);
        await expectColourAt(page, probe, blend(full, BASEMAP_BACKGROUND, 0.6), 'the layer shows at 60 %');
    },
);
