import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { unplacedManifest } from '../../tour/unplaced-states.js';
import { mapFacts, mapIdle, renderedFeatureIds, renderedPoints, screenPointOf, type LngLat, type ScreenPoint } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, currentHash, hashParam, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * "Show on map" in a photo's details (behaviour V51, the owner on 2026-11-08): the camera goes to the photo's place, zoomed in
 * as far as its view cone shows, and the place ends in the part of the map the sheet leaves (above a bottom sheet, beside a
 * side sheet, anywhere on the map beside a docked pane); a ring marks it, the sheet stays open and the address follows the
 * camera (the photo's place, not the visitor's). Without a map, and for a photo with no place, there is no such button.
 */

/** A photo with a view cone and no neighbour within 300 m (photos.spec.ts). */
const LONE = 'strandul-opereta-1976';
/** About 3 km north-west of it: the photo's place is off the screen at every viewport. */
const FAR_VIEW = '15/44.44500/26.06000';

function placeOf(id: string): LngLat {
    const photos = siteManifestData()['photos'] as readonly { readonly id: string; readonly location: { lat: number; lng: number } }[];
    const found = photos.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(`no photo ${id} in the fixture`);
    }
    return [found.location.lng, found.location.lat];
}

interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** Runs in the page: the map's box and, while a modal sheet is open, the box of its surface (what covers the map). */
function boxesInPage(): { readonly map: Box | null; readonly sheet: Box | null } {
    const root = document.querySelector('hcm-map-viewer')?.shadowRoot;
    const sheet = root?.querySelector('hcm-photo-sheet')?.shadowRoot?.querySelector('hcm-sheet[open]')?.shadowRoot?.querySelector('.sheet');
    const box = (element: Element | null | undefined): Box | null => {
        const rect = element?.getBoundingClientRect();
        return rect === undefined ? null : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    return { map: box(root?.querySelector('.map')), sheet: box(sheet) };
}

function inside(point: ScreenPoint, box: Box | null, margin: number): boolean {
    return (
        box !== null &&
        point.x >= box.left + margin &&
        point.x <= box.right - margin &&
        point.y >= box.top + margin &&
        point.y <= box.bottom - margin
    );
}

/** Whether the visitor sees `lngLat`: on the map, and not under the sheet's surface. */
async function seen(page: Page, lngLat: LngLat): Promise<boolean> {
    const point = await screenPointOf(page, lngLat);
    const boxes = await page.evaluate(boxesInPage);
    return inside(point, boxes.map, 8) && !inside(point, boxes.sheet, -8);
}

test(
    'Show on map brings a photo opened far away into the part of the map its sheet leaves, ringed, the address following',
    { tag: '@S-V51-HAPPY-LOCATE' },
    async ({ page, lang }) => {
        const place = placeOf(LONE);
        await openViewer(page, { lang, hash: `${FAR_VIEW}&photo=${LONE}` });
        const title = viewer(page).locator('hcm-photo-sheet').getByRole('heading', { level: 2 });
        await expect(title).toBeVisible();
        expect(await seen(page, place), 'the photo opens far from its place').toBe(false);

        await viewer(page)
            .getByRole('button', { name: t(lang, 'photo.locate'), exact: true })
            .click();

        await expect.poll(async () => (await mapFacts(page)).zoom, { message: 'zoomed in to its cone' }).toBeGreaterThanOrEqual(17);
        await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the flight ends' }).toBe(false);
        await mapIdle(page);
        expect(await seen(page, place), 'the place is in the part of the map the sheet leaves').toBe(true);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toContain(LONE);
        await expect.poll(async () => (await renderedPoints(page, 'hcm-photo-mark')).length, { message: 'a ring marks it' }).toBe(1);
        await expect(title).toBeVisible();
        await expect.poll(async () => Number((await currentHash(page)).split('/')[0])).toBeGreaterThanOrEqual(17);
        expect(await hashParam(page, 'photo')).toBe(LONE);
    },
);

test(
    'A second Show on map during the flight still rings the place where the camera lands',
    { tag: '@S-V51-BAD-INTERRUPTED' },
    async ({ page, lang }) => {
        const place = placeOf(LONE);
        await openViewer(page, { lang, hash: `${FAR_VIEW}&photo=${LONE}` });
        const locate = viewer(page).getByRole('button', { name: t(lang, 'photo.locate'), exact: true });

        await locate.click();
        expect((await mapFacts(page)).moving, 'the first flight is under way').toBe(true);
        // Mapbox stops that flight first, firing its moveend at once: the ring must outlive it and the new flight's own.
        await locate.click();

        await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the flight ends' }).toBe(false);
        await mapIdle(page);
        await expect.poll(async () => (await renderedPoints(page, 'hcm-photo-mark')).length, { message: 'a ring marks it' }).toBe(1);
        expect(await seen(page, place), 'the place is in the part of the map the sheet leaves').toBe(true);
    },
);

test('A photo with no place has no Show on map in its gallery', { tag: '@S-V51-BAD-UNPLACED' }, async ({ page }) => {
    await serveManifest(page, unplacedManifest());
    await openViewer(page, { lang: 'en' });
    await chooseMenuItem(page, 'en', t('en', 'unplaced.title'));

    const gallery = viewer(page).locator('hcm-unplaced-gallery');
    await expect(gallery.getByRole('listitem')).toHaveCount(1);
    await expect(viewer(page).getByRole('button', { name: t('en', 'photo.locate'), exact: true })).toHaveCount(0);
});
