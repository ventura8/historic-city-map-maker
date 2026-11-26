import { translate, translateAdminShell } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { renderedFeatureIds } from '../../../support/map.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { templatePattern } from '../../support/i18n.js';
import { awaitManifest, entries, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { jpegBytes, photoFile } from '../../support/images.js';
import {
    awaitProcessed,
    photoInput,
    photoRow,
    photosBy,
    photosText,
    rememberPhotoChoices,
    seedPhoto,
    servePhotoImages,
} from '../../support/photos.js';
import { chooseInMenu } from '../../support/menu.js';

/**
 * Publishing, unpublishing, rights review and delete with Undo (docs/research/M2c-interfaces.md §6.5, §6.6, §9.5;
 * behaviours A10, A33) in a city of the admin's own: what the admin does in the photos page is written by the client, the
 * publish trigger and the manifest build run in the Functions emulator, and the manifest they publish is served to the
 * built viewer, which shows what a visitor sees.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** Three photos a few streets apart around Piața Universității, all on screen at zoom 16. */
const PLACES = {
    universitate: { title: 'Piața Universității', lat: 44.4355, lng: 26.1018 },
    teatru: { title: 'Teatrul Național', lat: 44.4365, lng: 26.1036 },
    coltea: { title: 'Spitalul Colțea', lat: 44.4339, lng: 26.1035 },
} as const;

const VIEW = '16/44.43530/26.10280';

async function seedThree(content: ContentWorld, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await seedPublicCity(content, AT);
    for (const [id, place] of Object.entries(PLACES)) {
        await seedPhoto(content, { id, title: place.title, extra: { location: { lat: place.lat, lng: place.lng }, ...extra } }, AT);
    }
}

function publishAction(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true });
}

function selectAll(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') });
}

