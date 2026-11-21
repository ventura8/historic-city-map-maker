import { readFile } from 'node:fs/promises';

import { MAX_POIS } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { renderedFeatureIds, screenPointOf } from '../../../support/map.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { awaitManifest, entries, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { contentText } from '../../support/ops.js';
import { adminMapReady, overlayFeatureIds } from '../../support/map.js';
import { seedPhoto, servePhotoImages } from '../../support/photos.js';
import { chooseImport, feature, poisText, seedCategories, seedPlace } from './places.js';
import { chooseInMenu } from '../../support/menu.js';

/**
 * Importing places from GeoJSON and deleting them (docs/research/M2c-interfaces.md §7.3, §7.4, §9.5; behaviours A34, A33)
 * in a city of the admin's own: a file is previewed with its counts and drawn on the map before anything is written, one
 * category is given to the features without one, Import writes them; markup in a file stays text everywhere; a file that
 * would take the city past its limit is refused before any write. Export all and an import's plan read the whole city, not
 * the list's page, and a place's photos are reached past the picker's page. Five places deleted with one question come back from
 * History; Cancel, Esc and the scrim of the delete question delete nothing.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

async function openPlaces(page: Page, content: ContentWorld, lang: 'ro' | 'en', map = true): Promise<void> {
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    await page.goto(content.address(lang, 'pois', { map }));
}

/** The import dialog (its texts are slotted content of its element, outside the native dialog's shadow root). */
function importDialog(page: Page): Locator {
    return page.locator('hcm-dialog.import-dialog');
}

function importButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true });
}

const point = (lng: number, lat: number): Record<string, unknown> => ({ type: 'Point', coordinates: [lng, lat] });

/** Firestore's listen channel of the emulator (WebChannel), and what cutting it logs (e2e/admin/specs/ops/stream.spec.ts). */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;
const CUT = /ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|Listen\/channel|cleardot\.gif/;

/** One place more than the list's first page; the oldest, `loc-00`, is past it. */
const PAST_THE_PAGE = 51;

async function seedPastThePage(content: ContentWorld): Promise<void> {
    for (let index = 0; index < PAST_THE_PAGE; index += 1) {
        const number = String(index).padStart(2, '0');
        const at = new Date(AT.getTime() + index * 1000);
        await seedPlace(content, { id: `loc-${number}`, title: `Loc ${number}`, at: [26.1, 44.43] }, at);
    }
}

test(
    'Export all holds the places past the loaded page, and importing its file again adds none',
    { tag: ['@S-A34-HAPPY-EXPORT-ALL-PLACES', '@S-A34-BAD-REIMPORT-NO-DUPLICATES'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPastThePage(content);
        await page.goto(content.address(lang, 'pois', { map: false }));
        await expect(page.getByRole('link', { name: /Loc 50/ })).toBeVisible();
        // The list holds its first page: the oldest place is not on it.
        await expect(page.getByRole('link', { name: /Loc 00/ })).toHaveCount(0);
        const seeded = await content.collection('pois');

        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.export') }).click();
        const exported = await (await download).path();
        const collection = JSON.parse(await readFile(exported, 'utf8')) as { features: { id: string }[] };
        expect(collection.features).toHaveLength(PAST_THE_PAGE);
        expect(collection.features.map((item) => item.id)).toContain('loc-00');

        // Its import knows every place, the one past the page too: all unchanged, none new, nothing to write.
        await page.locator('hcm-poi-list input[type="file"]').setInputFiles(exported);
        const dialog = importDialog(page);
        await expect(
            dialog.getByText(poisText(lang, 'adminContent.pois.import.unchanged', { count: String(PAST_THE_PAGE) })),
        ).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '0' }))).toBeVisible();
        await expect(importButton(page, lang)).toHaveCount(0);
        expect(await content.collection('pois')).toEqual(seeded);
    },
);

