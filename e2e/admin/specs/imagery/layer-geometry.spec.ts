import type { LngLat } from '@hcm/shared';
import { publishedTileColour } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectColourAt, mapFacts, mapFraction, pixelsOfColour } from '../../../support/map.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { awaitManifest, entry, openPublicViewer } from '../../support/flows.js';
import { georeferencedTiff, writeUpload } from '../../support/imagery-files.js';
import { E2E_CITY_BOUNDS } from '../../support/imagery-geometry.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { adminMapReady } from '../../support/map.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { addPair, expectPanesAligned, georeferencerReady, georefText, landmark, showPane } from './georef.js';
import {
    bringIntoView,
    cornerPoints,
    cropAction,
    cropButton,
    cropCancel,
    cropTool,
    croppedVersion,
    jobTypes,
    publishedFrame,
    PUBLISH_TIMEOUT_MS,
} from './layer.js';
import { detail, errorText, imageryText, publishedLayer, readyImagery, versionIdOf, versionState } from './world.js';

// One admin test at a time: the import and the crop run in the server's upstream world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A published layer's geometry in its editor (behaviour A16; docs/research/M3-interfaces.md §6.4, §10.5): Crop draws the
 * area to keep with the drawing tools of the editor's map (a click per corner), and Save the crop sends it to
 * `imagery.crop`, which refuses an area off the layer and otherwise renders the layer's version again inside it as a
 * `regeoref` job (the stand-in runner of the e2e world), approved (what it kept holds part of the city, M9) and published: the layer's bounds,
 * the manifest's and the viewer's tiles end at the polygon. Replace the image is the Imagery area's upload for the layer:
 * the layer keeps its tiles while the new version waits (for Approve, then for the compute-unit guard's choice), and
 * points to it once published; Edit points saves points in the georeferencer as a `regeoref` job of the layer.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** An area just east of the layer (it ends at 26.31°), inside the city's drawing limits (its bounds plus half a degree). */
const OFF_THE_LAYER: readonly LngLat[] = [
    [26.36, 44.4],
    [26.5, 44.4],
    [26.5, 44.52],
    [26.36, 44.52],
];

/** The area to keep: the city's south-west, around the empty corner where the viewer is probed. */
const KEPT: readonly LngLat[] = [
    [25.96, 44.34],
    [26.12, 44.34],
    [26.12, 44.46],
    [25.96, 44.46],
];

/** A place inside the kept area, and one of the old layer far outside it (more than a zoom-15 tile away). */
const INSIDE: LngLat = [25.97, 44.37];
const CUT_AWAY: LngLat = [26.25, 44.55];

/** Clicks a ring's corners on the editor's map (brought into view first), each through `click`. */
async function drawRing(
    page: Page,
    lang: 'ro' | 'en',
    ring: readonly LngLat[],
    click: (point: { readonly x: number; readonly y: number }) => Promise<void>,
): Promise<void> {
    expect(await bringIntoView(page, lang, ring), 'the area is in the map').toBe(true);
    for (const point of await cornerPoints(page, ring)) {
        await click(point);
    }
    await expect(cropTool(page)).toHaveAttribute('data-phase', 'drawn');
}

/** A bounds box of the stored layer or manifest, near the ring's box (a click lands within a few pixels of a corner). */
function expectBoundsNear(actual: readonly number[], ring: readonly LngLat[]): void {
    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);
    const expected = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    expect(actual.map((value, index) => Math.abs(value - Number(expected[index])) < 0.005)).toEqual([true, true, true, true]);
}

/** The viewer at zoom 15 over `place` with the layer on. */
async function viewerAt(
    page: Page,
    lang: 'ro' | 'en',
    manifest: Parameters<typeof openPublicViewer>[1],
    place: LngLat,
    id: string,
): Promise<void> {
    const [lng, lat] = place;
    await openPublicViewer(page, manifest, { lang, hash: `15/${lat.toFixed(5)}/${lng.toFixed(5)}&layers=${id}` });
}

/** A message with its `{param}` holes as a pattern (`.+` for each). */
function pattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+'));
}

/** The layer as stored: its current version, the one on its way, and its tileset. */
async function layerState(imagery: ImageryWorld, id: string): Promise<{ current: unknown; pending: unknown; tileset: unknown }> {
    const layer = await imagery.cityWorld.emulators.document(`cities/${imagery.city}/layers/${id}`);
    const mapbox = (layer?.['mapbox'] ?? {}) as Readonly<Record<string, unknown>>;
    return { current: layer?.['currentVersion'], pending: layer?.['pendingVersion'], tileset: mapbox['tilesetId'] };
}

