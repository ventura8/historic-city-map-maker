import { bearingBetween, translate, type LngLat } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { mapFacts, mapIdle, renderedFeatureIds } from '../../../support/map.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ContentWorld } from '../../support/content.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { adminMapReady, clickMapAt, mapPointOf, photoCone, photoMarker } from '../../support/map.js';
import { menuDialog } from '../../support/menu.js';
import { photosText, seedPhoto, servePhotoImages } from '../../support/photos.js';

/**
 * A photo's editor with the admin map (docs/research/M2c-interfaces.md §6.3, §4.4, §4.6; behaviour A09) in a city of the
 * admin's own: the texts, years, credits and links edited; the pin put where the photo was taken with a click on the map
 * (the click tools' single-pointer placement, WCAG 2.5.7: Terra Draw's drag comes with CR-M2c-20); Set direction and a
 * click on what the camera looked at turn the view cone live, the field of view widens it live, and Save writes it once
 * with its history; the next manifest carries it and the viewer draws the cone. The same document from the keyboard
 * alone; a place outside the city is refused at its fields.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** Where the seeded photo is (Calea Victoriei), and a place on Piața Revoluției to move it to. */
const START: LngLat = [26.1, 44.43];
const MOVED: LngLat = [26.0975, 44.4392];

/** A field of the open photo's editor, by its label (the selection's dialog has fields of the same names). */
function field(page: Page, lang: 'ro' | 'en', key: Parameters<typeof photosText>[1]): Locator {
    return page.locator('hcm-admin-photo-editor').getByLabel(photosText(lang, key), { exact: true });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true });
}

/** Waits for the saved snackbar (its message, not the live region that repeats it). */
async function saved(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await expect(page.getByText(photosText(lang, 'adminContent.photos.saved')).and(page.locator(':not([aria-live])'))).toBeVisible();
}

async function openEditor(page: Page, content: ContentWorld, lang: 'ro' | 'en', published: boolean): Promise<void> {
    await servePhotoImages(page);
    await seedPublicCity(content, AT);
    await seedPhoto(content, { id: 'cv', title: 'Calea Victoriei', extra: { published, location: { lat: START[1], lng: START[0] } } }, AT);
    await page.goto(content.address(lang, 'photos/cv'));
    await expect(
        page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Calea Victoriei' }) }),
    ).toBeVisible();
    await adminMapReady(page);
}

function close(actual: number | undefined, expected: number, digits = 3): boolean {
    return actual !== undefined && Math.abs(actual - expected) < 10 ** -digits;
}

/** Within about 100 m of `expected`: a click lands on a pixel, not on an exact coordinate. */
function nearby(actual: LngLat | null, expected: LngLat): boolean {
    return actual !== null && close(actual[0], expected[0]) && close(actual[1], expected[1]);
}