test(
    'Export all that cannot read the places from the server says so and saves nothing',
    { tag: '@S-A34-BAD-EXPORT-ALL-UNREAD' },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await openPlaces(page, content, lang, false);
        await seedPlace(content, { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302] }, AT);
        await expect(page.getByRole('link', { name: /Hanul lui Manuc/ })).toBeVisible();
        let saved = 0;
        page.on('download', () => {
            saved += 1;
        });

        // Offline only the local cache answers, which holds the list's page, not the city.
        await page.route(LISTEN, (route) => route.abort('connectionreset'));
        await page.context().setOffline(true);
        const exporting = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.export') });
        await exporting.click();
        await expect(exporting).toBeDisabled();
        await page.clock.fastForward(30_000);

        await expect(page.getByText(poisText(lang, 'adminContent.pois.exportFailed'))).toBeVisible();
        await expect(exporting).toBeEnabled();
        expect(saved).toBe(0);
        await page.context().setOffline(false);
        await page.unroute(LISTEN);
        consoleErrors.takeMatching(CUT);
    },
);

test(
    "A place's linked photo is named by its title with the picker closed, and the picker's Show more reaches it",
    { tag: ['@S-A32-BAD-LINKED-PHOTO-PAST-PAGE', '@S-A32-HAPPY-PHOTO-PICKER-PAGES'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await servePhotoImages(page);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        for (let index = 0; index < PAST_THE_PAGE; index += 1) {
            const number = String(index).padStart(2, '0');
            await seedPhoto(content, { id: `foto-${number}`, title: `Foto ${number}` }, new Date(AT.getTime() + index * 1000));
        }
        await seedPlace(content, { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302], extra: { photoIds: ['foto-00'] } }, AT);
        await page.goto(content.address(lang, 'pois/manuc', { map: false }));

        await expect(page.locator('hcm-poi-editor ul.chosen').getByText('Foto 00')).toBeVisible();

        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.field.choosePhotos') }).click();
        const picker = page.locator('hcm-dialog.photo-picker');
        await expect(picker.getByText(/Foto 50/)).toBeVisible();
        await expect(picker.getByText(/Foto 00/)).toHaveCount(0);
        await expectStateSound(page, adminVisit('pois.photo-picker', lang));
        await picker.getByRole('button', { name: poisText(lang, 'adminContent.common.more') }).click();
        await expect(picker.getByText(/Foto 00/)).toBeVisible();
        await expect(picker.getByRole('button', { name: poisText(lang, 'adminContent.common.more') })).toHaveCount(0);
    },
);

test(
    'A GeoJSON file is previewed with its counts and on the map, its uncategorised features get one category, and Import writes them',
    { tag: ['@S-A34-HAPPY', '@S-A30-HAPPY-CONTENT'] },
    async ({ page, lang, content, inputBudget }, testInfo) => {
        test.setTimeout(180_000);
        // The list beside the map, which draws the preview: a large window (a compact one shows the list or the map).
        await page.setViewportSize({ width: 1440, height: 900 });
        await openPlaces(page, content, lang);
        await seedPlace(content, { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302], extra: { category: 'markets' } }, AT);
        await expect(page.getByRole('link', { name: /Hanul lui Manuc/ })).toBeVisible();
        await adminMapReady(page);
        const file = testInfo.outputPath('locuri.geojson');
        const collection = {
            type: 'FeatureCollection',
            features: [
                feature(point(26.1046, 44.4335), { title: { ro: 'Biserica Colțea' }, category: 'monuments' }),
                feature(point(26.0975, 44.4392), { title: { ro: 'Piața Revoluției' } }),
                { ...feature(point(26.1003, 44.4302), { title: { ro: 'Hanul lui Manuc (restaurat)' }, category: 'markets' }), id: 'manuc' },
                feature(point(28.6625, 44.1733), { title: { ro: 'Cazinoul din Constanța' }, category: 'monuments' }),
            ],
        };
        const { writeFile } = await import('node:fs/promises');
        await writeFile(file, JSON.stringify(collection));

        // The file (one input): the preview counts them (the one without a category is refused until it gets one) and
        // draws the new and the updated on the map; nothing written yet.
        const flow = inputBudget.flow('geojsonImport', contentFlowBudget('geojsonImport'));
        await flow.setInputFiles(page.locator('hcm-poi-list input[type="file"]'), file);
        const dialog = importDialog(page);
        const counted = async (created: number, refused: number): Promise<void> => {
            await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: String(created) }))).toBeVisible();
            await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.updated', { count: '1' }))).toBeVisible();
            await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: String(refused) }))).toBeVisible();
        };
        await counted(1, 2);
        await expect.poll(() => overlayFeatureIds(page, 'hcm-import')).toEqual(['hcm-import-1', 'hcm-import-3']);
        expect(Object.keys(await content.collection('pois'))).toEqual(['manuc']);

        // One category for the feature without one: it joins the new ones and the map; then Import (three inputs in all).
        await flow.selectOption(dialog.getByLabel(poisText(lang, 'adminContent.pois.import.category', { count: '1' })), 'markets');
        await counted(2, 1);
        await expect.poll(() => overlayFeatureIds(page, 'hcm-import')).toEqual(['hcm-import-1', 'hcm-import-2', 'hcm-import-3']);
        await flow.click(importButton(page, lang));
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.done', { written: '3' }))).toBeVisible();
        await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(3);
        const places = Object.values(await content.collection('pois')).map((place) => [
            (place['title'] as { ro: string }).ro,
            place['category'],
        ]);
        expect(places.toSorted((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
            ['Biserica Colțea', 'monuments'],
            ['Hanul lui Manuc (restaurat)', 'markets'],
            ['Piața Revoluției', 'markets'],
        ]);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('link', { name: /Biserica Colțea/ })).toBeVisible();
        await awaitManifest(content, 'lists the three places', (built) => entries(built, 'pois').length === 3);
    },
);

