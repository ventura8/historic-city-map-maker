import { readFile } from 'node:fs/promises';

import { STORAGE_PATHS } from '@hcm/shared';
import type { Locator, Page, Response, TestInfo } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { SITE_ORIGIN } from '../../../fixtures/world.js';
import type { InputBudget } from '../../../support/budget.js';
import type { Recorder } from '../../../support/network.js';
import { citySite, serveCitySites } from '../../../support/city-site.js';
import { serveExports, unpackExport } from '../../../support/export-site.js';
import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { engineEvents, t, waitForEngineEvent } from '../../../support/viewer.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { ContentWorld } from '../../support/content.js';
import { EmulatorWorld, FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { awaitManifest, entry, seedPublicCity } from '../../support/flows.js';
import { seedPhoto } from '../../support/photos.js';
import { exportSection, exportText, serveSignedExports } from '../export/world.js';
import {
    giveViewerToken,
    Outsider,
    PRIVATE_BUCKET,
    PUBLIC_BUCKET,
    servePublicBucket,
    uploadPhotoFiles,
    uploadPrivate,
} from './journey-world.js';
import { AT, cityText, makeProjectOwner, retireCities, secondCityOf, seedCity, setCities } from './world.js';

/**
 * M5 end to end, across the apps (behaviour A54, the integrator's cross-app check; docs/research/M5-interfaces.md §1.6,
 * §1.10, §5): a city made with New city in the admin, published from Settings, gets the public site the repository adds
 * for it (`npm run site:add`'s writer and `npm run build:site`'s builder with the public bucket named), which boots that
 * city with one map from the manifest the server built; its owner exports it, and the downloaded zip boots on a plain
 * static server with no Firebase, Google or CDN request. Another city's admin, with their own credentials outside the
 * app, reaches nothing of the new city: its documents, its files and its callables refuse them. Content specs: each
 * test's own cities and accounts, against the Firestore, Storage, Functions and Cloud Tasks emulators.
 */

const NAME = 'Turda (e2e)';
const PHOTO = 'salina-1930';
const THEME = '#5B7F3A';
/** Turda's rectangle as New city is given it below, and a place inside it. */
const TURDA = { west: 23.7, south: 46.5, east: 23.9, north: 46.6 } as const;
const IN_TURDA = { lat: 46.55, lng: 23.8 } as const;

/** A folder of its own per test, project and retry (the projects run in parallel). */
function folderOf(testInfo: TestInfo): string {
    return `${testInfo.project.name}-${testInfo.testId}-${String(testInfo.retry)}`.replace(/[^\w-]/g, '-');
}

function newCityForm(page: Page): Locator {
    return page.locator('hcm-new-city-page');
}

/**
 * The viewer's token, minted after the create, best effort (`setup.rotatePublicToken`): this content world shares the
 * project with the locked specs, so Mapbox may be set up meanwhile (minted) or not (refused with 400, which Chromium
 * logs and which is claimed here); either way the city is valid and Setup's Mapbox card mints a missing token later.
 */
async function settleTokenMint(minted: Promise<Response>, consoleErrors: Recorder): Promise<void> {
    const refused = (await minted).status() === 400 ? 1 : 0;
    await expect.poll(() => consoleErrors.takeMatching(/status of 400 .*setup-rotatePublicToken/).length).toBe(refused);
}

/** New city by the keyboard: the name, the id (a content city's, which the locked tests' resets keep), the area, Create. */
async function createCity(page: Page, lang: 'ro' | 'en', content: ContentWorld, cityId: string, consoleErrors: Recorder): Promise<void> {
    await page.goto(content.address(lang, 'cities/new'));
    const minted = page.waitForResponse((response) => response.url().endsWith('/setup-rotatePublicToken'));
    const form = newCityForm(page);
    await form.getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }).fill(NAME);
    await form.getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true }).fill(cityId);
    for (const [edge, value] of Object.entries(TURDA)) {
        const field = form.getByLabel(cityText(lang, `adminContent.settings.${edge as 'west'}`), { exact: true });
        await field.fill(String(value));
        await field.press('Tab');
    }
    await form.locator('form > .actions hcm-button').click();
    await expect(form.locator(`[data-city-created="${cityId}"]`)).toHaveText(
        cityText(lang, 'adminContent.cities.created.title', { city: NAME }),
    );
    await settleTokenMint(minted, consoleErrors);
}