test(
    "A photo's texts, place, direction and field of view preview live, save once with their history, and the viewer draws the cone",
    { tag: ['@S-A09-HAPPY'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(240_000);
        await openEditor(page, content, lang, true);

        // The texts, years, credits and a link.
        await field(page, lang, 'adminContent.photos.field.titleRo').fill('Calea Victoriei, 1930');
        await field(page, lang, 'adminContent.photos.field.titleEn').fill('Victory Avenue, 1930');
        await field(page, lang, 'adminContent.photos.field.year').fill('1930');
        await field(page, lang, 'adminContent.photos.field.yearEnd').fill('1935');
        await field(page, lang, 'adminContent.photos.field.author').fill('Ion Popescu');
        await field(page, lang, 'adminContent.photos.field.license').selectOption('CC0');
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.links.add') }).click();
        await page
            .locator('hcm-admin-photo-editor')
            .getByLabel(photosText(lang, 'adminContent.photos.links.label', { n: '1' }), { exact: true })
            .fill('Arhiva');
        await page
            .locator('hcm-admin-photo-editor')
            .getByLabel(photosText(lang, 'adminContent.photos.links.url', { n: '1' }), { exact: true })
            .fill('https://arhiva.example/cv');

        // A click on the map puts the pin there: the map shows it at once, nothing is written yet.
        await clickMapAt(page, MOVED);
        await expect.poll(async () => nearby(await photoMarker(page, 'cv'), MOVED)).toBe(true);
        await expect
            .poll(async () => close(Number(await field(page, lang, 'adminContent.photos.field.lat').inputValue()), MOVED[1]))
            .toBe(true);
        expect((await content.document('photos/cv'))?.['location']).toEqual({ lat: START[1], lng: START[0] });

        // Set direction, then a click on what the camera looked at (east): the cone turns live.
        const flow = inputBudget.flow('photoDirection', contentFlowBudget('photoDirection'));
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.direction.set') }));
        await expect(page.getByText(photosText(lang, 'adminContent.photos.direction.picking'))).toBeVisible();
        const target: LngLat = [MOVED[0] + 0.004, MOVED[1]];
        await flow.clickAt(page, await mapPointOf(page, target));
        await expect.poll(async () => (await photoCone(page, 'cv'))?.bearing).toBeGreaterThan(85);
        await expect.poll(async () => (await photoCone(page, 'cv'))?.bearing).toBeLessThan(95);

        // The field of view, from its slider's keys: the cone widens live.
        const fov = page.getByRole('slider', { name: photosText(lang, 'adminContent.photos.field.fov') });
        await fov.focus();
        for (let step = 0; step < 30; step += 1) {
            await fov.press('ArrowRight');
        }
        await expect.poll(async () => (await photoCone(page, 'cv'))?.fov).toBe(90);

        // Save: one stamped update, and the history keeps the version before it.
        await flow.click(saveButton(page, lang));
        await saved(page, lang);
        const stored = await content.document('photos/cv');
        expect(stored).toMatchObject({
            title: { ro: 'Calea Victoriei, 1930', en: 'Victory Avenue, 1930' },
            year: 1930,
            yearEnd: 1935,
            author: 'Ion Popescu',
            license: 'CC0',
            links: [{ label: 'Arhiva', url: 'https://arhiva.example/cv' }],
            fov: 90,
            updatedBy: content.uid,
        });
        expect(close((stored?.['location'] as { lat: number }).lat, MOVED[1])).toBe(true);
        expect(Math.round(Number(stored?.['bearing']))).toBeGreaterThan(85);
        await expect
            .poll(async () => Object.values(await content.collection('photos/cv/history')).map((entry) => entry['previous']), {
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toContainEqual(expect.objectContaining({ title: { ro: 'Calea Victoriei' } }));

        // The next manifest carries the direction; the viewer draws the photo's cone.
        const manifest = await awaitManifest(content, 'carries the direction', (built) => entry(built, 'photos', 'cv')?.['fov'] === 90);
        await openPublicViewer(page, manifest, { lang, hash: `17/${String(MOVED[1])}/${String(MOVED[0])}` });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toContain('cv');
    },
);

test(
    "A photo's place and direction set from the keyboard alone give the same document",
    { tag: ['@S-A09-HAPPY-KEYBOARD'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openEditor(page, content, lang, false);

        // The pin moves with its latitude and longitude fields.
        await field(page, lang, 'adminContent.photos.field.lat').fill(String(MOVED[1]));
        await field(page, lang, 'adminContent.photos.field.lng').fill(String(MOVED[0]));
        await expect
            .poll(async () => (await photoMarker(page, 'cv'))?.map((value) => Math.round(value * 10_000)))
            .toEqual([260975, 444392]);

        // With the map focused, the arrow keys move its view; Point at map centre turns the camera to the crosshair.
        const canvas = page.locator('hcm-admin-map canvas.mapboxgl-canvas');
        await canvas.focus();
        for (let step = 0; step < 4; step += 1) {
            await canvas.press('ArrowRight');
        }
        await mapIdle(page);
        const centre = (await mapFacts(page)).center;
        const expected = Math.round(bearingBetween(MOVED, centre));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.direction.centre') }).press('Enter');
        // To the degree: the view may still settle by a fraction after the arrows (a busy machine showed one degree).
        await expect
            .poll(async () => Math.abs(Number(await field(page, lang, 'adminContent.photos.field.bearing').inputValue()) - expected))
            .toBeLessThanOrEqual(1);
        await expect.poll(async () => Math.abs(((await photoCone(page, 'cv'))?.bearing ?? Number.NaN) - expected)).toBeLessThanOrEqual(1);

        // Save from the keyboard: the same fields as with the pointer.
        await saveButton(page, lang).press('Enter');
        await saved(page, lang);
        const stored = await content.document('photos/cv');
        expect(stored?.['location']).toEqual({ lat: MOVED[1], lng: MOVED[0] });
        expect(Math.abs(Number(stored?.['bearing']) - expected)).toBeLessThanOrEqual(1);
    },
);

test(
    'A place outside the city is refused at its fields and Save writes nothing',
    { tag: ['@S-A09-BAD-PIN-OUTSIDE-CITY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await openEditor(page, content, lang, false);

        // Constanța: far beyond the city and its half a degree of slack.
        const latitude = field(page, lang, 'adminContent.photos.field.lat');
        await latitude.fill('44.1733');
        await field(page, lang, 'adminContent.photos.field.lng').fill('28.6625');
        await latitude.focus();
        await page.keyboard.press('Tab');
        const outside = translate(lang, 'validation.outsideCity');
        // Save's note names the field and its problem (finding 37 of 2026-11-01), as part of one sentence.
        const issue = outside.charAt(0).toLocaleLowerCase(lang) + outside.slice(1, -1);
        const at = photosText(lang, 'adminContent.common.issueAt', { field: photosText(lang, 'adminContent.field.location'), issue });
        await expect(page.getByText(photosText(lang, 'adminContent.common.cannotSave', { issues: at }))).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        await expect(page.getByText(outside, { exact: true }).first()).toBeVisible();
        expect((await content.document('photos/cv'))?.['location']).toEqual({ lat: START[1], lng: START[0] });

        // Back inside: the problem goes and Save works again.
        await latitude.fill(String(MOVED[1]));
        await field(page, lang, 'adminContent.photos.field.lng').fill(String(MOVED[0]));
        await saveButton(page, lang).click();
        await saved(page, lang);
        expect((await content.document('photos/cv'))?.['location']).toEqual({ lat: MOVED[1], lng: MOVED[0] });
    },
);

test(
    'A date to the day and a source reach the public sheet as the admin set them, one field after the other',
    { tag: ['@S-A09-HAPPY-DATE-PRECISION'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openEditor(page, content, lang, true);
        const month = field(page, lang, 'adminContent.photos.field.month');
        const day = field(page, lang, 'adminContent.photos.field.day');

        // Each part appears once the one before it is set.
        await expect(month).toHaveCount(0);
        await field(page, lang, 'adminContent.photos.field.year').fill('1936');
        await expect(month).toBeVisible();
        await expect(day).toHaveCount(0);
        await month.selectOption('7');
        await expect(day).toBeVisible();
        await day.fill('12');
        await field(page, lang, 'adminContent.photos.field.sourceUrl').fill('https://arhiva.example/cv');
        const sourceName = field(page, lang, 'adminContent.photos.field.sourceLabel');
        await sourceName.fill('Arhiva');

        // A note about a field is heard at that field.
        await expect(sourceName).toHaveAccessibleDescription(photosText(lang, 'adminContent.photos.field.sourceLabelHint'));
        await expect(field(page, lang, 'adminContent.photos.field.dateTextRo')).toHaveAccessibleDescription(
            photosText(lang, 'adminContent.photos.field.dateTextHint'),
        );

        await saveButton(page, lang).click();
        await saved(page, lang);
        expect(await content.document('photos/cv')).toMatchObject({
            year: 1936,
            month: 7,
            day: 12,
            sourceUrl: 'https://arhiva.example/cv',
            sourceLabel: 'Arhiva',
        });

        // The next manifest carries them; a visitor reads the date and follows the source.
        const manifest = await awaitManifest(content, 'carries the date', (built) => entry(built, 'photos', 'cv')?.['day'] === 12);
        expect(entry(manifest, 'photos', 'cv')?.['source']).toEqual({ url: 'https://arhiva.example/cv', label: 'Arhiva' });
        await openPublicViewer(page, manifest, { lang, hash: `17/${String(START[1])}/${String(START[0])}&photo=cv` });
        const sheet = page.locator('hcm-photo-sheet');
        await expect(sheet.locator('.supporting')).toHaveText(lang === 'ro' ? '12 iulie 1936' : '12 July 1936');
        await expect(sheet.getByRole('link', { name: 'Arhiva' })).toHaveAttribute('href', 'https://arhiva.example/cv');
    },
);

test(
    'A day that month does not have is refused with its reason, and nothing is written',
    { tag: ['@S-A09-BAD-IMPOSSIBLE-DATE'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await openEditor(page, content, lang, false);

        await field(page, lang, 'adminContent.photos.field.year').fill('1937');
        await field(page, lang, 'adminContent.photos.field.month').selectOption('2');
        const day = field(page, lang, 'adminContent.photos.field.day');
        await day.fill('29');
        await day.press('Tab');
        const editor = page.locator('hcm-admin-photo-editor');
        await expect(editor.getByText(translate(lang, 'validation.dateImpossible'), { exact: true })).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        expect((await content.document('photos/cv'))?.['year']).toBeUndefined();

        // A leap year has that day: the problem goes and Save works.
        await field(page, lang, 'adminContent.photos.field.year').fill('1936');
        await expect(editor.getByText(translate(lang, 'validation.dateImpossible'), { exact: true })).toHaveCount(0);
        await saveButton(page, lang).click();
        await saved(page, lang);
        expect(await content.document('photos/cv')).toMatchObject({ year: 1936, month: 2, day: 29 });
    },
);

test(
    'Discard shows the month the photo has, not the one just picked',
    { tag: ['@S-A09-BAD-DISCARD-MONTH'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openEditor(page, content, lang, false);
        await field(page, lang, 'adminContent.photos.field.year').fill('1936');
        const month = field(page, lang, 'adminContent.photos.field.month');
        await month.selectOption('3');
        await saveButton(page, lang).click();
        await saved(page, lang);

        await month.selectOption('5');
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.discard'), exact: true }).click();

        await expect(month).toHaveValue('3');
        expect((await content.document('photos/cv'))?.['month']).toBe(3);
    },
);

/** Opens the selection's Author, source and licence dialog for the photos already selected. */
async function openSetFields(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const more = photosText(lang, 'adminContent.photos.bulk.more');
    await page.locator('hcm-admin-photo-list .bulk-bar').getByRole('button', { name: more, exact: true }).click();
    await menuDialog(page, more)
        .getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.setFieldsAction'), exact: true })
        .click();
    await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.setFields.title') })).toBeVisible();
    // The dialog's form is slotted content of its element (light DOM), not inside the native dialog of its shadow root.
    return page.locator('hcm-dialog.set-fields');
}

async function selectBothPhotos(page: Page, lang: 'ro' | 'en', content: ContentWorld): Promise<void> {
    await servePhotoImages(page);
    await seedPublicCity(content, AT);
    await seedPhoto(content, { id: 'one', title: 'Calea Victoriei' }, AT);
    await seedPhoto(content, { id: 'two', title: 'Piața Romană' }, AT);
    await page.goto(content.address(lang, 'photos', { map: false }));
    await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Piața Romană' }) }).check();
    await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Calea Victoriei' }) }).check();
}

test('A source set on a selection reaches every selected photo', { tag: ['@S-A09-HAPPY-BULK-SOURCE'] }, async ({ page, lang, content }) => {
    await selectBothPhotos(page, lang, content);
    const dialog = await openSetFields(page, lang);
    await dialog.getByLabel(photosText(lang, 'adminContent.photos.field.sourceUrl'), { exact: true }).fill('https://arhiva.example/set');
    await dialog.getByLabel(photosText(lang, 'adminContent.photos.field.sourceLabel'), { exact: true }).fill('Arhiva');
    await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.setFields.apply'), exact: true }).click();

    for (const id of ['one', 'two']) {
        await expect
            .poll(async () => content.document(`photos/${id}`))
            .toMatchObject({ sourceUrl: 'https://arhiva.example/set', sourceLabel: 'Arhiva' });
    }
});

test(
    'A source address that is not https, set on a selection, leaves every photo as it was and says why',
    { tag: ['@S-A09-BAD-BULK-SOURCE-NOT-HTTPS'] },
    async ({ page, lang, content }) => {
        await selectBothPhotos(page, lang, content);
        const dialog = await openSetFields(page, lang);
        await dialog.getByLabel(photosText(lang, 'adminContent.photos.field.sourceUrl'), { exact: true }).fill('http://arhiva.example/set');
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.setFields.apply'), exact: true }).click();

        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.seeWhy') }).click();
        const report = page.locator('hcm-dialog.report');
        const reason = photosText(lang, 'adminContent.photos.reason.sourceUrl');
        await expect(
            report.getByText(photosText(lang, 'adminContent.photos.reason.line', { title: 'Piața Romană', reason })),
        ).toBeVisible();
        for (const id of ['one', 'two']) {
            expect((await content.document(`photos/${id}`))?.['sourceUrl']).toBeUndefined();
        }
    },
);
