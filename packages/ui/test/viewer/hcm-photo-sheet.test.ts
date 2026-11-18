import type { Photo } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_PHOTO_SHEET_TAG, HcmPhotoSheet, defineHcmPhotoSheet, locateOffset } from '../../src/viewer/hcm-photo-sheet.js';
import { defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

function photo(id: string): Photo {
    const found = MANIFEST.photos.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(id);
    }
    return found;
}

type PhotoSheetProps = Partial<HcmPhotoSheet> & { readonly backToList?: boolean };

async function sheet(properties: PhotoSheetProps = {}): Promise<HcmPhotoSheet> {
    return mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
        photos: MANIFEST.photos,
        open: true,
        mode: 'docked',
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
}

describe('<hcm-photo-sheet>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_photoDetailsAsTextAndSafeLinks', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });

        await expect.element(page.getByRole('heading', { name: 'Mihai Vodă' })).toBeVisible();
        const text = shadowText(element);
        expect(text).toContain('Anii 1978–1979');
        expect(text).toContain('Autor: Dan Vartanian');
        expect(text).toContain('Publicată cu permisiune, din proiectul comunitar original');
        expect(text).toContain('Drepturile acestei fotografii sunt în curs de verificare.');
        expect(text).toContain('Strada spre Dâmbovița.');
        const link = page.getByRole('link', { name: 'Flickr' });
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect.element(link).toHaveAttribute('target', '_blank');
        const image = shadowQuery(element, 'img') as HTMLImageElement;
        expect(image.getAttribute('src')).toBe(`${location.origin}/seed/bucharest/derived/mihai-voda-1978/thumb.webp`);
        expect(image.alt).toBe('Mihai Vodă');
        expect(image.loading).toBe('lazy');
    });

    it('happyPath_theRightsHolderFollowsTheLicence', async () => {
        const element = await sheet({ photo: photo('uranus-1984') });

        expect(shadowText(element)).toContain('© Arhiva Uranus');
    });

    it('badPath_noRightsHolderLineWithoutOne', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });

        expect(shadowText(element)).not.toContain('©');
    });

    it('happyPath_backToTheListWhenOpenedFromIt', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978'), locale: 'en', backToList: true });
        const events = recordEvents(element, 'hcm-photo-back');

        await page.getByRole('button', { name: 'Back to the list' }).click();

        expect(events).toEqual([{ type: 'hcm-photo-back', detail: null }]);
    });

    it('badPath_noBackFromTheMap', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978'), locale: 'en' });

        expect(element.shadowRoot?.querySelector('.back')).toBeNull();
    });

    it('happyPath_englishTitleAndTheLightboxButton', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978'), locale: 'en' });
        const events = recordEvents(element, 'hcm-lightbox-open');

        await page.getByRole('button', { name: 'Open the full-size photo' }).click();

        expect(events).toEqual([{ type: 'hcm-lightbox-open', detail: { photoId: 'mihai-voda-1978' } }]);
        await expect.element(page.getByRole('heading', { name: 'Mihai Vodă church' })).toBeVisible();
    });

    it('badPath_aMissingImageShowsAPlaceholderNamedAfterThePhoto', async () => {
        const element = await sheet({ photo: photo('fara-an') });

        shadowQuery(element, 'img').dispatchEvent(new Event('error'));
        await element.updateComplete;

        expect(element.shadowRoot?.querySelector('img')).toBeNull();
        await expect.element(page.getByRole('img', { name: 'Fără an' })).toBeVisible();
        expect(shadowText(element)).toContain('Imaginea nu s-a putut încărca.');
        expect(shadowText(element)).toContain('An necunoscut');

        element.photo = photo('uranus-1984');
        await element.updateComplete;
        expect(element.imageFailed).toBe(false);
        expect(shadowText(element)).toContain('Iulie 1984');
        expect(element.shadowRoot?.querySelector('.details section')).toBeNull();
    });

    it('happyPath_aDecodedThumbnailSaysItIsShown', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });
        const events = recordEvents(element, 'hcm-photo-shown');

        const image = shadowQuery(element, 'img') as HTMLImageElement;
        // The decode of a lazy image the test never scrolls to: settled at once, as a browser does once it decoded.
        image.decode = () => Promise.reject(new DOMException('not decodable', 'EncodingError'));
        image.dispatchEvent(new Event('load'));

        await expect.poll(() => events).toEqual([{ type: 'hcm-photo-shown', detail: { ok: true } }]);
    });

    it('badPath_aThumbnailThatFailsSaysSo', async () => {
        const element = await sheet({ photo: photo('fara-an') });
        const events = recordEvents(element, 'hcm-photo-shown');

        shadowQuery(element, 'img').dispatchEvent(new Event('error'));

        expect(events).toEqual([{ type: 'hcm-photo-shown', detail: { ok: false } }]);
    });

    it('badPath_anUnresolvableImageAddressIsAPlaceholderToo', async () => {
        const element = await sheet({ photo: photo('fara-an'), manifestUrl: 'https://[bad' });

        expect(element.shadowRoot?.querySelector('img')).toBeNull();
        expect(element.shadowRoot?.querySelector('.placeholder')).not.toBeNull();
    });

    it('happyPath_aPoiRendersItsDetailsInTheSameSheet', async () => {
        const poi = MANIFEST.pois?.find((candidate) => candidate.id === 'casa-uranus') ?? null;
        const category = MANIFEST.poiCategories?.[0] ?? null;
        const element = await sheet({ poi, category, photo: photo('uranus-1984'), mode: 'bottom' });

        const frame = shadowQuery(element, 'hcm-sheet') as HTMLElement & { label: string; variant: string };
        expect(frame.label).toBe('Casa de pe Uranus');
        expect(frame.variant).toBe('bottom');
        const detail = shadowQuery(element, 'hcm-poi-detail') as HTMLElement & { poi: unknown };
        expect(detail.poi).toBe(poi);
    });

    it('badPath_nothingSelectedLeavesAnEmptySheet', async () => {
        const element = await sheet({ mode: 'side' });

        const frame = shadowQuery(element, 'hcm-sheet') as HTMLElement & { label: string };
        expect(frame.label).toBe('');
        expect(element.shadowRoot?.querySelector('.details')).toBeNull();
    });

    it('happyPath_dockedCloseFiresClose', async () => {
        const element = await sheet({ photo: photo('fara-an') });
        const events = recordEvents(element, 'hcm-close');

        await page.getByRole('button', { name: 'Închide' }).click();

        expect(events).toHaveLength(1);
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmPhotoSheet();

        expect(customElements.get(HCM_PHOTO_SHEET_TAG)).toBe(HcmPhotoSheet);
    });
});

