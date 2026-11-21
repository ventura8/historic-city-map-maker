/** `<hcm-unplaced-gallery>` (M13, V40): the photos with no place, each linking to the page that signs in. */
import type { UnplacedPhoto } from '@hcm/shared';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { browserServices } from '../../src/viewer/services.js';
import { HCM_UNPLACED_GALLERY_TAG, defineHcmUnplacedGallery, type HcmUnplacedGallery } from '../../src/viewer/hcm-unplaced-gallery.js';
import { HCM_PHOTO_SHEET_TAG, defineHcmPhotoSheet, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { menuAction } from '../../src/viewer/viewer-actions.js';
import { unplacedSheet } from '../../src/viewer/viewer-unplaced.js';
import { mountElement, shadowQueryAll } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';
import { fakeServices } from './viewer-harness.js';

const CONTRIBUTE = 'https://demo.web.app/admin/#/contribute/bucharest';

function firstPhoto() {
    const [photo] = testManifest().photos;
    if (photo === undefined) {
        throw new Error('the fixture has photos');
    }
    return photo;
}

function unplaced() {
    const entries = Object.entries(firstPhoto()).filter(([key]) => !['location', 'bearing', 'fov'].includes(key));
    return { ...(Object.fromEntries(entries) as unknown as UnplacedPhoto), id: 'lost', credit: 'Maria' };
}

describe('<hcm-unplaced-gallery>', () => {
    beforeAll(() => {
        defineHcmUnplacedGallery();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_authorLicenceAndCreditShow @S-V40-HAPPY-RIGHTS', async () => {
        await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, {
            photos: [{ ...unplaced(), license: 'CC-BY-4.0', author: 'Ion', rightsHolder: 'Arhiva', credit: 'Maria' }],
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: null,
            locale: 'en',
        });
        for (const words of ['Ion', 'CC BY 4.0', 'Arhiva', 'Maria']) {
            await expect.element(page.getByText(words, { exact: false })).toBeVisible();
        }
    });

    it('badPath_noAuthorOrCreditLeavesNoEmptyLine @S-V40-HAPPY-RIGHTS', async () => {
        const gone = new Set(['author', 'rightsHolder', 'rightsReview', 'credit']);
        const bare = Object.fromEntries(Object.entries(unplaced()).filter(([key]) => !gone.has(key))) as unknown as UnplacedPhoto;
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, {
            photos: [bare],
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: null,
            locale: 'en',
        });
        expect(shadowQueryAll(element, 'li p')).toHaveLength(1);
    });

    it('happyPath_aPhotoLinksToItsSuggestionPage @S-V40-HAPPY-GALLERY', async () => {
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, {
            photos: [unplaced()],
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: CONTRIBUTE,
            locale: 'en',
        });
        await expect.element(page.getByRole('list', { name: 'Where was this taken?' })).toBeVisible();
        const link = page.getByRole('link', { name: 'I know where' });
        await expect.element(link).toHaveAttribute('href', `${CONTRIBUTE}/lost`);
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('alt')).toBeTruthy();
    });

    it('badPath_noLinkWithoutAContributePage @S-V40-BAD-NO-BACKEND', async () => {
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, { photos: [unplaced()], contributeUrl: null });
        expect(shadowQueryAll(element, 'a')).toHaveLength(0);
        expect(shadowQueryAll(element, 'img')).toHaveLength(1);
    });

    it('happyPath_aPhotoSheetSaysItsCreditAndOffersACorrection @S-V41-HAPPY-CORRECTION-LINK', async () => {
        const photo = firstPhoto();
        await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photo: { ...photo, credit: 'Maria' },
            open: true,
            mode: 'bottom',
            locale: 'en',
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: CONTRIBUTE,
        });
        await expect.element(page.getByText('Added by Maria')).toBeVisible();
        await expect.element(page.getByRole('link', { name: 'Suggest a correction' })).toHaveAttribute('href', `${CONTRIBUTE}/${photo.id}`);
    });

    it('badPath_aThumbnailThatCannotBeResolvedShowsNoAddress', async () => {
        const photo = { ...unplaced(), image: { ...unplaced().image, thumb: 'relative/t.webp' } };
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, { photos: [photo], manifestUrl: 'https://[' });
        expect(shadowQueryAll(element, 'img').map((image) => image.getAttribute('src'))).toEqual(['']);
    });

    it('happyPath_theDockedSheetCloses', () => {
        const closed: string[] = [];
        const host = document.createElement('div');
        document.body.append(host);
        const manifest = { ...testManifest(), unplaced: [unplaced()] };
        const view = { locale: 'en', manifestUrl: TEST_MANIFEST_URL } as const;
        render(
            unplacedSheet(view, manifest, { mode: 'docked', open: true }, (event) => {
                closed.push(event.type);
            }),
            host,
        );
        host.querySelector('hcm-icon-button')?.dispatchEvent(new Event('click'));
        expect(closed).toEqual(['hcm-close']);
    });

    it('happyPath_aManifestWithNoListHasAnEmptyGallery', () => {
        const host = document.createElement('div');
        document.body.append(host);
        render(
            unplacedSheet({ locale: 'en', manifestUrl: '' }, testManifest(), { mode: 'bottom', open: false, inert: true }, () => undefined),
            host,
        );
        expect(host.querySelector('.unplaced-sheet')?.hasAttribute('inert')).toBe(true);
    });

    it('badPath_noCorrectionLinkWithoutAContributePage', async () => {
        const photo = firstPhoto();
        const element = await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photo,
            open: true,
            mode: 'bottom',
            manifestUrl: TEST_MANIFEST_URL,
        });
        expect(shadowQueryAll(element, 'a').filter((link) => link.textContent.includes('Propune'))).toHaveLength(0);
    });
});

describe('the menu', () => {
    it('happyPath_contributeOpensAPageOfItsOwn_inTheMapsLanguage_namingTheCity @S-V41-HAPPY-LINK', () => {
        const openPage = vi.fn();
        const manifest = { ...testManifest(), contributeUrl: CONTRIBUTE };
        menuAction(new FakeStore(readyState(manifest, { locale: 'en' })), fakeServices({ openPage }), 'contribute');
        menuAction(new FakeStore(readyState(manifest, { locale: 'ro' })), fakeServices({ openPage }), 'contribute');
        const [en, ro] = openPage.mock.calls.map(([url]) => new URL(String(url)));
        expect(en?.hash).toBe('#/contribute/bucharest');
        expect(en?.origin.concat(en.pathname)).toBe('https://demo.web.app/admin/');
        expect(Object.fromEntries(en?.searchParams ?? [])).toEqual({ lang: 'en', name: manifest.city.name.en });
        expect(Object.fromEntries(ro?.searchParams ?? [])).toEqual({ lang: 'ro', name: manifest.city.name.ro });
    });

    it('badPath_noPageNoOpening', () => {
        const openPage = vi.fn();
        menuAction(new FakeStore(readyState()), fakeServices({ openPage }), 'contribute');
        expect(openPage).not.toHaveBeenCalled();
    });

    it('happyPath_theGalleryIsASheet', () => {
        const store = new FakeStore(readyState());
        menuAction(store, fakeServices(), 'unplaced');
        expect(store.callsOf('openSheet')).toEqual([['unplaced']]);
    });

    it('happyPath_theBrowserOpensItWithNothingPassedOn', () => {
        const open = vi.fn();
        browserServices({ navigator: {}, location: { href: 'x' }, open, matchMedia: () => null } as unknown as Window).openPage(CONTRIBUTE);
        expect(open).toHaveBeenCalledWith(CONTRIBUTE, '_blank', 'noopener');
    });
});