/** Settings → Publishing of `cityId`: the switch on and Save, two inputs; the state is checked before the switch. */
async function publishCity(page: Page, lang: 'ro' | 'en', content: ContentWorld, cityId: string, inputBudget: InputBudget): Promise<void> {
    await page.goto(content.address(lang, `c/${cityId}/settings/publish`, { map: false }));
    const toggle = page.getByRole('switch', { name: cityText(lang, 'adminContent.settings.publish.label') });
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('hcm-settings-page [data-published="false"]')).toBeVisible();
    await expectStateSound(page, adminVisit('cities.publish', lang));
    const flow = inputBudget.flow('publishCity', contentFlowBudget('publishCity'));
    await flow.click(toggle);
    await flow.click(page.getByRole('button', { name: cityText(lang, 'adminContent.common.save'), exact: true }));
    await expect(page.locator('hcm-settings-page [data-published="true"]')).toBeVisible();
    await expect.poll(async () => (await content.emulators.document(`cities/${cityId}`))?.['published']).toBe(true);
    expect(flow.used).toBe(2);
}

/** Settings → Export the city of `cityId`: Export, then Download once ready; the downloaded zip. */
async function exportCity(page: Page, lang: 'ro' | 'en', content: ContentWorld, cityId: string): Promise<Buffer> {
    await serveSignedExports(page, content);
    await page.goto(content.address(lang, `c/${cityId}/settings/export`, { map: false }));
    const section = exportSection(page);
    await section.getByRole('button', { name: exportText(lang, 'adminContent.export.start'), exact: true }).click();
    await expect(section.locator('[data-state="ready"]')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    const saving = page.waitForEvent('download');
    await section.getByRole('button', { name: exportText(lang, 'adminContent.export.download'), exact: true }).click();
    return readFile(await (await saving).path());
}

test(
    'A city made in the admin gets its own public site, and its export runs with no Firebase',
    { tag: '@S-A54-HAPPY' },
    async ({ page, lang, content, request, inputBudget, instrumentation, consoleErrors }, testInfo) => {
        test.setTimeout(420_000);
        const cityId = secondCityOf(content);
        const city = { emulators: content.emulators, city: cityId, uid: content.uid };
        await seedCity(content.emulators, content.city, 'Orașul A (e2e)');
        await makeProjectOwner(content);
        try {
            await createCity(page, lang, content, cityId, consoleErrors);
            // The token Setup's Mapbox card leaves on a city, so the manifest names the e2e world's token in every case.
            await giveViewerToken(content.emulators, cityId);
            await uploadPhotoFiles(request, cityId, PHOTO);
            await seedPhoto(city, { id: PHOTO, title: 'Salina, 1930 (e2e)', extra: { published: true, location: IN_TURDA } }, AT);
            await publishCity(page, lang, content, cityId, inputBudget);
            const manifest = await awaitManifest(city, 'with the photo', (built) => entry(built, 'photos', PHOTO) !== undefined);
            expect(manifest['city']).toMatchObject({ id: cityId, name: { ro: NAME } });

            // The city's public site, as the repository adds it, reading the public bucket: one map, the new city.
            const folder = folderOf(testInfo);
            const site = citySite(folder, { cityId, nameRo: NAME, theme: THEME }, PUBLIC_BUCKET);
            expect(site.sources).toEqual(['config.js', 'site.css', 'site.json']);
            await serveCitySites(page);
            await servePublicBucket(page, content.emulators);
            await page.goto(`${SITE_ORIGIN}${site.path}?lang=${lang}`);
            await waitForEngineEvent(page, 'hcm-ready');
            expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId, photos: 1 })]);
            expect((await instrumentation.read(page)).mapsCreated).toBe(1);
            await expect(page).toHaveTitle(NAME);

            // Its export: the zip the admin downloads, unpacked, on a plain static server: no Firebase, Google or CDN.
            const unpacked = await unpackExport(folder, await exportCity(page, lang, content, cityId));
            await serveExports(page);
            const asked: string[] = [];
            page.on('request', (request) => asked.push(request.url()));
            await page.goto(`${SITE_ORIGIN}${unpacked.path}?lang=${lang}`);
            await waitForEngineEvent(page, 'hcm-ready');
            expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId, photos: 1 })]);
            expect(asked).toContain(`${SITE_ORIGIN}${unpacked.path}engine/engine.iife.js`);
            expect(asked.filter((url) => /jsdelivr|googleapis|firebase|firestore|cloudfunctions/.test(url))).toEqual([]);
        } finally {
            await retireCities(content.emulators, [cityId]);
        }
    },
);

