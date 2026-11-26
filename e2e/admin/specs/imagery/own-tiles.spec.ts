import type { Page, Route } from '@playwright/test';

import { expectColourAt, mapFraction, mapIdle } from '../../../support/map.js';
import { fulfilRange, type ArchiveReads } from '../../../support/pmtiles.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { STANDIN_TILE_COLOUR } from '../../support/imagery-standin.js';
import { deleteObjects } from '../../support/imagery-store.js';
import { adminMapReady, mapPaint, overlayFeatureIds } from '../../support/map.js';
import { SceneWriters } from '../../support/server-calls.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { detail, errorText, imageryText, importFromList, readyImagery, versionState } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The owner sees exactly what they approve (behaviours A73, A74, A75; docs/research/M12-own-tiles.md): `imagery.previewUrl` in the Functions
 * emulator signs the private archive the stand-in wrote, and the real Mapbox GL JS reads it by range through its custom source, on the
 * page's one map. The emulator's signer names the Storage emulator, which wants an owner's header no browser sends, so the page's route
 * answers that address from the object itself, as Cloud Storage answers a signed one. Approve then publishes it without Mapbox.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';
const SIGNED_ARCHIVE = /\/download\/storage\/v1\/b\/([^/]+)\/o\/([^?]+tiles\.pmtiles)/;
/** A corner of the city left out by the measured edge below. */
const OUTLINE = [
    { lat: 44.36, lng: 26.0 },
    { lat: 44.36, lng: 26.2 },
    { lat: 44.5, lng: 26.2 },
    { lat: 44.5, lng: 26.0 },
];

type Reader = (bucket: string, path: string) => Promise<Buffer | undefined>;

/** The signed address answered from the Storage emulator's object, by range; `refuse` plays a bucket that says no. */
function serveSigned(page: Page, read: Reader, refuse: () => boolean = () => false): Promise<ArchiveReads> {
    const reads: ArchiveReads = { ranges: [] };
    const answer = async (route: Route): Promise<void> => {
        const [, bucket = '', path = ''] = SIGNED_ARCHIVE.exec(route.request().url()) ?? [];
        const body = refuse() ? undefined : await read(bucket, decodeURIComponent(path));
        if (body === undefined) {
            await route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, body: '' });
            return;
        }
        await fulfilRange(route, new Uint8Array(body), reads);
    };
    return page.route(SIGNED_ARCHIVE, answer).then(() => reads);
}

/** The page's asks for a preview address from now on. */
function previewCalls(page: Page): { count: number } {
    const asked = { count: 0 };
    page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('imagery-previewUrl')) {
            asked.count += 1;
        }
    });
    return asked;
}

