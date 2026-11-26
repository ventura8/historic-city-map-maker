import { translate } from '@hcm/shared';
import type { Page, Route } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ContentWorld } from '../../support/content.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { heicBytes, jpegBytes, photoFile } from '../../support/images.js';
import { photoError, photoInput, photosText, rememberPhotoChoices, servePhotoImages } from '../../support/photos.js';

/**
 * Replacing a published photo's image (docs/research/M2c-interfaces.md §6.4; behaviour A37) in a city of the admin's own:
 * the photo is first added through the list (so its image is a real one `photos.onUpload` made in the Functions emulator)
 * and published; **Replace image** in its editor uploads another file into the photo's own folder while the document and
 * the public map keep the old image, then `photos.onUpload` swaps the image in one write. A refused file (HEIC) leaves the
 * photo published with its image and says why; Cancel during the upload changes nothing; the photo's own file again
 * changes nothing and says so. The same flow adds an improved or colorized version (the owner 2026-11-09; A140): its own
 * Add a file beside the image, its credit saved with the draft, the public map's switch; a file that is no photo is refused
 * before anything is sent.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** Where the photos were taken (the Romanian Athenaeum), as their EXIF says. */
const ATENEU = { at: [26.0972, 44.4412] as const };

interface Stored {
    readonly id: string;
    readonly sha256: string;
}

/** The single photo of the city, once processed: its id and its image's digest. */
async function onlyPhoto(content: ContentWorld): Promise<Stored> {
    let found: Stored = { id: '', sha256: '' };
    await expect
        .poll(
            async () => {
                const [[id, photo] = ['', {}]] = Object.entries(await content.collection('photos'));
                const image = (photo as { image?: { sha256?: string } }).image;
                found = { id, sha256: image?.sha256 ?? '' };
                return found.sha256 !== '';
            },
            { message: 'photos.onUpload processed the photo', timeout: FUNCTIONS_TIMEOUT_MS },
        )
        .toBe(true);
    return found;
}

/**
 * Adds one photo through the list (the licence the admin chose last time, a place from its EXIF), publishes it from its
 * editor and returns it, open in the editor.
 */
async function publishedPhoto(page: Page, content: ContentWorld, lang: 'ro' | 'en', original: string): Promise<Stored> {
    await servePhotoImages(page);
    await rememberPhotoChoices(page, { sticky: { author: 'Arhiva E2E', license: 'CC-BY-4.0' } });
    await seedPublicCity(content, AT);
    await page.goto(content.address(lang, 'photos', { map: false }));
    await photoInput(page).setInputFiles(original);
    const photo = await onlyPhoto(content);
    await page.goto(content.address(lang, `photos/${photo.id}`, { map: false }));
    // A photo added in this session, processed with a known licence, opens with Published on (publish on save, §5.4).
    await expect(page.getByRole('switch', { name: photosText(lang, 'adminContent.photos.field.published') })).toHaveAttribute(
        'aria-checked',
        'true',
    );
    await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true }).click();
    await expect.poll(async () => (await content.document(`photos/${photo.id}`))?.['published']).toBe(true);
    return photo;
}

/** Chooses `file` with Replace image (a hidden file input of the editor). */
async function replaceWith(page: Page, lang: 'ro' | 'en', file: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.replace') }).click();
    await (await chooser).setFiles(file);
}

/** The replacement's message in the editor's banner (the uploading one with any percentage). */
function banner(page: Page, lang: 'ro' | 'en', key: Parameters<typeof photosText>[1]) {
    const [before = '', after = ''] = photosText(lang, key, { percent: '\u0000' }).split('\u0000');
    const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return page.locator('hcm-admin-photo-editor .banner p').filter({ hasText: new RegExp(`^${escape(before)}\\d*${escape(after)}$`) });
}

test(
    "Replacing a published photo's image swaps it in one write and keeps it published",
    { tag: ['@S-A37-HAPPY'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        const photo = await publishedPhoto(
            page,
            content,
            lang,
            await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU)),
        );
        const before = await awaitManifest(content, 'lists the photo', (built) => entry(built, 'photos', photo.id) !== undefined);
        const oldImage = entry(before, 'photos', photo.id)?.['image'] as { web: string };

        await replaceWith(page, lang, await photoFile(testInfo, 'Ateneul-restaurat.jpg', await jpegBytes('#3c5e8b', ATENEU)));
        await expect(banner(page, lang, 'adminContent.photos.replace.replaced')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        // One write swapped the image; the photo stays published, its texts untouched.
        const after = await content.document(`photos/${photo.id}`);
        const image = after?.['image'] as { sha256: string };
        expect(image.sha256).not.toBe(photo.sha256);
        expect(after).toMatchObject({ published: true, processing: 'done', title: { ro: 'Ateneul' } });
        expect(after?.['replacement']).toBeUndefined();

        // The next manifest names the new files; the viewer shows the photo.
        const manifest = await awaitManifest(content, 'names the new image', (built) => {
            const listed = entry(built, 'photos', photo.id)?.['image'] as { web?: string } | undefined;
            return listed?.web !== undefined && listed.web !== oldImage.web;
        });
        await openPublicViewer(page, manifest, { lang, hash: `17/44.43/26.1&photo=${photo.id}` });
        await expect(page.getByRole('heading', { name: 'Ateneul', exact: true })).toBeVisible();
    },
);