test(
    'Publishing a selection publishes each photo, the public map is updated once, and the viewer shows them',
    { tag: ['@S-A10-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await servePhotoImages(page);
        await seedThree(content);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await expect(photoRow(page, PLACES.coltea.title)).toBeVisible();

        await selectAll(page, lang).click();
        await publishAction(page, lang).click();
        await expect.poll(async () => (await photosBy(content, 'published')).map(([, published]) => published)).toEqual([true, true, true]);

        // One build carries the three; the dashboard says the public map is up to date.
        const manifest = await awaitManifest(content, 'lists the three photos', (built) => entries(built, 'photos').length === 3);
        await page.goto(content.address(lang, 'home', { map: false }));
        await expect(
            page.getByText(templatePattern(translateAdminShell(lang, 'adminShell.home.map.idle', { date: '\u0000' }))),
        ).toBeVisible();

        await openPublicViewer(page, manifest, { lang, hash: VIEW });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(['coltea', 'teatru', 'universitate']);
    },
);

test(
    'Unpublishing a photo takes it off the public map while its public files stay',
    { tag: ['@S-A10-BAD-UNPUBLISH'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        await servePhotoImages(page);
        await rememberPhotoChoices(page, { sticky: { author: 'Arhiva E2E', license: 'CC-BY-4.0' } });
        await seedPublicCity(content, AT);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await photoInput(page).setInputFiles(
            await photoFile(
                testInfo,
                'Ateneul.jpg',
                await jpegBytes('#8b5e3c', { at: [PLACES.universitate.lng, PLACES.universitate.lat] }),
            ),
        );
        await awaitProcessed(content, 1);
        const [id = ''] = Object.keys(await content.collection('photos'));
        await selectAll(page, lang).click();
        await publishAction(page, lang).click();
        await awaitManifest(content, 'lists the photo', (built) => entry(built, 'photos', id) !== undefined);
        const files = await content.emulators.objectNames(`photos/${content.city}/${id}/`, 'demo-hcm-public');
        expect(files.length).toBeGreaterThan(0);

        // Unpublish: the next build leaves it out, and the viewer no longer shows it; its public files stay.
        await photoRow(page, 'Ateneul').getByRole('checkbox').check();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.unpublishAction'), exact: true }).click();
        await expect.poll(async () => (await content.document(`photos/${id}`))?.['published']).toBe(false);
        const manifest = await awaitManifest(content, 'no longer lists the photo', (built) => entry(built, 'photos', id) === undefined);
        await openPublicViewer(page, manifest, { lang, hash: VIEW });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual([]);
        expect(await content.emulators.objectNames(`photos/${content.city}/${id}/`, 'demo-hcm-public')).toEqual(files);
    },
);

test(
    'A new processed photo with a known licence is published by its first Save',
    { tag: ['@S-A10-HAPPY-PUBLISH-ON-SAVE'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        await servePhotoImages(page);
        await rememberPhotoChoices(page, { sticky: { author: 'Arhiva E2E', license: 'CC-BY-4.0' } });
        await seedPublicCity(content, AT);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await photoInput(page).setInputFiles(
            await photoFile(testInfo, 'Teatrul_National.jpg', await jpegBytes('#5e3c8b', { at: [PLACES.teatru.lng, PLACES.teatru.lat] })),
        );
        await awaitProcessed(content, 1);
        const [id = ''] = Object.keys(await content.collection('photos'));

        // Its editor opens with Published on; one Save publishes it with the rest of the draft.
        await photoRow(page, 'Teatrul National').getByRole('link').click();
        await expect(page.getByRole('switch', { name: photosText(lang, 'adminContent.photos.field.published') })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true }).click();
        await expect.poll(async () => (await content.document(`photos/${id}`))?.['published']).toBe(true);
        const manifest = await awaitManifest(content, 'lists the new photo', (built) => entry(built, 'photos', id) !== undefined);
        await openPublicViewer(page, manifest, { lang, hash: VIEW });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual([id]);
    },
);

test(
    "Confirming the rights of a selection on the Rights review filter clears the viewer's note",
    { tag: ['@S-A10-HAPPY-RIGHTS-REVIEW'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await servePhotoImages(page);
        await seedThree(content, { published: true, rightsReview: true });
        await page.goto(content.address(lang, 'photos', { map: false }));
        const note = translate(lang, 'photo.rightsReview');
        const before = await awaitManifest(content, 'lists the photos to review', (built) => entries(built, 'photos').length === 3);
        await openPublicViewer(page, before, { lang, hash: `${VIEW}&photo=teatru` });
        await expect(page.getByText(note)).toBeVisible();

        // The Rights review filter lists the three; Confirm rights on all of them.
        await page.goto(content.address(lang, 'photos', { map: false }));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.filter.rightsReview') }).click();
        await expect(photoRow(page, PLACES.teatru.title)).toBeVisible();
        await selectAll(page, lang).click();
        // Confirm rights is among the selection's less frequent actions, in its overflow menu (DECISIONS-for-review.md §42e).
        await chooseInMenu(
            page,
            page.locator('hcm-admin-photo-list .bulk-bar'),
            photosText(lang, 'adminContent.photos.bulk.more'),
            photosText(lang, 'adminContent.photos.bulk.confirmRightsAction'),
        );
        await expect.poll(async () => (await photosBy(content, 'rightsReview')).map(([, review]) => review)).toEqual([false, false, false]);

        // The next build drops the note: the viewer's photo no longer says its rights are being checked.
        const after = await awaitManifest(content, 'no longer flags the rights', (built) =>
            entries(built, 'photos').every((photo) => photo['rightsReview'] !== true),
        );
        await openPublicViewer(page, after, { lang, hash: `${VIEW}&photo=teatru` });
        await expect(page.getByRole('heading', { name: PLACES.teatru.title, exact: true })).toBeVisible();
        await expect(page.getByText(note)).toHaveCount(0);
    },
);

test(
    'Deleting a photo asks first, and Undo brings it back as it was on the public map',
    { tag: ['@S-A33-HAPPY'] },
    async ({ page, lang, content, inputBudget }, testInfo) => {
        test.setTimeout(180_000);
        // A photo processed in the Functions emulator, so its public files exist (a restore whose files are gone would
        // process it again: S-A23-BAD-RESTORE-AFTER-SWEEP), published.
        await servePhotoImages(page);
        await rememberPhotoChoices(page, { sticky: { author: 'Arhiva E2E', license: 'CC-BY-4.0' } });
        await seedPublicCity(content, AT);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await photoInput(page).setInputFiles(
            await photoFile(testInfo, 'Teatrul_National.jpg', await jpegBytes('#5e3c8b', { at: [PLACES.teatru.lng, PLACES.teatru.lat] })),
        );
        await awaitProcessed(content, 1);
        const [id = ''] = Object.keys(await content.collection('photos'));
        await selectAll(page, lang).click();
        await publishAction(page, lang).click();
        await awaitManifest(content, 'lists the photo', (built) => entry(built, 'photos', id) !== undefined);
        await page.goto(content.address(lang, `photos/${id}`, { map: false }));
        const title = 'Teatrul National';
        await expect(page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title }) })).toBeVisible();
        const stored = await content.document(`photos/${id}`);

        // Delete asks first, naming the photo and when it leaves the public map.
        const flow = inputBudget.flow('deleteAndUndo', contentFlowBudget('deleteAndUndo'));
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.delete') }));
        await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.delete.titleOne', { title }) })).toBeVisible();
        const confirm = page.locator('hcm-confirm-dialog');
        await expect(confirm.getByText(photosText(lang, 'adminContent.photos.delete.body'))).toBeVisible();
        await flow.click(confirm.getByRole('button', { name: photosText(lang, 'adminContent.photos.delete.confirm'), exact: true }));
        await expect.poll(() => content.document(`photos/${id}`)).toBeUndefined();
        await expect(photoRow(page, title)).toHaveCount(0);
        // The pointer rests on the snackbar, which holds it and its Undo open (its timer waits while it is pointed at).
        await page
            .getByText(photosText(lang, 'adminContent.photos.deleted', { title }))
            .and(page.locator(':not([aria-live])'))
            .hover();
        await awaitManifest(content, 'no longer lists the photo', (built) => entry(built, 'photos', id) === undefined);
        // The history trigger writes the delete's entry within seconds, which Undo waits for (ten at most); an emulator
        // busy with every worker's triggers takes longer, so the test waits for the entry as a person's few seconds.
        await expect
            .poll(async () => Object.values(await content.collection(`photos/${id}/history`)).map((written) => written['action']), {
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toContain('delete');

        // Undo reverts the delete from its history entry: the photo is back as it was, and so is the public map.
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.undoAction'), exact: true }));
        await expect
            .poll(async () => (await content.document(`photos/${id}`))?.['image'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toEqual(stored?.['image']);
        expect(await content.document(`photos/${id}`)).toMatchObject({ published: true, processing: 'done', title: stored?.['title'] });
        await expect(photoRow(page, title)).toBeVisible();
        const manifest = await awaitManifest(content, 'lists the photo again', (built) => entry(built, 'photos', id) !== undefined);
        await openPublicViewer(page, manifest, { lang, hash: VIEW });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual([id]);
    },
);
