import type { Poi, PoiCategory } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_POI_DETAIL_TAG, HcmPoiDetail, defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

function poi(id: string): Poi {
    const found = (MANIFEST.pois ?? []).find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(id);
    }
    return found;
}

function category(id: string): PoiCategory {
    const found = (MANIFEST.poiCategories ?? []).find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(id);
    }
    return found;
}

async function detail(properties: Partial<HcmPoiDetail>): Promise<HcmPoiDetail> {
    return mountElement<HcmPoiDetail>(HCM_POI_DETAIL_TAG, { photos: MANIFEST.photos, manifestUrl: TEST_MANIFEST_URL, ...properties });
}

describe('<hcm-poi-detail>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aPlaceShowsItsCredit @S-V40-HAPPY-RIGHTS', async () => {
        const element = await detail({ poi: { ...poi('casa-uranus'), credit: 'Maria' }, category: category('cladiri') });
        expect(shadowText(element)).toContain('Maria');
    });

    it('happyPath_categoryYearsDescriptionLinksAndPhotos', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri') });

        const text = shadowText(element);
        expect(text).toContain('Categoria: Clădiri dispărute');
        expect(text).toContain('Între 1890 și 1984');
        expect(element.shadowRoot?.querySelector('.description strong')?.textContent).toBe('Demolată');
        await expect
            .element(page.getByRole('link', { name: 'Fișa', exact: true }))
            .toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect.element(page.getByRole('link', { name: 'Fișa locului' })).toHaveAttribute('href', 'https://example.org/poi/casa');
        const swatch = shadowQuery(element, '.swatch');
        expect(swatch.style.getPropertyValue('--hcm-poi-color')).toBe('#8B5E3C');
        expect((shadowQuery(element, '.swatch hcm-icon') as HTMLElement & { name: string }).name).toBe('domain_disabled');
        expect(shadowQueryAll(element, '.thumbs button')).toHaveLength(2);
    });

    it('happyPath_aThumbnailOpensItsPhoto', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri'), locale: 'en' });
        const events = recordEvents(element, 'hcm-photo-select');

        await page.getByRole('button', { name: 'Open the photo: Mihai Vodă church' }).click();

        expect(events).toEqual([{ type: 'hcm-photo-select', detail: { photoId: 'mihai-voda-1978' } }]);
        expect(shadowText(element)).toContain('Category: Vanished buildings');
    });

    it('badPath_photoThumbnailsShareOneTopEdgeInsteadOfTakingTheListGap', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri') });

        const tops = shadowQueryAll(element, '.thumbs li').map((item) => item.getBoundingClientRect().top);
        expect(tops).toHaveLength(2);
        expect(tops[1]).toBe(tops[0]);
    });

    it('badPath_markupInTheDescriptionIsText', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri') });

        expect(element.shadowRoot?.querySelector('.description b')).toBeNull();
        expect(shadowText(element)).toContain('<b>Nu este HTML</b>');
    });

    it('badPath_anUnbundledIconIsTheDefaultPin', async () => {
        const element = await detail({ poi: poi('eveniment'), category: category('evenimente') });

        expect((shadowQuery(element, '.swatch hcm-icon') as HTMLElement & { name: string }).name).toBe('location_on');
        expect(element.shadowRoot?.querySelector('.years')).toBeNull();
        expect(element.shadowRoot?.querySelector('.description')).toBeNull();
        expect(element.shadowRoot?.querySelector('section')).toBeNull();
    });

    it('badPath_anInvalidColourIsNotApplied', async () => {
        const element = await detail({ poi: poi('cvartal'), category: { ...category('cladiri'), color: 'red; background: url(x)' } });

        expect(shadowQuery(element, '.swatch').getAttribute('style') ?? '').toBe('');
        expect(shadowText(element)).toContain('Din 1900');
    });

    it('badPath_unknownPhotoIdsAndNoCategoryAreSkipped', async () => {
        const stray = { ...poi('casa-uranus'), photoIds: ['nu-exista'] };
        const element = await detail({ poi: stray, category: null });

        expect(element.shadowRoot?.querySelector('.category')).toBeNull();
        expect(element.shadowRoot?.querySelector('.thumbs')).toBeNull();
    });

    it('happyPath_aTracedStreetNamesItsMapAndItsCategorysCredit @S-V71-HAPPY-SOURCES', async () => {
        const credited = { ...category('cladiri'), attribution: 'OpenHistoricalMap (CC0)' };
        const element = await detail({
            poi: { ...poi('casa-uranus'), sourceLayer: 'kh9-1977' },
            category: credited,
            layers: MANIFEST.layers,
            locale: 'en',
        });

        const text = shadowText(element);
        expect(text).toContain('Sources');
        expect(text).toContain(`Seen on: ${MANIFEST.layers.find((layer) => layer.id === 'kh9-1977')?.label.en ?? ''}`);
        expect(text).toContain('Source: OpenHistoricalMap (CC0)');
    });

    it('badPath_aSourceLayerTheManifestLacksSaysNothing @S-V71-BAD-UNKNOWN-LAYER', async () => {
        const element = await detail({
            poi: { ...poi('casa-uranus'), sourceLayer: 'gone-1911' },
            category: category('cladiri'),
            layers: MANIFEST.layers,
        });

        expect(element.shadowRoot?.querySelector('.sources')).toBeNull();
    });

    it('badPath_noPoiRendersNothing', async () => {
        const element = await detail({ poi: null });

        expect(shadowText(element)).toBe('');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmPoiDetail();

        expect(customElements.get(HCM_POI_DETAIL_TAG)).toBe(HcmPoiDetail);
    });
});
