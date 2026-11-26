import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { mapFacts, mapIdle, screenPointOf } from '../../../support/map.js';
import { adminVisit } from '../../../tour/states.js';
import { SCAN_TILE } from '../../support/imagery-images.js';
import { scanPixelOf, scanToGeo, SCAN_PREVIEW_SCALE, SCAN_SIZE, type LatLng, type Pixel } from '../../support/imagery-geometry.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { georefText, landmark, openGeoreferencer, pairRows, pointInView, removePair, scanCentre, scanPane, showPane } from './georef.js';
import { readyImagery } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer while a pair is placed (behaviour A16; the owner's 1966 Corona frames, 2026-11-12): the scan keeps its zoom and
 * centre when a pair is added and when the window changes size; while a pair waits for its second click neither pane moves (the
 * views linked or not), and the place the pairs so far expect is a dashed ring on the other pane, named by the hint; with fewer than
 * two pairs and no fit there is none. Zoomed past the preview's own pixels, the pane fetches and draws the sharper scan.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The georeferencer page's JavaScript heap with a scan zoomed in (the resource audit of 2026-11-12: 300 MB). */
const HEAP_BUDGET_BYTES = 300 * 1024 * 1024;

type Lang = 'ro' | 'en';

type End = { readonly pixel: Pixel } | { readonly geo: LatLng };

/** The store's pending pair as the page shows it: its first end (`half`) and where the pairs so far expect the other (`ghost`). */
async function pendingPair(page: Page): Promise<{ readonly half: End | null; readonly ghost: End | null }> {
    return page.locator('hcm-georef-page').evaluate((element) => {
        const view = (element as unknown as { view: { half: End | null; ghost: End | null } | null }).view;
        return { half: view?.half ?? null, ghost: view?.ghost ?? null };
    });
}

/** The pending pair once its ghost is shown (it comes with the lazy chunk). */
async function ghostShown(page: Page): Promise<{ readonly half: End | null; readonly ghost: End | null }> {
    await expect.poll(async () => (await pendingPair(page)).ghost).not.toBeNull();
    return pendingPair(page);
}

/** The pixel of a pending pair's end that is on the scan. */
function pixelOf(end: End | null): Pixel {
    if (end === null || !('pixel' in end)) {
        throw new Error('the pending end is not on the scan');
    }
    return end.pixel;
}

/** The place of a pending pair's end that is on the map. */
function geoOf(end: End | null): LatLng {
    if (end === null || !('geo' in end)) {
        throw new Error('the pending end is not on the map');
    }
    return end.geo;
}

/** Metres between two nearby places (flat Earth: the landmarks are a few kilometres apart). */
function metresBetween(a: LatLng, b: LatLng): number {
    const north = (a.lat - b.lat) * 111_320;
    const east = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(north, east);
}

/** The newest pair's place. */
async function lastPairPlace(page: Page): Promise<LatLng> {
    return page.locator('hcm-georef-page').evaluate((element) => {
        const pairs = (element as unknown as { view: { pairs: readonly { geo: LatLng }[] } }).view.pairs;
        return pairs[pairs.length - 1]?.geo ?? { lat: 0, lng: 0 };
    });
}

/** Where a full-resolution scan pixel is on the page with the scan as it shows now (zoomed or not). */
async function scanPointNow(page: Page, pixel: { readonly x: number; readonly y: number }): Promise<{ x: number; y: number }> {
    const viewer = page.locator('hcm-scan-viewer');
    // A compact window shows the pane below the tools: in view first, or the pointer would land outside the window.
    await viewer.scrollIntoViewIfNeeded();
    const box = await viewer.boundingBox();
    const view = await viewer.evaluate(
        (element) => (element as unknown as { view: { scale: number; offset: { x: number; y: number } } }).view,
    );
    const across = SCAN_PREVIEW_SCALE * view.scale;
    return { x: (box?.x ?? 0) + view.offset.x + pixel.x * across, y: (box?.y ?? 0) + view.offset.y + pixel.y * across };
}

/** The wheel over a scan pixel: the scan zooms in about it (it stays under the pointer). */
async function zoomScanAt(page: Page, pixel: { readonly x: number; readonly y: number }, delta = -600): Promise<void> {
    const before = (await scanCentre(page)).scale;
    const at = await scanPointNow(page, pixel);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, delta);
    await expect.poll(async () => (await scanCentre(page)).scale).toBeGreaterThan(before);
}

