import type { Page, Route } from '@playwright/test';

import { BASEMAP_BACKGROUND, type Rgb } from '../../../fixtures/world.js';
import { blend, expectColourAt, mapFraction } from '../../../support/map.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { greyPng } from '../../support/grey-png.js';
import { adminMapReady } from '../../support/map.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import {
    detail,
    errorText,
    FREE_1968,
    FRESH_HARVEST,
    imageryText,
    mapFootprints,
    PAID_FRAMES,
    readyImagery,
    sceneLink,
    sceneList,
    TARGET_FRAMES,
} from './world.js';

// One admin test at a time: the Imagery area reads setup/status, and the browse copies run in the server's upstream world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Find's rows and map as the live test of 2026-11-01 found them (docs/research/manual-test-2026-10-25.md, findings 51–53):
 * nearly every frame covers the whole city and the strips cross the region, so the map draws the city's boundary and the
 * open scene's footprint alone; every listed row shows its browse image, which the list asks the server to copy when the harvest made
 * none, or says it is unavailable; rows of the same camera and day say their id, camera and frame.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const ALL_SCENES = [...TARGET_FRAMES, FREE_1968, ...PAID_FRAMES];
const CORONA_1966 = 'DS1035-1057DA023';

/** The selected footprint's fixed colour (a city without a theme): `#c2185b`, filled at 0.35 × 0.6. */
const SELECTED: Rgb = [194, 24, 91];
const SELECTED_FILL = 0.21;

/** A scene's row line that tells it apart from its twins. */
function identity(page: Page, lang: 'ro' | 'en', entityId: string) {
    return sceneList(page, lang).locator(`li[data-scene="${entityId}"] [data-identity]`);
}

/** A frame number as the row says it. */
function frame(lang: 'ro' | 'en', number: number): string {
    return imageryText(lang, 'adminContent.imagery.frame', { frame: String(number) });
}

test(
    'Every row shows its browse image, and twins of the same day say what tells them apart',
    { tag: ['@S-A11-HAPPY-ROW-PREVIEWS', '@S-A11-HAPPY-TWINS-TOLD-APART', '@S-A11-BAD-TWINS-ALONE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A recent harvest that copied no browse image: the list asks the server for the copies of the rows it shows.
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6);
        const thumbnails = sceneList(page, lang).locator('img.thumb');
        await expect(thumbnails).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(() => thumbnails.evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth)))
            .toEqual([128, 128, 128, 128, 128, 128]);
        await expectStateSound(page, adminVisit('imagery.results-previews', lang));

        // Free only off: the 1968 frame and its paid twin of the same day, from the forward camera, frames 75 and 76.
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') }).click();
        const forward = imageryText(lang, 'adminContent.imagery.camera.forward');
        await expect(identity(page, lang, FREE_1968)).toHaveText(`${FREE_1968} · ${forward}, ${frame(lang, 75)}`);
        await expect(identity(page, lang, PAID_FRAMES[0])).toHaveText(`${PAID_FRAMES[0]} · ${forward}, ${frame(lang, 76)}`);
        // A KH-9 mapping frame has one camera: its id and its frame only.
        const aft = imageryText(lang, 'adminContent.imagery.camera.aft');
        await expect(identity(page, lang, CORONA_1966)).toHaveText(`${CORONA_1966} · ${aft}, ${frame(lang, 23)}`);
        await expect(identity(page, lang, TARGET_FRAMES[1])).toHaveText(`${TARGET_FRAMES[1]} · ${frame(lang, 7)}`);
        // The twin's browse image USGS never serves: its row says so (the server's 503, which Chromium logs).
        await expect(sceneList(page, lang).locator(`li[data-scene="${PAID_FRAMES[0]}"] [data-browse="unavailable"]`)).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect.poll(() => consoleErrors.takeMatching(/imagery-browse/).length).toBeGreaterThan(0);
    },
);