describe('<hcm-photo-sheet>: the source', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theSourceIsAPlainLinkToANewTab', async () => {
        const source = { url: 'https://arhiva.example/foto/1', label: 'Arhiva' };
        const element = await sheet({ photo: { ...photo('mihai-voda-1978'), source } });

        expect(shadowQuery(element, '.source').textContent.replace(/\s+/g, ' ').trim()).toBe('Sursa: Arhiva');
        const link = page.getByRole('link', { name: 'Arhiva' });
        await expect.element(link).toHaveAttribute('href', source.url);
        await expect.element(link).toHaveAttribute('target', '_blank');
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    });

    it('happyPath_aSourceWithoutANameShowsItsHost', async () => {
        await sheet({ photo: { ...photo('mihai-voda-1978'), source: { url: 'https://arhiva.example/foto/1' } } });

        await expect.element(page.getByRole('link', { name: 'arhiva.example' })).toBeVisible();
    });

    it('badPath_noSourceNoLine', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });

        expect(shadowQueryAll(element, '.source')).toEqual([]);
    });

    it('happyPath_theLoneLinksAreFullTouchTargets', async () => {
        // The Pixel Tablet (2026-11-12): "Street View" and "Propune o corectură" were 19 px tall, too small for a finger.
        await sheet({ photo: photo('mihai-voda-1978'), contributeUrl: 'https://example.test/contribute' });

        for (const name of ['Deschide în Google Street View', 'Propune o corectură']) {
            const link = page.getByRole('link', { name });
            await expect.element(link).toBeVisible();
            expect(link.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
        }
    });

    it('badPath_aLinkInsideASentenceKeepsItsLineHeight', async () => {
        await sheet({ photo: { ...photo('mihai-voda-1978'), source: { url: 'https://arhiva.example/foto/1', label: 'Arhiva' } } });

        const link = page.getByRole('link', { name: 'Arhiva' });
        await expect.element(link).toBeVisible();
        expect(link.element().getBoundingClientRect().height).toBeLessThan(48);
    });

    it('badPath_aSourceThatIsNotHttpsIsNoLink', async () => {
        const element = await sheet({ photo: { ...photo('mihai-voda-1978'), source: { url: 'javascript:alert(1)', label: 'Arhiva' } } });

        expect(shadowQuery(element, '.source').textContent).toContain('Arhiva');
        expect(shadowQueryAll(element, '.source a')).toEqual([]);
    });
});