/** Add pairs, unless it is on (pressed). */
async function addingPairs(page: Page, lang: Lang): Promise<void> {
    const toggle = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addPairs') });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
        await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** The map's camera (its centre and zoom) once it is idle, the map pane shown. */
async function mapCamera(page: Page, lang: Lang): Promise<{ readonly center: readonly number[]; readonly zoom: number }> {
    await showPane(page, lang, 'map');
    await mapIdle(page);
    const { center, zoom } = await mapFacts(page);
    return { center, zoom };
}

async function opened(fixtures: Parameters<typeof readyImagery>[0], uid: string, page: Page, lang: Lang, linked = false): Promise<void> {
    const imagery = await readyImagery(fixtures, uid);
    await imagery.script({ attempts: [{ outcome: 'no-match' }] });
    await openGeoreferencer(page, lang, { linked });
    // The four corner pairs of the frame that found too few.
    await expect(pairRows(page, lang)).toHaveCount(4);
}

test(
    'A pair added and a narrower window keep the scan where the owner zoomed it',
    { tag: '@S-A16-HAPPY-GEOREF-KEEP-ZOOM' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        const place = landmark(0);
        const pixel = scanPixelOf(place);
        await zoomScanAt(page, pixel);
        const zoomed = await scanCentre(page);

        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, pixel);
        await page.mouse.click(onScan.x, onScan.y);
        await showPane(page, lang, 'map');
        const onMap = await pointInView(page, lang, [place.lng, place.lat]);
        await page.mouse.click(onMap.x, onMap.y);
        await expect(pairRows(page, lang)).toHaveCount(5);
        await showPane(page, lang, 'scan');
        const after = await scanCentre(page);
        expect(after.scale, 'the zoom after a pair is added').toBeCloseTo(zoomed.scale, 9);
        expect(Math.hypot(after.x - zoomed.x, after.y - zoomed.y), 'the centre after a pair is added').toBeLessThan(1);

        // A scrollbar's width less (the page grew taller below): the same zoom and the same place in the middle.
        const size = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.setViewportSize({ width: size.width - 15, height: size.height });
        await expect
            .poll(async () => {
                const now = await scanCentre(page);
                return Math.hypot(now.x - zoomed.x, now.y - zoomed.y) < 1 && Math.abs(now.scale - zoomed.scale) < 1e-9;
            })
            .toBe(true);
    },
);

test(
    'A scan never zoomed still shows the whole frame after the window changes',
    { tag: '@S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        const viewer = page.locator('hcm-scan-viewer');
        const before = (await viewer.boundingBox())?.width ?? 0;

        const size = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.setViewportSize({ width: size.width - 40, height: size.height });
        await expect.poll(async () => (await viewer.boundingBox())?.width ?? 0).toBeLessThan(before);

        // Fitted again to the narrower pane: the frame's middle at the centre, at the scale that shows the whole frame (no zoom kept).
        const box = (await viewer.boundingBox()) ?? { width: 0, height: 0 };
        const fit =
            Math.min(box.width / (SCAN_SIZE.width * SCAN_PREVIEW_SCALE), box.height / (SCAN_SIZE.height * SCAN_PREVIEW_SCALE)) *
            SCAN_PREVIEW_SCALE;
        await expect.poll(async () => Math.abs((await scanCentre(page)).scale - fit)).toBeLessThan(1e-6);
        const now = await scanCentre(page);
        expect(Math.hypot(now.x - SCAN_SIZE.width / 2, now.y - SCAN_SIZE.height / 2)).toBeLessThan(1);
    },
);