test(
    'A refused replacement keeps the published image and says why',
    { tag: ['@S-A37-BAD-REFUSED'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        const photo = await publishedPhoto(
            page,
            content,
            lang,
            await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU)),
        );

        await replaceWith(page, lang, await photoFile(testInfo, 'Ateneul.heic', heicBytes()));

        await expect(banner(page, lang, 'adminContent.photos.replace.refused')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page.getByText(photoError(lang, 'apiError.photo.heicUnsupported')).first()).toBeVisible();
        const after = await content.document(`photos/${photo.id}`);
        expect(after).toMatchObject({ published: true, processing: 'done', image: { sha256: photo.sha256 } });
        expect(after?.['replacement']).toMatchObject({ error: 'apiError.photo.heicUnsupported' });
    },
);

test(
    'Cancelling a replacement during its upload changes nothing',
    { tag: ['@S-A37-BAD-CANCEL-UPLOAD'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        const photo = await publishedPhoto(
            page,
            content,
            lang,
            await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU)),
        );
        const uploadsBefore = await content.emulators.objectNames(`uploads/photos/${content.city}/`);

        // The upload is held on its way (a slow connection), so it is still running when Cancel is pressed.
        const held: Route[] = [];
        await page.route(/\/v0\/b\/[^/]+\/o\?.*name=uploads/, async (route) => {
            held.push(route);
            await new Promise<void>(() => undefined);
        });
        await replaceWith(page, lang, await photoFile(testInfo, 'Ateneul-nou.jpg', await jpegBytes('#3c5e8b', ATENEU)));
        await expect(banner(page, lang, 'adminContent.photos.replace.uploading')).toBeVisible();
        await expect.poll(() => held.length).toBeGreaterThan(0);
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.replace.cancel') }).click();
        await expect(banner(page, lang, 'adminContent.photos.replace.uploading')).toHaveCount(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });

        expect(await content.emulators.objectNames(`uploads/photos/${content.city}/`)).toEqual(uploadsBefore);
        expect(await content.document(`photos/${photo.id}`)).toMatchObject({ published: true, image: { sha256: photo.sha256 } });
    },
);

test(
    'Replacing a photo with its own file changes nothing and says it is the same image',
    { tag: ['@S-A37-BAD-SAME-FILE'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        const original = await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU));
        const photo = await publishedPhoto(page, content, lang, original);
        const image = (await content.document(`photos/${photo.id}`))?.['image'];

        await replaceWith(page, lang, original);

        await expect(banner(page, lang, 'adminContent.photos.replace.same')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect((await content.document(`photos/${photo.id}`))?.['image']).toEqual(image);
    },
);

/** Chooses `file` with Add a file of the improved or colorized version (A140). */
async function addVersion(page: Page, lang: 'ro' | 'en', kind: 'improved' | 'colorized', file: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    const add = photosText(lang, 'adminContent.photos.version.add');
    await page.locator(`hcm-admin-photo-editor [data-version="${kind}"]`).getByRole('button', { name: add }).click();
    await (await chooser).setFiles(file);
}

test(
    'A colorized version is added beside the published image, credited, and reaches the public map',
    { tag: ['@S-A140-HAPPY'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(240_000);
        const original = await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU));
        const photo = await publishedPhoto(page, content, lang, original);

        await addVersion(page, lang, 'colorized', await photoFile(testInfo, 'Ateneul-color.jpg', await jpegBytes('#c05030', ATENEU)));
        const section = page.locator('hcm-admin-photo-editor [data-version="colorized"]');
        const replaced = section.getByText(photosText(lang, 'adminContent.photos.replace.replaced'));
        await expect(replaced).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await section.getByLabel(photosText(lang, 'adminContent.photos.version.credit')).fill('Ana Pop');
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true }).click();

        await expect.poll(async () => (await content.document(`photos/${photo.id}`))?.['versionCredits']).toEqual({ colorized: 'Ana Pop' });
        expect(await content.document(`photos/${photo.id}`)).toMatchObject({ published: true, image: { sha256: photo.sha256 } });
        const manifest = await awaitManifest(content, 'lists the colorized version', (built) => {
            const versions = entry(built, 'photos', photo.id)?.['versions'] as { colorized?: { credit?: string } } | undefined;
            return versions?.colorized?.credit === 'Ana Pop';
        });
        await openPublicViewer(page, manifest, { lang, hash: `17/44.43/26.1&photo=${photo.id}` });
        await expect(page.getByRole('radiogroup', { name: translate(lang, 'photo.versions') }).getByRole('radio')).toHaveCount(2);
    },
);

test(
    'A file that is no photo is refused at once as a version and nothing is sent',
    { tag: ['@S-A140-BAD-WRONG-TYPE'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        const original = await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c', ATENEU));
        const photo = await publishedPhoto(page, content, lang, original);
        const uploadsBefore = await content.emulators.objectNames(`uploads/photos/${content.city}/`);

        await addVersion(page, lang, 'improved', await photoFile(testInfo, 'note.txt', Buffer.from('not a photo')));

        const section = page.locator('hcm-admin-photo-editor [data-version="improved"]');
        await expect(section.getByText(photosText(lang, 'adminContent.photos.replace.refused'))).toBeVisible();
        await expect(section.getByText(photoError(lang, 'apiError.photo.unsupportedType'))).toBeVisible();
        expect(await content.emulators.objectNames(`uploads/photos/${content.city}/`)).toEqual(uploadsBefore);
        expect((await content.document(`photos/${photo.id}`))?.['versions']).toBeUndefined();
    },
);
