import { readFile } from 'node:fs/promises';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { unzip } from '../../../support/unzip.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { awaitManifest, entry } from '../../support/flows.js';
import {
    AT,
    PHOTO,
    exportSection,
    exportText,
    makeEditor,
    seedExport,
    seedExportableCity,
    seedUnpublishedCity,
    serveSignedExports,
    writtenZip,
} from './world.js';

/**
 * Settings → Export the city (behaviour A53, docs/research/M5-interfaces.md §5): a city owner exports a published city in
 * two inputs against the emulators: `export.start` records the export, the Cloud Tasks emulator runs `export.build`,
 * which writes the zip into the Storage emulator's private bucket, and Download saves it through the stand-in signer's
 * address (answered from the Storage emulator); the zip holds the page, the engine, `city.json`, the photos, README and
 * RIGHTS. An export under way, an expired one, an editor and a city never published each show what they allow.
 */

const ZIP_FILES = ['index.html', 'city.json', 'README.md', 'RIGHTS.md', 'engine/engine.iife.js', 'engine/engine.css'];

test('A city owner exports the city in two inputs', { tag: '@S-A53-HAPPY' }, async ({ page, lang, content, request, inputBudget }) => {
    test.setTimeout(240_000);
    await seedExportableCity(content, request);
    await awaitManifest(content, 'with the photo', (manifest) => entry(manifest, 'photos', PHOTO) !== undefined);
    await serveSignedExports(page, content);
    await page.goto(content.address(lang, 'settings/export', { map: false }));
    const section = exportSection(page);
    const exportButton = section.getByRole('button', { name: exportText(lang, 'adminContent.export.start'), exact: true });
    await expect(exportButton).toBeVisible();
    await expectStateSound(page, adminVisit('export.card', lang));

    // Export: the record is queued, then built by the task, then ready with what it holds.
    const flow = inputBudget.flow('exportCity', contentFlowBudget('exportCity'));
    await flow.click(exportButton);
    // docs/LESSONS.md 255: Export's button goes while the export is under way; the focus stays on the card's heading, and
    // the card's one live region says how it goes.
    await expect(page.locator('hcm-settings-page h2[data-detail-heading]')).toBeFocused();
    await expect(section.locator('[data-state="ready"]')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await expect(page.locator('hcm-settings-page [data-export-live]')).toHaveText(
        await section.locator('[data-state="ready"]').innerText(),
    );
    await expect(section).toContainText(exportText(lang, 'adminContent.export.restricted.one', { count: '1' }));
    await expect(section.locator('[data-field="sha256"]')).toBeVisible();
    await expectStateSound(page, adminVisit('export.ready', lang));
    const [exportId] = Object.keys(await content.collection('exports'));
    const record = await content.document(`exports/${String(exportId)}`);
    expect(record).toMatchObject({ state: 'ready', requestedBy: content.uid, rasters: false, counts: { photos: 1, restrictedPhotos: 1 } });

    // Download: the browser saves `<city>-<day>.zip`, the very object the task wrote.
    const saving = page.waitForEvent('download');
    await flow.click(section.getByRole('button', { name: exportText(lang, 'adminContent.export.download'), exact: true }));
    const download = await saving;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${content.city}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const zip = await readFile(await download.path());
    expect(zip.equals(await writtenZip(content, String(exportId)))).toBe(true);
    const files = Object.fromEntries(unzip(zip).map((file) => [file.name, file.bytes.toString('utf8')]));
    expect(Object.keys(files)).toEqual(expect.arrayContaining([...ZIP_FILES, `photos/${PHOTO}/web.webp`, `photos/${PHOTO}/thumb.webp`]));
    const city = JSON.parse(String(files['city.json'])) as { city: { analytics: unknown }; photos: { image: { web: string } }[] };
    expect(city.city.analytics).toEqual({});
    expect(city.photos.map((photo) => photo.image.web)).toEqual([`photos/${PHOTO}/web.webp`]);
    expect(files['RIGHTS.md']).toContain(`\`${PHOTO}\``);
    expect(files['index.html']).toContain('src="engine/engine.iife.js"');
});

test('While an export is being prepared, Export waits', { tag: '@S-A53-BAD-BUSY' }, async ({ page, lang, content, request }) => {
    test.setTimeout(180_000);
    await seedExportableCity(content, request);
    await awaitManifest(content, 'built', () => true);
    await seedExport(content, 'x-20261017-1', { state: 'building', startedAt: AT });

    await page.goto(content.address(lang, 'settings/export', { map: false }));

    const section = exportSection(page);
    await expect(section.locator('[data-state="building"]')).toContainText(exportText(lang, 'adminContent.export.building'));
    await expect(section.getByRole('button')).toHaveCount(0);
    await expectStateSound(page, adminVisit('export.building', lang));
});

test('An expired export offers Export again', { tag: '@S-A53-BAD-EXPIRED' }, async ({ page, lang, content, request }) => {
    test.setTimeout(180_000);
    await seedExportableCity(content, request);
    await awaitManifest(content, 'built', () => true);
    // Ready, but its seven days are over: the card reads it expired before the tick marks it so.
    await seedExport(content, 'x-20261001-1', { state: 'ready', bytes: 2048, sha256: 'a'.repeat(64), finishedAt: AT, expiresAt: AT });

    await page.goto(content.address(lang, 'settings/export', { map: false }));

    const section = exportSection(page);
    await expect(section.locator('[data-state="expired"]')).toContainText(exportText(lang, 'adminContent.export.expired'));
    await expect(section.getByRole('button', { name: exportText(lang, 'adminContent.export.download') })).toHaveCount(0);
    await expect(section.getByRole('button', { name: exportText(lang, 'adminContent.export.again'), exact: true })).toBeVisible();
    await expectStateSound(page, adminVisit('export.expired', lang));
});

test('A failed export says why and offers Export again', { tag: '@S-A53-BAD-TOO-LARGE' }, async ({ page, lang, content, request }) => {
    test.setTimeout(180_000);
    await seedExportableCity(content, request);
    await awaitManifest(content, 'built', () => true);
    await seedExport(content, 'x-20261017-1', {
        state: 'failed',
        error: 'apiError.export.tooLarge',
        errorParams: { size: '2400000000', max: '2000000000' },
        finishedAt: AT,
    });

    await page.goto(content.address(lang, 'settings/export', { map: false }));

    const section = exportSection(page);
    await expect(section.getByRole('alert')).toContainText(lang === 'ro' ? '2,4 GB' : '2.4 GB');
    await expect(section.getByRole('button', { name: exportText(lang, 'adminContent.export.again'), exact: true })).toBeVisible();
    await expectStateSound(page, adminVisit('export.failed', lang));
});

test('An editor sees the export read-only', { tag: '@S-A53-BAD-EDITOR' }, async ({ page, lang, content, request }) => {
    test.setTimeout(180_000);
    await seedExportableCity(content, request);
    await awaitManifest(content, 'built', () => true);
    await seedExport(content, 'x-20261017-1', {
        state: 'ready',
        bytes: 2048,
        sha256: 'a'.repeat(64),
        finishedAt: AT,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    await makeEditor(content);

    await page.goto(content.address(lang, 'settings/export', { map: false }));

    const section = exportSection(page);
    await expect(section.locator('[data-state="owner-only"]')).toHaveText(exportText(lang, 'adminContent.export.ownerOnly'));
    await expect(section.locator('[data-state="ready"]')).toBeVisible();
    await expect(section.getByRole('button')).toHaveCount(0);
    await expectStateSound(page, adminVisit('export.readonly', lang));
});

test('A city never published cannot be exported', { tag: '@S-A53-BAD-NEVER-PUBLISHED' }, async ({ page, lang, content }) => {
    await seedUnpublishedCity(content);

    await page.goto(content.address(lang, 'settings/export', { map: false }));

    const section = exportSection(page);
    await expect(section.locator('[data-state="unpublished"]')).toHaveText(exportText(lang, 'adminContent.export.unpublished'), {
        timeout: FUNCTIONS_TIMEOUT_MS,
    });
    await expect(section.getByRole('button')).toHaveCount(0);
});