test(
    'While a pair waits for its second click the panes stand still and a dashed ring shows the expected place',
    { tag: '@S-A16-HAPPY-GEOREF-GHOST' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang, true);
        const place = landmark(1);
        const pixel = scanPixelOf(place);
        // Linked: zooming the scan on the landmark brings the map there.
        await zoomScanAt(page, pixel, -300);

        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, pixel);
        await page.mouse.click(onScan.x, onScan.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toBeVisible();
        // The ring is where the fit puts the clicked scan pixel (the stand-in's frame is affine: the place itself).
        const scanFirst = await ghostShown(page);
        const ring = geoOf(scanFirst.ghost);
        expect(metresBetween(ring, scanToGeo(pixelOf(scanFirst.half))), 'the ring from the place the scan click shows').toBeLessThan(60);
        expect(metresBetween(ring, place), 'the ring from the landmark').toBeLessThan(60);
        const still = await mapCamera(page, lang);
        await expectStateSound(page, adminVisit('georef.ghost', lang));

        // The owner zooms the scan once more before the map's click: the map does not move to the place the fit expects.
        await showPane(page, lang, 'scan');
        await zoomScanAt(page, pixel, -200);
        expect(await mapCamera(page, lang)).toEqual(still);

        // A click on the ring's very centre goes through it (it takes no click of its own) and makes the pair there.
        const onRing = await pointInView(page, lang, [ring.lng, ring.lat]);
        await page.mouse.click(onRing.x, onRing.y);
        await expect(pairRows(page, lang)).toHaveCount(5);
        const pairPlace = await lastPairPlace(page);
        const made = await screenPointOf(page, [pairPlace.lng, pairPlace.lat]);
        const ringNow = await screenPointOf(page, [ring.lng, ring.lat]);
        expect(Math.hypot(made.x - ringNow.x, made.y - ringNow.y), 'the pair is where the ring was clicked').toBeLessThan(2);

        // The other way round: the map first, then the scan, which stands still while the map zooms.
        const second = landmark(2);
        await showPane(page, lang, 'map');
        const first = await pointInView(page, lang, [second.lng, second.lat]);
        await page.mouse.click(first.x, first.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnMapGhost'))).toBeVisible();
        // The ring on the scan is the pixel that shows the clicked place, and it is what the scan pane draws.
        const mapFirst = await ghostShown(page);
        const expected = scanPixelOf(geoOf(mapFirst.half));
        const ghostPixel = pixelOf(mapFirst.ghost);
        expect(Math.hypot(ghostPixel.x - expected.x, ghostPixel.y - expected.y), 'the ring from the clicked place').toBeLessThan(3);
        // The map click started the next pair and left the pair just made where it was (it once moved there too).
        expect(metresBetween(await lastPairPlace(page), pairPlace), 'the pair made before').toBeLessThan(1);
        const drawn = await page.locator('hcm-scan-viewer').evaluate((viewer) => (viewer as unknown as { ghost: unknown }).ghost);
        expect(drawn).toEqual(ghostPixel);
        await showPane(page, lang, 'scan');
        const scanBefore = await scanCentre(page);
        await showPane(page, lang, 'map');
        await page
            .locator('hcm-admin-map')
            .getByRole('button', { name: georefText(lang, 'adminContent.map.zoomIn'), exact: true })
            .click();
        await mapIdle(page);
        await showPane(page, lang, 'scan');
        expect(await scanCentre(page)).toEqual(scanBefore);
    },
);

