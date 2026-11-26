import { translate } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../support/live-regions.js';
import { mapFacts } from '../support/map.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { adminMapReady } from '../admin/support/map.js';
import { menuDialog } from '../admin/support/menu.js';
import { photosText, seedPhoto, seedPhotosCity, servePhotoImages } from '../admin/support/photos.js';

/**
 * The photos page (docs/research/M2c-interfaces.md §6; behaviours A08, A10): an admin opens `#/photos` of a city of its
 * own (the content world, e2e/admin/support/content.ts), sees the empty page, a file refused in the page, then the city's
 * photos as an earlier session left them; selects them all and publishes: the photos that cannot be published are named
 * with their reason and stay unpublished, the rest are published, an English title not required; opens a photo's editor.
 * Every screen and dialog on the way runs the generic layout and accessibility checkers (the photos section of
 * e2e/tour/states.ts).
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The page's list of photos (its rows are links to the editors). */
function photoLink(page: Page, title: string) {
    return page.getByRole('link', { name: new RegExp(title) });
}

test(
    'Publishing a selection skips the photos that cannot be published, each with its reason',
    { tag: ['@S-A10-BAD-NOT-PUBLISHABLE', '@S-A09-HAPPY-OPEN-IN-VIEW', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await page.goto(content.address(lang, 'photos'));

        // No photo yet: the empty page says how to add some.
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.empty', lang));

        // A file no photo upload may be is refused in the page, before anything is written.
        await page
            .locator('hcm-admin-photo-list input[type="file"]')
            .setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });
        await expect(page.getByText(photosText(lang, 'adminContent.photos.upload.refused'))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.upload-refused', lang));
        expect(await content.collection('photos')).toEqual({});

        // The photos an earlier session left: one ready (English title missing), one still processing, one refused, one
        // with an unknown licence.
        const photos = [
            { id: 'ready', title: 'Calea Victoriei' },
            { id: 'pending', title: 'Piața Romană', extra: { processing: 'pending', image: undefined } },
            {
                id: 'refused',
                title: 'Lipscani',
                extra: { processing: 'failed', image: undefined, processingError: 'apiError.photo.unsupportedType' },
            },
            { id: 'unknown', title: 'Gara de Nord', extra: { license: 'unknown', rightsReview: true } },
        ];
        for (const photo of photos) {
            await seedPhoto(content, photo, AT);
        }
        await expect(photoLink(page, 'Gara de Nord')).toBeVisible();
        await expectStateSound(page, adminVisit('photos.list', lang));

        // Select them all, then Publish.
        await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Calea Victoriei' }) }).check();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') }).click();
        await expect(page.getByText(photosText(lang, 'adminContent.photos.bulk.selected', { count: '4' }))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.bulk', lang));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true }).click();

        // One photo published; the three others named with their reason, and left as they were.
        await expect.poll(async () => (await content.document('photos/ready'))?.['published']).toBe(true);
        const seeWhy = page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.seeWhy') });
        await seeWhy.click();
        await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.report.title') })).toBeVisible();
        // The dialog's list is slotted content of its element (light DOM), not inside the native dialog of its shadow root.
        const report = page.locator('hcm-dialog.report');
        for (const [title, reason] of [
            ['Piața Romană', 'adminContent.photos.reason.processing'],
            ['Lipscani', 'adminContent.photos.reason.failed'],
            ['Gara de Nord', 'adminContent.photos.reason.license'],
        ] as const) {
            await expect(
                report.getByText(photosText(lang, 'adminContent.photos.reason.line', { title, reason: photosText(lang, reason) })),
            ).toBeVisible();
        }
        await expectStateSound(page, adminVisit('photos.report', lang, { escape: { opener: null } }));
        for (const id of ['pending', 'refused', 'unknown']) {
            expect((await content.document(`photos/${id}`))?.['published']).toBe(false);
        }

        // The photo's editor: its heading takes the focus.
        await photoLink(page, 'Calea Victoriei').click();
        await expect(
            page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Calea Victoriei' }) }),
        ).toBeFocused();
        // Its map is brought to it: the city has no start view, so the map opened at its bounds' centre (44.45 N), north
        // of every photo (S-A09-HAPPY-OPEN-IN-VIEW). A phone creates the map with the editor.
        await adminMapReady(page);
        await expect
            .poll(async () => {
                const [lng, lat] = (await mapFacts(page)).center;
                return Math.abs(lng - 26.1) < 1e-4 && Math.abs(lat - 44.43) < 1e-4;
            })
            .toBe(true);
        await expectStateSound(page, adminVisit('photos.editor', lang));
    },
);

