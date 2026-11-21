import { translateAdminContent } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { landmarks, scanPixelOf, SCAN_PREVIEW_SCALE, SCAN_SIZE, type LatLng } from '../../support/imagery-geometry.js';
import { adminMapReady, mapPointOf } from '../../support/map.js';
import { detail, imageryText, importFromList, versionState } from './world.js';

/**
 * The georeferencer's world for its specs (docs/research/M3-interfaces.md §10.4): a scene whose automatic georeferencing
 * found too few pairs (the stand-in's `no-match`: four corner pairs), opened in the georeferencer, and where a person
 * clicks to pair a landmark: on the scan at the pixel the scan's known transform puts it (e2e/admin/support/
 * imagery-geometry.ts), on the reference map at its place. The scan pane shows the whole preview centred until zoomed; the specs
 * open it with Link the views off (a map zoomed to find a place would otherwise move the scan too), all but georef-linked.spec.ts.
 */

const SCENE = 'DS1035-1057DA023';

/** A georeferencer text. */
export function georefText(
    lang: 'ro' | 'en',
    key: Parameters<typeof translateAdminContent>[1],
    params: Readonly<Record<string, string>> = {},
): string {
    return translateAdminContent(lang, key, params);
}

/**
 * Imports the 1966 frame (the spec scripted its first attempt to find too few pairs) and opens its georeferencer from the
 * version's page; the version id.
 */
export async function openGeoreferencer(page: Page, lang: 'ro' | 'en', options: ReadyOptions = {}): Promise<string> {
    const versionId = await importFromList(page, lang, SCENE);
    await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await detail(page)
        .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
        .click();
    await georeferencerReady(page, lang, options);
    return versionId;
}

interface ReadyOptions {
    /** Keep Link the views as the page opens it (on once a fit exists); else it is turned off. */
    readonly linked?: boolean;
}

/** The toggle Link the views. */
export function linkViews(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: georefText(lang, 'adminContent.georef.linkViews'), exact: true });
}

/** The pages opened with Link the views off: a version with no fit gets one later (the toggle is enabled, and on, only then). */
const UNLINKED = new WeakSet<Page>();

/** Turns Link the views off where the page was opened unlinked and the toggle is now on (a fit appeared). */
async function keepUnlinked(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const toggle = linkViews(page, lang);
    if (UNLINKED.has(page) && (await toggle.getAttribute('aria-pressed')) === 'true') {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    }
}

/**
 * The georeferencer is open and settled: the map first (its centre is the keyboard's crosshair), then the scan; Link the views off
 * unless `linked`.
 */
export async function georeferencerReady(page: Page, lang: 'ro' | 'en', { linked = false }: ReadyOptions = {}): Promise<void> {
    await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeVisible();
    await showPane(page, lang, 'map');
    await showPane(page, lang, 'scan');
    if (linked) {
        UNLINKED.delete(page);
        return;
    }
    UNLINKED.add(page);
    await keepUnlinked(page, lang);
}

/** The fit's errors line (`Fit error: … m`, then the checkpoints' error or why there is none). */
export function errorsLine(page: Page): Locator {
    return page.locator('hcm-georef-page p.summary');
}

/**
 * Shows one pane where the window shows one at a time (a compact window: the Scan | Map switch), and waits for it; both
 * panes show side by side from a medium window, where there is nothing to switch.
 */
export async function showPane(page: Page, lang: 'ro' | 'en', pane: 'scan' | 'map'): Promise<void> {
    const switcher = page.getByRole('radiogroup', { name: georefText(lang, 'adminContent.georef.pane.label') });
    if (await switcher.isVisible()) {
        await switcher.getByRole('radio', { name: georefText(lang, `adminContent.georef.pane.${pane}`) }).click();
    }
    await (pane === 'scan' ? expect(scanPane(page, lang)).toBeVisible() : adminMapReady(page));
}

/** The scan pane (an application: it takes the arrow keys). */
export function scanPane(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('application', { name: georefText(lang, 'adminContent.georef.scanLabel') });
}

/** The table of pairs. */
function pairsTable(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('table', { name: georefText(lang, 'adminContent.georef.tableCaption') });
}