test(
    'Markup in an imported title and description stays text in the preview, in the store and in the viewer',
    { tag: ['@S-A34-BAD-MARKUP-IS-TEXT'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openPlaces(page, content, lang, false);
        const title = '<b>Ateneul</b> <img src=x onerror=alert(1)>';
        const description = '<script>alert(1)</script><i>Sala</i> de concerte';
        await chooseImport(page, {
            name: 'markup.geojson',
            mimeType: 'application/geo+json',
            text: JSON.stringify({
                type: 'FeatureCollection',
                features: [
                    feature(point(26.0972, 44.4412), { title: { ro: title }, description: { ro: description }, category: 'monuments' }),
                ],
            }),
        });
        const dialog = importDialog(page);
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '1' }))).toBeVisible();
        await importButton(page, lang).click();
        await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(1);
        const [id = '', stored] = Object.entries(await content.collection('pois'))[0] ?? [];
        expect(stored).toMatchObject({ title: { ro: title }, description: { ro: description } });
        await page.keyboard.press('Escape');

        // The admin's list and editor show the characters.
        await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
        await expect(page.locator('hcm-poi-list img[src="x"], hcm-poi-list b')).toHaveCount(0);

        // The viewer shows the characters too, never markup.
        const manifest = await awaitManifest(content, 'lists the place', (built) => entry(built, 'pois', id) !== undefined);
        await openPublicViewer(page, manifest, { lang, hash: '17/44.44120/26.09720' });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain(id);
        const at = await screenPointOf(page, [26.0972, 44.4412]);
        await page.mouse.click(at.x, at.y);
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.locator('hcm-map-viewer img[src="x"], hcm-map-viewer script, hcm-map-viewer b')).toHaveCount(0);
    },
);

test(
    'An import that would take the city past its limit is refused before any write, with the numbers',
    { tag: ['@S-A34-BAD-TOO-MANY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openPlaces(page, content, lang, false);
        await seedPlace(content, { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302] }, AT);
        await seedPlace(content, { id: 'coltea', title: 'Biserica Colțea', at: [26.1046, 44.4335] }, AT);
        await expect(page.getByRole('link', { name: /Biserica Colțea/ })).toBeVisible();
        const features = Array.from({ length: MAX_POIS - 1 }, (_, index) =>
            feature(point(26.05 + (index % 100) * 0.001, 44.4 + Math.floor(index / 100) * 0.001), {
                title: { ro: `Locul ${String(index + 1)}` },
                category: 'monuments',
            }),
        );
        await chooseImport(page, {
            name: 'prea-multe.geojson',
            mimeType: 'application/geo+json',
            text: JSON.stringify({ type: 'FeatureCollection', features }),
        });
        const dialog = importDialog(page);
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: String(MAX_POIS - 1) }))).toBeVisible();
        await importButton(page, lang).click();

        await expect(
            dialog.getByText(
                poisText(lang, 'adminContent.pois.import.file.too-many', {
                    count: '2',
                    adding: String(MAX_POIS - 1),
                    limit: String(MAX_POIS),
                }),
            ),
        ).toBeVisible();
        expect(Object.keys(await content.collection('pois')).sort((a, b) => a.localeCompare(b))).toEqual(['coltea', 'manuc']);
    },
);