test(
    "Switched off in Settings, a city's public map goes: its site says it is not published",
    { tag: '@S-A54-BAD-UNPUBLISHED' },
    async ({ page, lang, content, request, instrumentation }, testInfo) => {
        test.setTimeout(300_000);
        const cityId = secondCityOf(content);
        const city = { emulators: content.emulators, city: cityId, uid: content.uid };
        // The city as Setup leaves a public one (its texts, start view and viewer token), with a published photo.
        await seedPublicCity(city, AT);
        await setCities(content, { [content.city]: 'owner', [cityId]: 'owner' });
        await uploadPhotoFiles(request, cityId, PHOTO);
        await seedPhoto(city, { id: PHOTO, title: 'Salina, 1930 (e2e)', extra: { published: true } }, AT);
        try {
            await awaitManifest(city, 'with the photo', (built) => entry(built, 'photos', PHOTO) !== undefined);
            await page.goto(content.address(lang, `c/${cityId}/settings/publish`, { map: false }));
            const toggle = page.getByRole('switch', { name: cityText(lang, 'adminContent.settings.publish.label') });
            await expect(toggle).toBeChecked();
            await toggle.click();
            await page.getByRole('button', { name: cityText(lang, 'adminContent.common.save'), exact: true }).click();
            await expect(page.locator('hcm-settings-page [data-published="false"]')).toBeVisible();
            await expect
                .poll(() => content.emulators.storageObject(PUBLIC_BUCKET, STORAGE_PATHS.manifest(cityId)), {
                    timeout: FUNCTIONS_TIMEOUT_MS,
                })
                .toBeUndefined();

            const site = citySite(folderOf(testInfo), { cityId, nameRo: NAME, theme: THEME }, PUBLIC_BUCKET);
            await serveCitySites(page);
            await servePublicBucket(page, content.emulators);
            await page.goto(`${SITE_ORIGIN}${site.path}?lang=${lang}`);
            await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
            expect(await engineEvents(page, 'hcm-error')).toEqual([{ code: 'error.manifest.notFound', retryable: true, detail: '404' }]);
            expect((await instrumentation.read(page)).mapsCreated).toBe(0);
        } finally {
            await retireCities(content.emulators, [cityId]);
        }
    },
);

test(
    "Another city's admin reaches nothing of a new city: its documents, its files and its callables refuse them",
    { tag: '@S-A54-BAD-OTHER-CITY' },
    async ({ content, request }, testInfo) => {
        const cityId = secondCityOf(content);
        const exportId = 'x-20261020-1';
        const zip = STORAGE_PATHS.cityExport(cityId, exportId);
        await seedCity(content.emulators, cityId, NAME);
        await setCities(content, { [content.city]: 'owner', [cityId]: 'owner' });
        await content.emulators.updateFields(`cities/${cityId}`, { published: true }, ['published']);
        await seedPhoto({ emulators: content.emulators, city: cityId, uid: content.uid }, { id: PHOTO, title: 'Salina, 1930 (e2e)' }, AT);
        await content.emulators.setDocument(`cities/${cityId}/exports/${exportId}`, {
            state: 'ready',
            requestedBy: content.uid,
            rasters: false,
            engineVersion: '1.0.0',
            createdAt: AT,
            updatedBy: 'system:export',
            updatedAt: AT,
        });
        await uploadPrivate(request, zip);
        // The other admin: the owner of a city of their own and of no other, as admin.join leaves them.
        const other = await ContentWorld.prepare(new EmulatorWorld(request), `${testIdOf(testInfo)}-other`);
        await seedCity(other.emulators, other.city, 'Orașul B (e2e)');
        try {
            const outsider = new Outsider(request, other.account.idToken);
            const reached = {
                ownCity: await outsider.read(`cities/${other.city}`),
                city: await outsider.read(`cities/${cityId}`),
                photo: await outsider.read(`cities/${cityId}/photos/${PHOTO}`),
                exportRecord: await outsider.read(`cities/${cityId}/exports/${exportId}`),
                unpublish: await outsider.write(`cities/${cityId}`, { published: false, updatedBy: other.uid, updatedAt: AT }),
                zip: await outsider.download(PRIVATE_BUCKET, zip),
                upload: await outsider.upload(PRIVATE_BUCKET, `uploads/photos/${cityId}/${other.uid}/${PHOTO}/e2e-upload-1.webp`),
                exportStart: await outsider.call('export.start', { cityId, rasters: false }),
                exportDownload: await outsider.call('export.download', { cityId, exportId }),
                invite: await outsider.call('admins.invite', { cityId, email: 'friend@content.e2e.test', role: 'owner' }),
            };

            const refused = { status: 403, code: 'apiError.city.notMember' };
            expect(reached).toEqual({
                ownCity: 200,
                city: 403,
                photo: 403,
                exportRecord: 403,
                unpublish: 403,
                zip: 403,
                upload: 403,
                exportStart: refused,
                exportDownload: refused,
                invite: refused,
            });
            expect(await content.emulators.document(`cities/${cityId}`)).toMatchObject({ published: true });
            expect(Object.keys(await content.emulators.collection(`cities/${cityId}/exports`))).toEqual([exportId]);
            expect(await content.emulators.objectNames(`uploads/photos/${cityId}/`)).toEqual([]);
        } finally {
            await other.retire();
            await retireCities(content.emulators, [cityId]);
        }
    },
);