test(
    'The map draws the open scene alone over the city, and rows without a preview say so',
    { tag: ['@S-A11-HAPPY-FOOTPRINT-SELECTED', '@S-A11-BAD-FOOTPRINTS-STACKED', '@S-A11-BAD-ROW-PREVIEW-UNAVAILABLE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        // A window wide enough to show the map beside the list with no scene open (a phone shows the map with a scene).
        await page.setViewportSize({ width: 1440, height: 900 });
        // USGS's browse host does not answer: no picture covers the map, and every row says its preview is unavailable.
        await upstream.fail('usgs-browse', 'unavailable', 'server');
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).locator('[data-browse="unavailable"]')).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(sceneLink(page, lang, CORONA_1966)).toContainText(errorText(lang, 'apiError.imagery.browseUnavailable'));
        await expectStateSound(page, adminVisit('imagery.results-previews-unavailable', lang));

        // None open, six overlapping frames listed: the map shows the city's boundary only, the basemap as it is inside
        // it, never every result's footprint (finding 51 of 2026-11-01: stacked fills, then dozens of crossing lines).
        await adminMapReady(page);
        expect(await mapFootprints(page)).toEqual([]);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), BASEMAP_BACKGROUND, 'six results, none open', { tolerance: 6 });

        // The 1966 frame opened: its footprint alone, lightly filled, at the city's own view.
        await sceneLink(page, lang, CORONA_1966).click();
        await expect.poll(() => mapFootprints(page)).toEqual([CORONA_1966]);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), blend(SELECTED, BASEMAP_BACKGROUND, SELECTED_FILL), 'the open one', {
            tolerance: 10,
        });
        await expect.poll(() => consoleErrors.takeMatching(/imagery-browse/).length).toBeGreaterThan(0);
    },
);

test(
    'A preview that could not be made says so with Try again, and Try again makes it',
    { tag: '@S-A11-BAD-PREVIEW-UNAVAILABLE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.seedScene(CORONA_1966, FRESH_HARVEST);
        await imagery.upload(await imagery.seedBrowse(CORONA_1966, new Date()), greyPng(4000, 1000), 'image/png');
        await page.goto(adminPath(lang, 'imagery'));
        const row = sceneList(page, lang).locator(`li[data-scene="${CORONA_1966}"] img.thumb`);
        await expect(row).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        // The thumbnail is made; the bucket then stops answering for the page's larger picture.
        // A 403, as the SDK gives up on it at once; a network failure it retries for minutes before the same answer.
        const offline = (route: Route): Promise<void> => route.fulfill({ status: 403, json: { error: { code: 403, message: 'denied' } } });
        await page.route('**/v0/b/**', offline);
        await sceneLink(page, lang, CORONA_1966).click();

        const alert = detail(page).locator('[data-state="browse-unavailable"]');
        await expect(alert).toContainText(errorText(lang, 'apiError.imagery.browseUnavailable'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).locator('img.browse')).toHaveCount(0);
        await expectStateSound(page, adminVisit('imagery.preview-unavailable', lang));

        await page.unroute('**/v0/b/**', offline);
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();

        const preview = detail(page).getByRole('img', { name: imageryText(lang, 'adminContent.imagery.browseAlt', { name: CORONA_1966 }) });
        await expect
            .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBe(2048);
        await expect(alert).toHaveCount(0);
        consoleErrors.takeMatching(/v0\/b\//);
    },
);

test(
    'A huge browse image is a small picture in its row and a bounded one on its page; an unreadable copy says so',
    { tag: ['@S-A11-HAPPY-HUGE-THUMBNAIL', '@S-A11-BAD-UNREADABLE-THUMBNAIL'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        for (const entityId of [CORONA_1966, FREE_1968]) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        // Grey strips as long as USGS's panoramic frames (37,440 x 1,920 px in live use; shorter here, as Chromium's memory is shared).
        await imagery.upload(await imagery.seedBrowse(CORONA_1966, new Date()), greyPng(20_000, 1000), 'image/png');
        await imagery.upload(await imagery.seedBrowse(FREE_1968, new Date()), new TextEncoder().encode('no image'), 'image/jpeg');
        await page.goto(adminPath(lang, 'imagery'));

        const row = sceneList(page, lang).locator(`li[data-scene="${CORONA_1966}"] img.thumb`);
        await expect(row).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        const sizeOf = (image: HTMLImageElement): readonly number[] => [image.naturalWidth, image.naturalHeight];
        await expect.poll(() => row.evaluate(sizeOf)).toEqual([128, 128]);
        await expect(sceneList(page, lang).locator(`li[data-scene="${FREE_1968}"] [data-browse="unavailable"]`)).toBeVisible();

        await sceneLink(page, lang, CORONA_1966).click();
        const preview = detail(page).getByRole('img', { name: imageryText(lang, 'adminContent.imagery.browseAlt', { name: CORONA_1966 }) });
        await expect.poll(() => preview.evaluate(sizeOf), { timeout: FUNCTIONS_TIMEOUT_MS }).toEqual([2048, 102]);
    },
);