describe('<hcm-photo-sheet>: Show on map (V51)', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_showOnMapBesideADockedSheetAsksForThePlaceInTheMiddle', async () => {
        const element = await sheet({ photo: photo('uranus-1984'), locale: 'en', canLocate: true });
        const events = recordEvents(element, 'hcm-photo-locate');

        await page.getByRole('button', { name: 'Show on map' }).click();

        expect(events).toEqual([{ type: 'hcm-photo-locate', detail: { photoId: 'uranus-1984', offset: [0, 0] } }]);
    });

    it('happyPath_aBottomSheetSendsThePlaceHalfwayUpWhatItLeaves', async () => {
        const element = await sheet({ photo: photo('uranus-1984'), mode: 'bottom', canLocate: true });
        const events = recordEvents(element, 'hcm-photo-locate');

        await page.getByRole('button', { name: 'Arată pe hartă' }).click();

        const surface = (shadowQuery(element, 'hcm-sheet') as HTMLElement & { sheet(): HTMLElement }).sheet();
        const height = surface.getBoundingClientRect().height;
        expect(height).toBeGreaterThan(0);
        expect(events).toEqual([{ type: 'hcm-photo-locate', detail: { photoId: 'uranus-1984', offset: [0, -height / 2] } }]);
    });

    it('badPath_withoutAMapThereIsNoShowOnMap', async () => {
        const element = await sheet({ photo: photo('uranus-1984') });

        expect(shadowText(element)).not.toContain('Arată pe hartă');
    });

    it('badPath_aPlaceDetailHasNoShowOnMap', async () => {
        const poi = MANIFEST.pois?.[0];
        const element = await sheet({ poi: poi ?? null, canLocate: true });

        expect(shadowText(element)).not.toContain('Arată pe hartă');
    });

    it('happyPath_aSideSheetSendsThePlaceHalfwayAlongWhatItLeaves', () => {
        const map = new DOMRect(0, 0, 768, 900);
        expect(locateOffset('side', new DOMRect(408, 0, 360, 900), map)).toEqual([-180, 0]);
        expect(locateOffset('bottom', new DOMRect(0, 400, 360, 300), new DOMRect(0, 0, 360, 700))).toEqual([0, -150]);
    });

    it('badPath_aSideSheetOnTheLeftOfARightToLeftPageSendsThePlaceToItsRight', () => {
        expect(locateOffset('side', new DOMRect(0, 0, 360, 900), new DOMRect(0, 0, 768, 900))).toEqual([180, 0]);
        expect(locateOffset('side', new DOMRect(100, 0, 360, 412), new DOMRect(100, 0, 915, 412))).toEqual([180, 0]);
    });

    it('badPath_noSheetSurfaceLeavesThePlaceInTheMiddle', () => {
        expect(locateOffset('docked', undefined, undefined)).toEqual([0, 0]);
        expect(locateOffset('bottom', undefined, new DOMRect(0, 0, 360, 700))).toEqual([0, 0]);
        expect(locateOffset('bottom', new DOMRect(0, 400, 360, 300), undefined)).toEqual([0, 0]);
    });
});