/** The layer's stored bounds as west, south, east, north. */
async function layerBounds(imagery: ImageryWorld, id: string): Promise<number[]> {
    const layer = await imagery.cityWorld.emulators.document(`cities/${imagery.city}/layers/${id}`);
    const bounds = (layer?.['bounds'] ?? {}) as Readonly<Record<string, number>>;
    return ['west', 'south', 'east', 'north'].map((side) => Number(bounds[side]));
}

test(
    'A crop off the layer is refused; one on it renders the layer again inside the polygon',
    { tag: ['@S-A16-BAD-CROP-OUTSIDE-LAYER', '@S-A16-HAPPY-CROP'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget, consoleErrors }) => {
        test.setTimeout(720_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const { layer } = await publishedFrame(page, lang, imagery);

        // The layer's editor, Crop, an area east of the layer, Save the crop: imagery.crop refuses it; no job.
        await page.goto(adminPath(lang, `layers/${layer.id}`));
        await adminMapReady(page);
        await cropButton(page, lang).click();
        await expect(cropTool(page)).toHaveAttribute('data-phase', 'drawing');
        await drawRing(page, lang, OFF_THE_LAYER, (point) => page.mouse.click(point.x, point.y));
        await cropAction(page, lang, 'cropSave').click();
        await expect(cropTool(page).getByRole('alert')).toContainText(errorText(lang, 'apiError.imagery.cropOutsideLayer'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect(await jobTypes(imagery)).toEqual(['usgs-import']);
        await expectStateSound(page, adminVisit('layers.crop-refused', lang));
        // The refusal is the callable's 400, which the browser logs.
        expect(consoleErrors.takeMatching(/status of 400 .*imagery-crop/)).toHaveLength(1);
        await cropCancel(page, lang).click();
        await expect(cropTool(page)).toHaveCount(0);

        // Afresh (the map as it opens): Crop, four corners on the layer, Save the crop.
        await page.reload();
        await adminMapReady(page);
        const cropping = inputBudget.flow('cropLayer', contentFlowBudget('cropLayer', KEPT.length));
        await cropping.click(cropButton(page, lang));
        await expect(cropTool(page)).toHaveAttribute('data-phase', 'drawing');
        await drawRing(page, lang, KEPT, (point) => cropping.clickAt(page, point));
        await expectStateSound(page, adminVisit('layers.crop-drawn', lang));
        await cropping.click(cropAction(page, lang, 'cropSave'));
        // The notice (its text is also in the page's live region, so the snackbar is what is asserted).
        await expect(
            page.locator('hcm-snackbar').filter({ hasText: imageryText(lang, 'adminContent.imagery.layer.cropStarted') }),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        // A regeoref job renders the version again inside the polygon. What it kept holds part of the city, so (M9 §11) it waits for one
        // click, and saying why; then it publishes to the same layer.
        const cropped = await croppedVersion(imagery);
        expect(await jobTypes(imagery)).toEqual(['regeoref', 'usgs-import']);
        await page.goto(adminPath(lang, `imagery/version/${cropped}`));
        await expect(detail(page).locator('[data-waits="coverage"]')).toBeVisible({ timeout: PUBLISH_TIMEOUT_MS });
        await inputBudget
            .flow('approveVersion', 1)
            .click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') }));
        const published = await publishedLayer(imagery, cropped, PUBLISH_TIMEOUT_MS);
        expect(published.id).toBe(layer.id);
        expectBoundsNear(await layerBounds(imagery, layer.id), KEPT);

        // The manifest's layer ends at the polygon, and so do the viewer's tiles.
        const manifest = await awaitManifest(imagery.cityWorld, 'lists the cropped layer', (built) => {
            const bounds = entry(built, 'layers', layer.id)?.['bounds'] as [[number, number], [number, number]] | undefined;
            return bounds !== undefined && Math.abs(bounds[0][0] - Number(KEPT[0]?.[0])) < 0.005;
        });
        const colour = publishedTileColour(published.tilesetId);
        await viewerAt(page, lang, manifest, INSIDE, layer.id);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), colour, 'the cropped layer inside the polygon', {
            tolerance: 10,
        });
        await viewerAt(page, lang, manifest, CUT_AWAY, layer.id);
        expect(await pixelsOfColour(page, await mapFraction(page, 0.5, 0.5), colour, 6, 10), 'no tile outside the polygon').toBe(0);
    },
);

test(
    "Replacing a layer's image keeps its tiles until the new one is published",
    { tag: ['@S-A14-HAPPY-REPLACE-SOURCE', '@S-A14-BAD-REPLACE-OVER-GUARD'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }, testInfo) => {
        test.setTimeout(720_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const { versionId: first, layer } = await publishedFrame(page, lang, imagery);
        // The replacement: a GeoTIFF of its own georeference, 1000 km² at zoom 16 (40 compute units, twice the month's 20).
        await imagery.script({ attempts: [{ outcome: 'embedded', areaKm2: 1000 }] });
        const file = await writeUpload(testInfo.outputPath('Planul nou.tif'), georeferencedTiff(E2E_CITY_BOUNDS));

        // The editor's Replace the image: the Imagery area's upload for this layer, which asks no year (the layer has one).
        await page.goto(adminPath(lang, `layers/${layer.id}`));
        await page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.layer.replace') }).click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/replace/${layer.id}$`));
        await page.locator('hcm-imagery-page input[type="file"]').setInputFiles(file);
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        const replacement = versionIdOf(page);
        expect(await imagery.job(replacement)).toMatchObject({ type: 'geotiff-import', layerId: layer.id });

        // Approve; the guard stops it with its three choices, and the layer keeps its tiles (S-A14-BAD-REPLACE-OVER-GUARD).
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })
            .click();
        const pay = detail(page).getByRole('button', { name: pattern(imageryText(lang, 'adminContent.imagery.choice.pay')) });
        await expect(pay).toBeEnabled({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await layerState(imagery, layer.id)).toEqual({ current: first, pending: replacement, tileset: layer.tilesetId });
        await page.goto(adminPath(lang, `layers/${layer.id}`));
        const pending = page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.layer.pending') });
        await expect(pending).toHaveAttribute('href', `#/imagery/version/${replacement}`);
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('layers.pending-version', lang));

        // Pay (asked first): it publishes now, and the layer points to the new version (S-A14-HAPPY-REPLACE-SOURCE).
        await pending.click();
        await pay.click();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: pattern(imageryText(lang, 'adminContent.imagery.confirm.payConfirm')) })
            .click();
        await publishedLayer(imagery, replacement, PUBLISH_TIMEOUT_MS);
        await expect
            .poll(() => layerState(imagery, layer.id), { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ current: replacement, pending: undefined });
    },
);