test(
    'With two pairs the ghost comes from their likeness; with one pair and no fit there is none',
    { tag: '@S-A16-BAD-GEOREF-GHOST-NO-PAIRS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        // Two of the four corner pairs left: no fit, but their similarity tells where a scan point lies.
        await removePair(page, lang, 4);
        await removePair(page, lang, 3);
        await expect(pairRows(page, lang)).toHaveCount(2);
        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, scanPixelOf(landmark(0)));
        await page.mouse.click(onScan.x, onScan.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toBeVisible();
        // Esc on the scan drops the half pair (and its ghost).
        await showPane(page, lang, 'scan');
        await scanPane(page, lang).focus();
        await page.keyboard.press('Escape');
        await expect(page.getByText(georefText(lang, 'adminContent.georef.addingHint'))).toBeVisible();

        // One pair: nothing to tell where, only the plain hint.
        await removePair(page, lang, 2);
        await expect(pairRows(page, lang)).toHaveCount(1);
        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const again = await scanPointNow(page, scanPixelOf(landmark(0)));
        await page.mouse.click(again.x, again.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScan'))).toBeVisible();
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toHaveCount(0);
    },
);

/** The page's requests for the version's sharper scan, from now on. */
function detailRequests(page: Page): string[] {
    const asked: string[] = [];
    page.on('request', (request) => {
        if (decodeURIComponent(request.url()).includes('scan-tiles.bin')) {
            asked.push(request.url());
        }
    });
    return asked;
}

/** The scan's CSS px a scan pixel times the device's pixel ratio: past `SCAN_PREVIEW_SCALE`, a preview pixel is upscaled. */
async function devicePixelsPerScanPixel(page: Page): Promise<number> {
    const ratio = await page.evaluate(() => Math.max(globalThis.devicePixelRatio, 1));
    return (await scanCentre(page)).scale * ratio;
}

/** Zooms the scan in about `pixel` until a preview pixel covers more than one device pixel. */
async function zoomPastPreview(page: Page, pixel: Pixel): Promise<void> {
    await expect(async () => {
        await zoomScanAt(page, pixel, -300);
        expect(await devicePixelsPerScanPixel(page)).toBeGreaterThan(SCAN_PREVIEW_SCALE);
    }).toPass();
}

/** The sharper scan the scan pane was handed: its scale and its file's bytes (null: none). */
async function paneDetail(page: Page): Promise<{ readonly scale: number; readonly bytes: number } | null> {
    return page.locator('hcm-scan-viewer').evaluate((viewer) => {
        const detail = (viewer as unknown as { detail: { file: Blob; scale: number } | null }).detail ?? null;
        return detail === null ? null : { scale: detail.scale, bytes: detail.file.size };
    });
}

/** Counts the pictures the page decodes from now on (`createImageBitmap`: the sharper scan's tiles), with each one's size. */
async function countDecodes(page: Page): Promise<void> {
    await page.evaluate(() => {
        const sizes: number[][] = [];
        const native = globalThis.createImageBitmap.bind(globalThis);
        Object.assign(globalThis, {
            hcmDecoded: sizes,
            createImageBitmap: async (source: ImageBitmapSource) => {
                const bitmap = await native(source);
                sizes.push([bitmap.width, bitmap.height]);
                return bitmap;
            },
        });
    });
}

async function decodes(page: Page): Promise<readonly (readonly number[])[]> {
    return page.evaluate(() => (globalThis as unknown as { hcmDecoded: number[][] }).hcmDecoded);
}

test(
    "Zoomed past the preview's own pixels the scan pane fetches and draws the sharper scan",
    { tag: '@S-A16-HAPPY-GEOREF-FULL-RES' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const asked = detailRequests(page);
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        expect(asked, 'the whole frame needs only the preview').toEqual([]);

        await countDecodes(page);
        // Zoomed in until a preview pixel covers more than one device pixel (a phone's two device px a CSS px: sooner).
        const pixel = scanPixelOf(landmark(0));
        await zoomPastPreview(page, pixel);
        await expect.poll(() => asked.length).toBe(1);
        await expect.poll(async () => (await paneDetail(page))?.scale).toBe(1);
        expect((await paneDetail(page))?.bytes).toBeGreaterThan(1000);

        // Only tiles are decoded, none larger than a tile: the 1600 × 1200 sharper scan is twelve tiles of 400 px, never one picture.
        await expect.poll(async () => (await decodes(page)).length).toBeGreaterThan(0);
        // Zoomed in further: fetched once a version; the tiles already decoded are drawn again, no tile twice.
        await zoomScanAt(page, pixel, -900);
        const sizes = await decodes(page);
        expect(sizes.length).toBeLessThanOrEqual(12);
        expect(Math.max(...sizes.flat())).toBeLessThanOrEqual(SCAN_TILE);
        // The page's JavaScript heap with the sharper scan zoomed in: within the georeferencer's 300 MB budget (the resource audit).
        const session = await page.context().newCDPSession(page);
        await session.send('Performance.enable');
        const { metrics } = await session.send('Performance.getMetrics');
        const heap = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? Number.POSITIVE_INFINITY;
        expect(heap).toBeLessThan(HEAP_BUDGET_BYTES);
        expect(asked).toHaveLength(1);
    },
);

test(
    'A scan never zoomed past its preview fetches no sharper scan',
    { tag: '@S-A16-BAD-GEOREF-FULL-RES-NONE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const asked = detailRequests(page);
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        expect(await devicePixelsPerScanPixel(page)).toBeLessThanOrEqual(SCAN_PREVIEW_SCALE);

        // A pair placed on the whole frame: still the preview, nothing fetched and nothing handed to the pane.
        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, scanPixelOf(landmark(0)));
        await page.mouse.click(onScan.x, onScan.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toBeVisible();
        expect(asked).toEqual([]);
        expect(await paneDetail(page)).toBeNull();
    },
);

test(
    'The selected pair is removed from beside the panes and from the map with Delete, and the notice puts it back',
    { tag: '@S-A16-HAPPY-GEOREF-REMOVE-UNDO' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        const pairName = (number: number): string => georefText(lang, 'adminContent.georef.pairName', { number: String(number) });
        const removed = (number: number) =>
            page
                .locator('hcm-snackbar')
                .filter({ hasText: georefText(lang, 'adminContent.georef.pairRemoved', { number: String(number) }) });

        // Add pairs on, as while placing points (its hint also keeps Mapbox's logo clear of the page's top edge in the scroll sweep).
        await addingPairs(page, lang);
        // Pair 2 chosen in the table: its Delete button is beside the panes.
        await page.getByRole('button', { name: pairName(2), exact: true }).click();
        // Named as the row's own Delete: found by what it is.
        await expect(page.locator('[data-action="delete-selected"]')).toContainText(
            georefText(lang, 'adminContent.georef.deleteSelected', { number: '2' }),
        );
        await page.locator('[data-action="delete-selected"]').click();
        await expect(pairRows(page, lang)).toHaveCount(3);
        await expect(removed(2)).toBeVisible();
        // Undo in the notice: the pair is back, second in the list, and nothing is left to save.
        await removed(2)
            .getByRole('button', { name: georefText(lang, 'adminContent.georef.pairRemovedUndo') })
            .click();
        await expect(pairRows(page, lang)).toHaveCount(4);
        // Checked once the notice is gone: the snackbar floats over the page, and the scroll sweep would slide the map's
        // Mapbox logo under its Undo (a meeting of a fixed notice and scrolled content, not of the page's own layout).
        await expect(removed(2)).toHaveCount(0);
        await expectStateSound(page, adminVisit('georef.pair-removed', lang));

        // Delete on the map pane removes the chosen pair too.
        await page.getByRole('button', { name: pairName(3), exact: true }).click();
        await showPane(page, lang, 'map');
        await page.locator('hcm-admin-map').getByRole('application').focus();
        await page.keyboard.press('Delete');
        await expect(pairRows(page, lang)).toHaveCount(3);
        await expect(removed(3)).toBeVisible();
    },
);

test(
    'With no pair chosen there is no Delete button and Delete on the map removes nothing',
    { tag: '@S-A16-BAD-GEOREF-REMOVE-NOTHING' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        await expect(page.locator('[data-action="delete-selected"]')).toHaveCount(0);
        await showPane(page, lang, 'map');
        await page.locator('hcm-admin-map').getByRole('application').focus();
        await page.keyboard.press('Delete');
        await page.keyboard.press('Backspace');
        await expect(pairRows(page, lang)).toHaveCount(4);
        await expect(
            page.locator('hcm-snackbar').filter({ hasText: georefText(lang, 'adminContent.georef.pairRemoved', { number: '1' }) }),
        ).toHaveCount(0);
    },
);