/** The pairs' rows (the header row left out). */
export function pairRows(page: Page, lang: 'ro' | 'en'): Locator {
    return pairsTable(page, lang)
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader') });
}

/** Where a full-resolution scan pixel is on the page, the scan shown whole (fitted and centred in its pane). */
export async function scanPointOf(
    page: Page,
    lang: 'ro' | 'en',
    pixel: { readonly x: number; readonly y: number },
): Promise<{ x: number; y: number }> {
    await scanPane(page, lang).scrollIntoViewIfNeeded();
    const box = await scanPane(page, lang).boundingBox();
    expect(box, 'the scan pane is on the page').not.toBeNull();
    const pane = box ?? { x: 0, y: 0, width: 0, height: 0 };
    const width = SCAN_SIZE.width * SCAN_PREVIEW_SCALE;
    const height = SCAN_SIZE.height * SCAN_PREVIEW_SCALE;
    const scale = Math.min(pane.width / width, pane.height / height);
    return {
        x: pane.x + (pane.width - width * scale) / 2 + pixel.x * SCAN_PREVIEW_SCALE * scale,
        y: pane.y + (pane.height - height * scale) / 2 + pixel.y * SCAN_PREVIEW_SCALE * scale,
    };
}

/**
 * The full-resolution scan pixel at the scan pane's centre (its crosshair) and the pane's CSS pixels a scan pixel, as the pane says
 * (`<hcm-scan-viewer>`'s `centre` and `view`): what a person sees in the middle of the scan, at what size.
 */
export async function scanCentre(page: Page): Promise<{ readonly x: number; readonly y: number; readonly scale: number }> {
    return page.locator('hcm-scan-viewer').evaluate((viewer, previewScale) => {
        const shown = viewer as unknown as { centre: { x: number; y: number }; view: { scale: number } };
        return { x: shown.centre.x, y: shown.centre.y, scale: shown.view.scale * previewScale };
    }, SCAN_PREVIEW_SCALE);
}

/**
 * The hint after a pair's scan end: the plain one, or the one that names the ghost's dashed ring once the pairs so far can tell
 * where the place is (two pairs or a fit; it comes a moment later, with the georeferencer's lazy chunk).
 */
export function halfOnScanHint(page: Page, lang: 'ro' | 'en'): Locator {
    return page
        .getByText(georefText(lang, 'adminContent.georef.halfOnScan'))
        .or(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost')));
}

/** The landmarks a spec pairs (vertices of the world inside the scan), far enough apart that a click never lands on another pair. */
const PAIRABLE = [1, 11, 17, 14, 6, 20];

/** The `index`-th landmark a spec pairs. */
export function landmark(index: number): LatLng {
    const place = landmarks()[PAIRABLE[index] ?? -1];
    if (place === undefined) {
        throw new Error(`the synthetic world has no landmark ${String(index)}`);
    }
    return place;
}

/** Turns the adding of pairs on (Add pairs), unless it still is from the last pair (the hint says so). */
async function addingPairs(page: Page, lang: 'ro' | 'en'): Promise<void> {
    if (!(await page.getByText(georefText(lang, 'adminContent.georef.addingHint')).isVisible())) {
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addPairs') }).click();
    }
}

/**
 * Adds one pair as a person does: Add pairs, a click on the scan where the landmark is, a click on the map at its place
 * (moved by `offsetMetres` east, for a pair that disagrees with the others).
 */
export async function addPair(page: Page, lang: 'ro' | 'en', place: LatLng, offsetMetres = 0): Promise<void> {
    await addingPairs(page, lang);
    // The hint above the panes appears first and moves them down: measure the scan where it now is.
    await expect(page.getByText(georefText(lang, 'adminContent.georef.addingHint'))).toBeVisible();
    await showPane(page, lang, 'scan');
    const scan = await scanPointOf(page, lang, scanPixelOf(place));
    await page.mouse.click(scan.x, scan.y);
    await expect(halfOnScanHint(page, lang)).toBeVisible();
    await showPane(page, lang, 'map');
    const lng = place.lng + offsetMetres / (111_320 * Math.cos((place.lat * Math.PI) / 180));
    const point = await pointInView(page, lang, [lng, place.lat]);
    await page.mouse.click(point.x, point.y);
    await showPane(page, lang, 'scan');
    await keepUnlinked(page, lang);
}

/**
 * Where a place is drawn on the reference map once it is in view: the map follows the selected pair closely, so a place
 * further away is brought in with Zoom out, as a person does.
 */
export async function pointInView(
    page: Page,
    lang: 'ro' | 'en',
    lngLat: [number, number],
): Promise<{ readonly x: number; readonly y: number }> {
    const map = page.locator('hcm-admin-map');
    const zoomOut = map.getByRole('button', { name: georefText(lang, 'adminContent.map.zoomOut'), exact: true });
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const point = await mapPointOf(page, lngLat);
        const box = await map.boundingBox();
        const margin = 40;
        const inside =
            box !== null &&
            point.x > box.x + margin &&
            point.x < box.x + box.width - margin &&
            point.y > box.y + margin &&
            point.y < box.y + box.height - margin;
        if (inside) {
            return point;
        }
        await zoomOut.click();
    }
    return mapPointOf(page, lngLat);
}