test(
    'A published layer is re-georeferenced without losing its tiles',
    { tag: ['@S-A16-HAPPY-REGEOREF-LAYER', '@S-A16-HAPPY-EDIT-POINTS-PUBLISHED', '@S-A16-HAPPY-GEOREF-MAP-SHOWS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(480_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const { versionId: first, layer } = await publishedFrame(page, lang, imagery);
        // The new points' run waits before rendering, so the version stays on its way while the layer is looked at.
        await imagery.script({ attempts: [{ outcome: 'over', holdAt: 'warp' }] });

        // Edit points: the georeferencer on the layer's current version; one more pair, Save.
        await page.goto(adminPath(lang, `layers/${layer.id}`));
        await page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.layer.regeoref') }).click();
        await expect(page).toHaveURL(new RegExp(`#/georef/${first}$`));
        await georeferencerReady(page, lang);
        // The version is on the map: the page says what saving does.
        await expect(page.locator('[data-state="published-note"]')).toHaveText(georefText(lang, 'adminContent.georef.publishedNote'));
        await expectStateSound(page, adminVisit('georef.edit-published', lang));
        // The map shows: the published layer itself goes under the pairs, on the page's one map; back to OpenStreetMap, it is gone.
        // On a phone the list is on the map's side of the switch (the test never showed it there: lesson 667).
        await showPane(page, lang, 'map');
        const shows = page.getByLabel(georefText(lang, 'adminContent.georef.shows.map'));
        await shows.selectOption(`layer:${layer.id}`);
        await expect(page.locator('.map-pane > p.note')).toContainText('(1966)');
        await expect.poll(async () => (await mapFacts(page)).layers.some((id) => id.includes(layer.id))).toBe(true);
        await expectPanesAligned(page, lang);
        await expectStateSound(page, adminVisit('georef.map-shows', lang));
        await shows.selectOption('reference:osm');
        await expect.poll(async () => (await mapFacts(page)).layers.some((id) => id.includes(layer.id))).toBe(false);
        await addPair(page, lang, landmark(0));
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') }).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        const regeoref = versionIdOf(page);

        // A regeoref job of the layer; the layer keeps its tiles and its editor says a new version is on its way.
        expect(regeoref).not.toBe(first);
        await expect.poll(async () => (await imagery.job(regeoref))?.['type'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('regeoref');
        expect(await imagery.job(regeoref)).toMatchObject({ layerId: layer.id });
        expect(await layerState(imagery, layer.id)).toEqual({ current: first, pending: regeoref, tileset: layer.tilesetId });
        await page.goto(adminPath(lang, `layers/${layer.id}`));
        await expect(page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.layer.pending') })).toHaveAttribute(
            'href',
            `#/imagery/version/${regeoref}`,
        );
        // The run goes on once it is held at its step (the dispatch and the first steps may still be under way).
        await expect.poll(async () => imagery.release(), { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
    },
);
