import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { applyTheme } from '../../src/theme/apply.js';
import { HCM_PHOTO_LIST_TAG, HcmPhotoList, defineHcmPhotoList } from '../../src/viewer/hcm-photo-list.js';
import { VIEWER_BASELINE } from '../../src/viewer/viewer-baseline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

describe('<hcm-photo-list>', () => {
    beforeAll(() => {
        defineHcmPhotoList();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_everyPhotoWithItsDateAndACount', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos, manifestUrl: TEST_MANIFEST_URL });

        await expect.element(page.getByRole('status')).toHaveTextContent('3 fotografii');
        await expect.element(page.getByRole('list', { name: 'Lista fotografiilor' })).toBeVisible();
        expect(shadowQueryAll(element, 'button').map((button) => button.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Mihai Vodă Anii 1978–1979',
            'Strada Uranus Iulie 1984',
            'Fără an An necunoscut',
        ]);
        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('src')).toBe(
            `${location.origin}/seed/bucharest/derived/mihai-voda-1978/thumb.webp`,
        );
    });

    it('happyPath_aerialPhotosAreLabelledAndFilteredByKind', async () => {
        const [first, second] = MANIFEST.photos;
        if (first === undefined || second === undefined) {
            throw new Error('the fixture has two photos');
        }
        const photos = [{ ...first, kind: 'aerial' as const }, second];
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos, locale: 'en', manifestUrl: TEST_MANIFEST_URL });

        await expect.element(page.getByRole('group', { name: 'Kind of photo' })).toBeVisible();
        expect(shadowQueryAll(element, '.date')[0]?.textContent).toBe('Aerial photo · Years 1978–1979');

        await page.getByRole('radio', { name: 'Aerial' }).click();
        await expect.element(page.getByRole('status')).toHaveTextContent('1 photo');
        await page.getByRole('radio', { name: 'Street' }).click();
        expect(shadowQueryAll(element, '.title').map((title) => title.textContent)).toEqual(['Strada Uranus']);
        await page.getByRole('radio', { name: 'All' }).click();
        await expect.element(page.getByRole('status')).toHaveTextContent('2 photos');
    });

    it('happyPath_interiorPhotosGetTheirOwnChoiceAndAerialNone @S-V80-HAPPY-PLACE-MEDIA', async () => {
        const [first, second] = MANIFEST.photos;
        if (first === undefined || second === undefined) {
            throw new Error('the fixture has two photos');
        }
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, {
            photos: [{ ...first, kind: 'interior' as const }, second],
            locale: 'en',
            manifestUrl: TEST_MANIFEST_URL,
        });

        expect(shadowQueryAll(element, 'label').map((label) => label.textContent.trim())).toEqual(['All', 'Street', 'Interior']);
        await page.getByRole('radio', { name: 'Interior' }).click();
        await expect.element(page.getByRole('status')).toHaveTextContent('1 photo');
    });

    it('badPath_noAerialPhotoShowsNoKindChoice', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos, manifestUrl: TEST_MANIFEST_URL });

        expect(shadowQueryAll(element, 'fieldset')).toHaveLength(0);
    });

    it('happyPath_choosingAPhotoFiresItsId', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, {
            photos: MANIFEST.photos,
            locale: 'en',
            manifestUrl: TEST_MANIFEST_URL,
        });
        const events = recordEvents(element, 'hcm-photo-select');

        await page.getByRole('button', { name: /Mihai Vodă church/ }).click();

        expect(events).toEqual([{ type: 'hcm-photo-select', detail: { photoId: 'mihai-voda-1978', scroll: 0 } }]);
        await expect.element(page.getByRole('status')).toHaveTextContent('3 photos');
    });

    // V75: the list remembers where it was scrolled and goes back there.
    it('happyPath_theScrollGoesWithTheChoiceAndComesBack', async () => {
        const box = document.createElement('div');
        box.style.cssText = 'overflow-y: auto; block-size: 80px';
        document.body.append(box);
        const list = document.createElement(HCM_PHOTO_LIST_TAG);
        Object.assign(list, { photos: MANIFEST.photos, locale: 'en', manifestUrl: TEST_MANIFEST_URL });
        box.append(list);
        await list.updateComplete;
        box.scrollTop = 60;
        const events = recordEvents(list, 'hcm-photo-select');

        shadowQueryAll(list, 'button')[2]?.click();
        expect(events).toEqual([{ type: 'hcm-photo-select', detail: { photoId: 'fara-an', scroll: box.scrollTop } }]);
        expect(box.scrollTop).toBeGreaterThan(0);

        box.replaceChildren();
        box.scrollTop = 0;
        const again = document.createElement(HCM_PHOTO_LIST_TAG);
        Object.assign(again, { photos: MANIFEST.photos, manifestUrl: TEST_MANIFEST_URL, restoreScroll: 60 });
        box.append(again);
        await expect.poll(() => box.scrollTop).toBeGreaterThan(0);
    });

    it('badPath_noScrollingBoxNoScroll', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos, restoreScroll: 60 });
        const events = recordEvents(element, 'hcm-photo-select');

        shadowQueryAll(element, 'button')[0]?.click();

        expect(events).toEqual([{ type: 'hcm-photo-select', detail: { photoId: 'mihai-voda-1978', scroll: 0 } }]);
    });

    // M18 item 8: without a map this list is the page; its first rows load their thumbnails at once, the rest lazily.
    it('happyPath_theFirstRowsLoadTheirThumbnailsAtOnceAndTheRestLazily', async () => {
        const photos = Array.from({ length: 5 }, () => MANIFEST.photos)
            .flat()
            .map((photo, index) => ({ ...photo, id: `photo-${String(index)}` }));
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos, manifestUrl: TEST_MANIFEST_URL });

        const loading = shadowQueryAll(element, 'img').map((image) => image.getAttribute('loading'));
        expect(loading.slice(0, 12).every((value) => value === 'eager')).toBe(true);
        expect(loading.slice(12).every((value) => value === 'lazy')).toBe(true);
    });

    it('badPath_noPhotosShowsAZeroCount', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: [] });

        await expect.element(page.getByRole('status')).toHaveTextContent('0 fotografii');
        expect(shadowQueryAll(element, 'li')).toHaveLength(0);
    });

    it('badPath_anUnresolvableThumbnailLeavesAnEmptyImage', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, {
            photos: MANIFEST.photos.slice(0, 1),
            manifestUrl: 'https://[bad',
        });

        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('src')).toBe('');
    });

    it('happyPath_theDateIsBodyMediumSupportingTextUnderABodyLargeTitle', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos.slice(0, 1) });
        element.style.setProperty('--md-sys-typescale-body-medium-size', '14px');
        element.style.setProperty('--md-sys-typescale-body-medium-line-height', '20px');
        element.style.setProperty('--md-sys-typescale-body-large-size', '16px');

        const date = getComputedStyle(shadowQuery(element, '.date'));
        const title = getComputedStyle(shadowQuery(element, '.title'));

        expect([date.fontSize, date.lineHeight, title.fontSize]).toEqual(['14px', '20px', '16px']);
    });

    it('badPath_theDateNeverFallsBackToTheSmallBodyStyle', async () => {
        // The M1 UX review found the dates in body-small (12 px): a theme's body-small never reaches them now. The viewer
        // always sets every token (theme-tokens.test.ts), so the theme here is the viewer's baseline.
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos.slice(0, 1) });
        applyTheme(element, VIEWER_BASELINE, 'light', false);
        element.style.setProperty('--md-sys-typescale-body-small-size', '11px');

        expect(getComputedStyle(shadowQuery(element, '.date')).fontSize).toBe('14px');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmPhotoList();

        expect(customElements.get(HCM_PHOTO_LIST_TAG)).toBe(HcmPhotoList);
    });
});