/** Deletes pair `number` with its row's Remove button. */
export async function removePair(page: Page, lang: 'ro' | 'en', number: number): Promise<void> {
    const name = georefText(lang, 'adminContent.georef.pairName', { number: String(number) });
    await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.remove', { name }), exact: true }).click();
}

/** A transform's radio (its name starts with the transform's own text; the missing count may follow). */
export function transformRadio(page: Page, lang: 'ro' | 'en', kind: 'affine' | 'poly2' | 'tps'): Locator {
    return page.getByRole('radio', { name: georefText(lang, `adminContent.georef.transform.${kind}`) });
}

/** A visible box's top and height. */
async function topAndHeight(locator: Locator): Promise<{ readonly top: number; readonly height: number }> {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    return { top: box?.y ?? Number.NaN, height: box?.height ?? Number.NaN };
}

/** The scan's and the map's view, and the turn row under each, as the person sees them (one at a time on a compact window). */
async function paneBoxes(
    page: Page,
    lang: 'ro' | 'en',
    pane: 'scan' | 'map',
): Promise<{ view: { top: number; height: number }; turn: number }> {
    await showPane(page, lang, pane);
    const view = await topAndHeight(page.locator(pane === 'scan' ? 'hcm-scan-viewer' : 'hcm-admin-map'));
    const turn = await topAndHeight(page.getByRole('group', { name: georefText(lang, `adminContent.georef.turn.${pane}`) }));
    return { view, turn: turn.top };
}

/**
 * The two panes line up (the owner's report of 2026-11-13: the map's list pushed the map 80 px below the scan): the scan's and
 * the map's views share their top and height within 1 px, and so do the turn rows under them; on a compact window the map
 * shown by the switch sits where the scan sat. Leaves the pane that was shown.
 */
export async function expectPanesAligned(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const shown = (await page.locator('.panes').getAttribute('data-pane')) === 'map' ? 'map' : 'scan';
    const other = shown === 'map' ? 'scan' : 'map';
    const boxes = { [other]: await paneBoxes(page, lang, other), [shown]: await paneBoxes(page, lang, shown) };
    const { scan, map } = boxes as Record<'scan' | 'map', Awaited<ReturnType<typeof paneBoxes>>>;
    expect(Math.abs(scan.view.top - map.view.top), 'the panes share their top').toBeLessThanOrEqual(1);
    expect(Math.abs(scan.view.height - map.view.height), 'the panes share their height').toBeLessThanOrEqual(1);
    expect(Math.abs(scan.turn - map.turn), 'the turn rows share their top').toBeLessThanOrEqual(1);
}

/** Window sizes past the e2e projects' own: a tablet on its side, a wide screen and the owner's (about 2000 × 1125). */
const WIDE_SIZES = [
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2000, height: 1125 },
] as const;

/**
 * The panes line up at each of the wide sizes too, the window put back after. A phone project (emulated as a touch phone, its
 * layout wider than its window once resized) checks its own size only.
 */
export async function expectPanesAlignedAtSizes(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const own = page.viewportSize();
    if (own === null || own.width < 768) {
        return;
    }
    for (const size of WIDE_SIZES) {
        await page.setViewportSize(size);
        await expectPanesAligned(page, lang);
    }
    await page.setViewportSize(own);
}