test(
    'Five places deleted with one question come back from History, one by one',
    { tag: ['@S-A33-HAPPY-BULK'] },
    async ({ page, lang, content }) => {
        test.setTimeout(240_000);
        await openPlaces(page, content, lang, false);
        const names = ['Gara de Nord', 'Gara Basarab', 'Gara Obor', 'Gara Progresul', 'Gara Cotroceni'];
        for (const [index, title] of names.entries()) {
            await seedPlace(content, { id: `gara-${String(index)}`, title, at: [26.07 + index * 0.01, 44.44] }, AT);
        }
        await expect(page.getByRole('link', { name: /Gara Cotroceni/ })).toBeVisible();

        // Select all, Delete: one question naming the count, then all five are gone.
        await page.getByRole('checkbox', { name: poisText(lang, 'adminContent.pois.select', { title: 'Gara Obor' }) }).check();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.bulk.selectAll') }).click();
        // Delete is among the selection's less frequent actions, in its overflow menu (DECISIONS-for-review.md §42e).
        await chooseInMenu(
            page,
            page.locator('hcm-poi-list .bulk-bar'),
            poisText(lang, 'adminContent.pois.bulk.more'),
            poisText(lang, 'adminContent.pois.bulk.delete'),
        );
        await expect(
            page.getByRole('dialog', { name: poisText(lang, 'adminContent.pois.bulk.deleteTitle', { count: '5' }) }),
        ).toBeVisible();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: poisText(lang, 'adminContent.pois.deleteConfirm'), exact: true })
            .click();
        await expect.poll(() => content.collection('pois')).toEqual({});

        // History, Deleted: Restore brings each back.
        await page.goto(content.address(lang, 'history', { map: false }));
        await page.getByLabel(contentText(lang, 'adminContent.history.actionLabel'), { exact: true }).selectOption('delete');
        for (const title of names) {
            const restore = page
                .getByRole('listitem')
                .filter({ hasText: title })
                .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') });
            const restored = Object.keys(await content.collection('pois')).length + 1;
            await restore.click();
            await page
                .locator('hcm-dialog[open]')
                .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') })
                .click();
            await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(restored);
        }
        await expect
            .poll(async () =>
                Object.values(await content.collection('pois'))
                    .map((place) => (place['title'] as { ro: string }).ro)
                    .sort((a, b) => a.localeCompare(b)),
            )
            .toEqual([...names].sort((a, b) => a.localeCompare(b)));
    },
);

test(
    'Cancel, Esc and the scrim of the delete question delete nothing and give the focus back to Delete',
    { tag: ['@S-A33-BAD-CANCEL'] },
    async ({ page, lang, content }) => {
        await openPlaces(page, content, lang, false);
        await seedPlace(content, { id: 'gara', title: 'Gara de Nord', at: [26.0726, 44.4467] }, AT);
        await page.goto(content.address(lang, 'pois/gara', { map: false }));
        const remove = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.delete') });
        const question = page.getByRole('dialog', { name: poisText(lang, 'adminContent.pois.deleteTitle', { title: 'Gara de Nord' }) });

        // Cancel.
        await remove.click();
        await expect(question).toBeVisible();
        // The dialog's X is named Cancel too (the confirm dialog's close label): its Cancel action is the last.
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: contentText(lang, 'adminContent.common.cancel'), exact: true })
            .last()
            .click();
        await expect(question).toBeHidden();
        await expect(remove).toBeFocused();
        // Esc.
        await remove.click();
        await expect(question).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(question).toBeHidden();
        await expect(remove).toBeFocused();
        // The scrim: a click outside the dialog's box.
        await remove.click();
        await expect(question).toBeVisible();
        await page.mouse.click(4, 4);
        await expect(question).toBeHidden();
        await expect(remove).toBeFocused();

        expect(await content.document('pois/gara')).toBeDefined();
    },
);