test(
    "Approving: the owner sees the version's own tiles at full detail, what it costs in words, and publishes with no Mapbox",
    { tag: ['@S-A74-HAPPY-SEES-IMAGE', '@S-A74-HAPPY-ACTUAL-PIXELS', '@S-A74-HAPPY-COVERAGE', '@S-A73-HAPPY-OWN-COST'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over', coveragePct: 57, outline: OUTLINE }] });
        const reads = await serveSigned(page, (bucket, path) => adminWorld.emulators.storageObject(bucket, path));

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const bytes = ((await imagery.version(versionId))?.['output'] as { tiles: { bytes: number } }).tiles.bytes;
        const cents = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format((bytes / 1e9) * 2);
        const words = [
            imageryText(lang, 'adminContent.imagery.approval.ownSize', { megabytes: String(Math.max(1, Math.round(bytes / 1e6))) }),
            imageryText(lang, 'adminContent.imagery.approval.ownMapbox'),
            imageryText(lang, 'adminContent.imagery.approval.ownStorage', { cents }),
            imageryText(lang, 'adminContent.imagery.approval.ownTraffic'),
            imageryText(lang, 'adminContent.imagery.approval.ownSite'),
        ];
        await expect(detail(page).locator('[data-own-cost]')).toHaveText(words.join(' '));
        await expect(detail(page).locator('[data-estimate]')).toHaveCount(0);
        await expect(detail(page).locator('[data-coverage]')).toContainText('57');
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.view.seeImage') })
            .click();
        await adminMapReady(page);

        const actual = detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.view.actualPixels') });
        await expect(actual).toBeVisible();
        await mapIdle(page);
        // The middle of the map is inside the measured edge: the tiles themselves, read by range, as its layer will start.
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), STANDIN_TILE_COLOUR, 'the version on the map', { tolerance: 12 });
        expect(reads.ranges.length).toBeGreaterThan(1);
        expect(reads.ranges.every((range) => range?.startsWith('bytes=') === true)).toBe(true);
        await expect
            .poll(() => mapPaint(page, 'hcm-raster-version-tiles', 'raster-resampling'))
            .toEqual(['step', ['zoom'], 'linear', expect.any(Number), 'nearest']);
        expect(await overlayFeatureIds(page, 'imagery-uncovered')).toEqual(['uncovered']);
        await expectStateSound(page, adminVisit('imagery.version-own-tiles', lang));

        // Actual pixels leaves the map at 1:1, the picture's pixels on the screen's, and brings the map into view: clicked from the cost
        // below it, the map no longer zooms out of sight (the rehearsal of 2026-11-07).
        await detail(page).locator('[data-own-cost]').scrollIntoViewIfNeeded();
        await actual.click();
        await expect(page.locator('hcm-admin-map').first()).toBeInViewport();
        await mapIdle(page);
        const zoom = await page.evaluate(() =>
            (window as unknown as { __hcmE2e: { maps: { getZoom(): number }[] } }).__hcmE2e.maps.at(-1)?.getZoom(),
        );
        const version = await imagery.version(versionId);
        expect(zoom).toBeCloseTo((version?.['output'] as { maxzoom: number }).maxzoom - 1, 0);

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })
            .click();

        await expect.poll(async () => (await imagery.version(versionId))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('published');
        const published = await imagery.version(versionId);
        expect(published?.['mapbox']).toBeUndefined();
        expect(published?.['own']).toMatchObject({ bytes: expect.any(Number) });
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toEqual([]);
        const layer = await adminWorld.emulators.document(`cities/${imagery.city}/layers/${String(published?.['layerId'])}`);
        expect(layer?.['source']).toMatchObject({ type: 'pmtiles' });
    },
);

test(
    'A bucket that refuses the tiles says so, Try again brings them, and an hour on a new address comes on its own',
    { tag: ['@S-A74-BAD-TILE-FAILS', '@S-A74-BAD-HOUR-OVER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over' }] });
        let refusing = true;
        let refusals = 0;
        await serveSigned(
            page,
            (bucket, path) => adminWorld.emulators.storageObject(bucket, path),
            () => {
                const refuse = refusing || refusals > 0;
                refusals = Math.max(0, refusals - 1);
                return refuse;
            },
        );

        await importFromList(page, lang, SCENE);

        const alert = detail(page).locator('[data-image="failed"]');
        await expect(alert).toContainText(imageryText(lang, 'adminContent.imagery.view.tilesFailed'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('imagery.version-tiles-failed', lang));
        consoleErrors.takeMatching(/403/);

        refusing = false;
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();

        await expect(alert).toHaveCount(0);
        const actual = detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.view.actualPixels') });
        await expect(actual).toBeVisible();

        // An hour on, the address runs out: the bucket refuses the next read, and the page asks for a new address on its own instead of
        // saying the image cannot be read (docs/LESSONS.md). Only the page's clock moves; its timers run as they do.
        await mapIdle(page);
        const asked = previewCalls(page);
        const now = await page.evaluate(() => Date.now());
        await page.clock.setFixedTime(new Date(now + 3_601_000));
        refusals = 1;
        await actual.click();

        await expect.poll(() => asked.count, { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
        await expect(actual).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await mapIdle(page);
        await expect(alert).toHaveCount(0);
        consoleErrors.takeMatching(/403/);
    },
);

test(
    'A version whose tiles are gone from the bucket says why and shows its small picture',
    { tag: '@S-A74-BAD-REFUSED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over' }] });
        await serveSigned(page, (bucket, path) => adminWorld.emulators.storageObject(bucket, path));
        const versionId = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const tiles = ((await imagery.version(versionId))?.['output'] as { tiles: { path: string } }).tiles;
        // The open map may still be reading the archive by range: leave the page first, so no read of it is under way when
        // it goes (a read the deletion overtook logged the emulator's 403, docs/LESSONS.md 404), then come back to it.
        const address = page.url();
        await SceneWriters.settledOn(page);
        await page.goto('about:blank');
        await deleteObjects(tiles.path);

        await page.goto(address);

        // Gone for good: the words say nothing makes them again (not "try again in a few minutes"), and no Try again is offered.
        await expect(detail(page).locator('[data-image="failed"]')).toContainText(errorText(lang, 'apiError.imagery.tilesGone'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })).toHaveCount(0);
        expect(consoleErrors.takeMatching(/imagery-previewUrl/).length).toBeGreaterThan(0);
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('imagery.version-tiles-gone', lang));
    },
);

