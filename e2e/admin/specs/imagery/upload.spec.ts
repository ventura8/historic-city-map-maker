import type { Locator, Page, Route } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { georeferencedTiff, NOT_A_TIFF, plainScanTiff, writeUpload } from '../../support/imagery-files.js';
import { E2E_CITY_BOUNDS } from '../../support/imagery-geometry.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { detail, errorText, imageryText, readyImagery, stepRow, stepStateText, versionIdOf, versionState } from './world.js';

// One admin test at a time: the upload's trigger and the dispatcher run in the server's world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Uploading a GeoTIFF (behaviour A14, docs/research/M3-interfaces.md §8.1): Upload, choose the file (the page reads its
 * first bytes, and a name that says its year starts the upload at once) -> the Storage SDK's resumable upload to the
 * Storage emulator -> `imagery.onRasterUpload` (the Functions emulator) creates the job and its version -> the stand-in
 * runner inspects it: its own georeference goes to the approval card (never published on its own: nothing was measured),
 * a scan without one waits for points. A file that is not a TIFF is refused in the page before a byte is uploaded. The
 * files are generated in the test's folder (e2e/admin/support/imagery-files.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** Opens the area's Upload view with `click` (a counted click, or a plain one). */
async function openUpload(
    page: Page,
    lang: 'ro' | 'en',
    click: (target: Locator) => Promise<void> = (target) => target.click(),
): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await click(page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.upload') }));
}

/** The view's hidden file input (its button opens it; Playwright sets it directly, as a chosen file). */
function fileInput(page: Page): Locator {
    return page.locator('hcm-imagery-page input[type="file"]');
}

/**
 * The connection drops once in the middle of a resumable upload: the second chunk the SDK sends to the Storage emulator
 * is answered 503 (a retryable failure), and the SDK sends it again. Returns how many chunks were sent.
 */
async function dropOneChunk(page: Page): Promise<() => number> {
    let chunks = 0;
    await page.route('**/v0/b/**', async (route: Route) => {
        const command = (await route.request().allHeaders())['x-goog-upload-command'] ?? '';
        if (!command.includes('upload')) {
            await route.fallback();
            return;
        }
        chunks += 1;
        await (chunks === 2 ? route.fulfill({ status: 503, body: 'dropped' }) : route.fallback());
    });
    return () => chunks;
}

test(
    'A georeferenced GeoTIFF goes straight to the publish path',
    { tag: '@S-A14-HAPPY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }, testInfo) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        const file = await writeUpload(testInfo.outputPath('Planul Bucurestilor 1966.tif'), georeferencedTiff(E2E_CITY_BOUNDS));

        // Upload, choose the file (its name says 1966: the upload starts at once), Approve.
        const uploading = inputBudget.flow('uploadGeotiff', 3);
        await openUpload(page, lang, (target) => uploading.click(target));
        await uploading.setInputFiles(fileInput(page), file);
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        const versionId = versionIdOf(page);

        // Its own georeference: no reference, no matching; the card says the error was not measured, and nothing approves it.
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.approval.unmeasured'))).toBeVisible();
        await expect(stepRow(page, lang, 'inspect')).toContainText(stepStateText(lang, 'done'));
        await expect(stepRow(page, lang, 'georef')).toContainText(stepStateText(lang, 'skipped'));
        expect(await imagery.version(versionId)).toMatchObject({ origin: 'upload', year: 1966, georef: { method: 'embedded' } });
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        await expectStateSound(page, adminVisit('imagery.upload-approval', lang));

        await uploading.click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') }));
        await expect
            .poll(async () => (await imagery.version(versionId))?.['approval'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ auto: false });
    },
);

test(
    'A GeoTIFF without georeference opens the georeferencer',
    { tag: '@S-A14-BAD-NOT-GEOREFERENCED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }, testInfo) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'scan' }] });
        const file = await writeUpload(testInfo.outputPath('Scan 1970.tif'), plainScanTiff());

        await openUpload(page, lang);
        await fileInput(page).setInputFiles(file);
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.wait.gcps'))).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.upload-needs-points', lang));

        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();
        await expect(page).toHaveURL(/#\/georef\//);
        await expect(page.getByRole('application', { name: imageryText(lang, 'adminContent.georef.scanLabel') })).toBeVisible();
        await expect(page.getByRole('button', { name: imageryText(lang, 'adminContent.georef.save') })).toBeVisible();
    },
);

test(
    'A non-TIFF upload shows an error',
    { tag: '@S-A14-BAD-NON-TIFF' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }, testInfo) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A PNG named like a TIFF: the name says nothing, the first bytes decide.
        const file = await writeUpload(testInfo.outputPath('Harta 1966.tif'), NOT_A_TIFF);

        await openUpload(page, lang);
        await fileInput(page).setInputFiles(file);

        await expect(page.getByRole('alert').filter({ hasText: errorText(lang, 'apiError.imagery.notTiff') })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.upload-not-tiff', lang));
        expect(await imagery.objects('uploads/rasters/')).toEqual([]);
        expect(Object.keys(await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/jobs`))).toEqual([]);
    },
);

test(
    'A large upload resumes after an interruption',
    { tag: '@S-A14-BAD-LARGE-RESUMABLE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }, testInfo) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // About 5 MB: several chunks of the SDK's resumable upload.
        const file = await writeUpload(testInfo.outputPath('Scan mare 1975.tif'), plainScanTiff(2400, 2000));
        const chunks = await dropOneChunk(page);

        await openUpload(page, lang);
        await fileInput(page).setInputFiles(file);
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        expect(chunks()).toBeGreaterThan(2);
        expect(Object.keys(await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/jobs`))).toEqual([versionIdOf(page)]);
        expect(await imagery.objects(`uploads/rasters/${imagery.city}/`)).toHaveLength(1);
        // The dropped chunk's 503, which Chromium logs; the SDK sent it again.
        expect(consoleErrors.takeMatching(/status of 503 .*upload_protocol=resumable/)).toHaveLength(1);
    },
);