test(
    'The photo editor names a field to correct, and a delete asks first and offers Undo',
    { tag: ['@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await seedPhoto(content, { id: 'ready', title: 'Calea Victoriei' }, AT);
        await seedPhoto(content, { id: 'other', title: 'Piața Romană' }, AT);
        await page.goto(content.address(lang, 'photos'));

        // Author, source and licence for a selection: a dialog.
        await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Piața Romană' }) }).check();
        // Author, source and licence is in the selection's overflow menu (DECISIONS-for-review.md §42e): its dialog first.
        const more = photosText(lang, 'adminContent.photos.bulk.more');
        await page.locator('hcm-admin-photo-list .bulk-bar').getByRole('button', { name: more, exact: true }).click();
        await expect(page.getByRole('dialog', { name: more })).toBeVisible();
        await expectStateSound(page, adminVisit('photos.bulk-more', lang, { escape: { opener: more } }));
        await page.locator('hcm-admin-photo-list .bulk-bar').getByRole('button', { name: more, exact: true }).click();
        await menuDialog(page, more)
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.setFieldsAction'), exact: true })
            .click();
        await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.setFields.title') })).toBeVisible();
        await expectStateSound(page, adminVisit('photos.set-fields', lang, { escape: { opener: more } }));

        // The editor: a source address that is not https is named, and Save stays off.
        await page.goto(content.address(lang, 'photos/ready'));
        const heading = page.getByRole('heading', {
            name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Calea Victoriei' }),
        });
        await expect(heading).toBeVisible();
        await page.getByRole('textbox', { name: photosText(lang, 'adminContent.photos.field.sourceUrl') }).fill('http://arhiva.example');
        await expect(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true })).toBeDisabled();
        await expectStateSound(page, adminVisit('photos.editor-invalid', lang));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.discard') }).click();

        // A date to the day and a source: Month and Day appear one after the other.
        const editing = page.locator('hcm-admin-photo-editor');
        await editing.getByLabel(photosText(lang, 'adminContent.photos.field.year'), { exact: true }).fill('1936');
        await editing.getByLabel(photosText(lang, 'adminContent.photos.field.month'), { exact: true }).selectOption('2');
        const day = editing.getByLabel(photosText(lang, 'adminContent.photos.field.day'), { exact: true });
        await day.fill('12');
        await page.getByRole('textbox', { name: photosText(lang, 'adminContent.photos.field.sourceUrl') }).fill('https://arhiva.example/1');
        await expectStateSound(page, adminVisit('photos.editor-date', lang));

        // A day that month does not have is named at its field, and Save stays off.
        await day.fill('30');
        await day.press('Tab');
        await expect(editing.getByText(translate(lang, 'validation.dateImpossible'), { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true })).toBeDisabled();
        await expectStateSound(page, adminVisit('photos.editor-impossible-date', lang));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.discard') }).click();

        // Delete asks first; once deleted, the snackbar offers Undo.
        const remove = photosText(lang, 'adminContent.photos.editor.delete');
        await page.getByRole('button', { name: remove }).click();
        await expect(
            page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.delete.titleOne', { title: 'Calea Victoriei' }) }),
        ).toBeVisible();
        await expectStateSound(page, adminVisit('photos.delete-confirm', lang, { escape: { opener: remove } }));
        await page.getByRole('button', { name: remove }).click();
        await page
            .locator('hcm-confirm-dialog')
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.delete.confirm'), exact: true })
            .click();
        // The snackbar's Undo is the kit's action button, with its 48 px target and its whole label on a phone since CR-M2c-17
        // of docs/research/M2c-interfaces.md.
        const deleted = photosText(lang, 'adminContent.photos.deleted', { title: 'Calea Victoriei' });
        const snackbar = page.getByText(deleted).and(page.locator(':not([aria-live])'));
        await expect(snackbar).toBeVisible();
        await expect(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.undoAction'), exact: true })).toBeVisible();
        // The pointer rests on it, which holds it open (its timer waits while it is pointed at) for the checkers' Tab round.
        await snackbar.hover();
        await expectStateSound(page, adminVisit('photos.deleted-undo', lang, { announcements: [deleted] }));
        await expect.poll(() => content.document('photos/ready')).toBeUndefined();
    },
);