test(
    "A version with no tiles yet shows its small picture, says so, Work's row keeps its icon, and rejected it says none will come",
    { tag: ['@S-A74-BAD-NO-TILES-YET', '@S-A75-BAD-NO-THUMB', '@S-A74-BAD-NEVER-COMING'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over', noTiles: true }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(detail(page).locator('[data-image="small"]')).toHaveText(imageryText(lang, 'adminContent.imagery.view.small'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-own-cost]')).toHaveCount(0);
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('imagery.version-tiles-small', lang));
        const address = page.url();

        await page.goto(adminPath(lang, 'imagery'));
        await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: '1' }) }).click();
        const row = page.locator(`hcm-imagery-page li[data-version="${versionId}"]`);
        await expect(row.locator('.thumb hcm-icon')).toBeVisible();

        // Rejected, nothing will make its tiles: the note no longer says they are on their way (docs/LESSONS.md).
        await page.goto(address);
        const reject = imageryText(lang, 'adminContent.imagery.reject');
        await detail(page).getByRole('button', { name: reject, exact: true }).click();
        await page.locator('hcm-dialog[open]').getByRole('button', { name: reject, exact: true }).click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.rejected')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).locator('[data-image="small"]')).toHaveText(imageryText(lang, 'adminContent.imagery.view.smallGone'));
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('imagery.version-tiles-never', lang));
    },
);

test(
    "Work's waiting row shows the version's small picture, with no map",
    { tag: '@S-A75-HAPPY-THUMBS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over' }] });
        await serveSigned(page, (bucket, path) => adminWorld.emulators.storageObject(bucket, path));

        const versionId = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        await page.goto(adminPath(lang, 'imagery'));
        await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: '1' }) }).click();
        const thumb = page.locator(`hcm-imagery-page li[data-version="${versionId}"] img.thumb`);
        await expect(thumb).toBeVisible();
        await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
        await expectStateSound(page, adminVisit('imagery.work-thumbs', lang));
    },
);

test(
    'The setting keeps Mapbox for a city that prefers it, and saving it keeps the rest of the settings',
    { tag: ['@S-A73-HAPPY-SETTING', '@S-A73-BAD-CITY-ON-MAPBOX'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false, autoPublish: false });

        await page.goto(adminPath(lang, 'settings/imagery'));
        const through = page.getByRole('switch', { name: imageryText(lang, 'adminContent.imagery.settings.throughMapbox') });
        await expect(through).not.toBeChecked();
        await through.click();
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.common.save'), exact: true }).click();

        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${imagery.city}`))?.['imagery'])
            .toMatchObject({ publishThroughMapbox: true, autoPublish: false });

        await imagery.script({ attempts: [{ outcome: 'over' }] });
        await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-estimate]')).toContainText(/Mapbox/);
        await expect(detail(page).locator('[data-own-cost]')).toHaveCount(0);
    },
);
