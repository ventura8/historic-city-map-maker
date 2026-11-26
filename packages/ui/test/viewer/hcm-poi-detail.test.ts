import { wikipediaPoi, type Poi, type PoiCategory } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_POI_DETAIL_TAG, HcmPoiDetail, defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { defineKitDoubles, mountElement, recordEvents, segmentLabels, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
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

    it('happyPath_aPlaceWithNoYearsSaysTheyAreUnknown @S-V24-HAPPY-NO-YEARS', async () => {
        const element = await detail({ poi: poi('eveniment'), category: category('evenimente'), locale: 'en' });

        expect(element.shadowRoot?.querySelector('.years')?.textContent).toBe('Years unknown (research ongoing)');
    });

    it('badPath_aPlaceWithYearsNeverSaysTheyAreUnknown @S-V24-BAD-NO-YEARS', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri'), locale: 'en' });

        expect(shadowText(element)).not.toContain('Years unknown');
    });

    it('badPath_markupInTheDescriptionIsText', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri') });

        expect(element.shadowRoot?.querySelector('.description b')).toBeNull();
        expect(shadowText(element)).toContain('<b>Nu este HTML</b>');
    });

    it('badPath_anUnbundledIconIsTheDefaultPin', async () => {
        const element = await detail({ poi: poi('eveniment'), category: category('evenimente') });

        expect((shadowQuery(element, '.swatch hcm-icon') as HTMLElement & { name: string }).name).toBe('location_on');
        expect(element.shadowRoot?.querySelector('.years')?.textContent).toBe('Ani necunoscuți (cercetare în curs)');
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
        expect(element.shadowRoot?.querySelector('.current-name')).toBeNull();
    });

    it('happyPath_aRenamedStreetShowsItsCurrentName @S-V71-HAPPY-RENAMED', async () => {
        const element = await detail({
            poi: { ...poi('casa-uranus'), currentName: { ro: 'Calea Victoriei', en: 'Calea Victoriei' } },
            category: category('cladiri'),
            locale: 'en',
        });

        expect(shadowText(element)).toContain('Current name: Calea Victoriei');
        expect(element.shadowRoot?.querySelector('.current-name')).not.toBeNull();
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

describe('<hcm-poi-detail> a Wikipedia article', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aWikipediaArticleShowsItsFreeThumbnailTextAndLink @S-V90-HAPPY-ARTICLE', async () => {
        const article = {
            id: 'ro-1',
            lng: 26.0973,
            lat: 44.4413,
            versions: { ro: { title: 'Ateneul Român', extract: 'Sală de *concerte*.', url: 'https://ro.wikipedia.org/wiki/A' } },
            thumb: 'wikipedia/ro-1.jpg',
        };
        const wiki: PoiCategory = {
            ...category('cladiri'),
            id: 'wikipedia',
            label: { ro: 'Wikipedia', en: 'Wikipedia' },
            attribution: 'Wikipedia (CC BY-SA 4.0)',
        };
        const element = await detail({ poi: wikipediaPoi(article, 'ro'), category: wiki, thumbnail: article.thumb, locale: 'ro' });

        const picture = shadowQuery(element, 'img.picture');
        expect(picture.getAttribute('src')).toBe(new URL('wikipedia/ro-1.jpg', TEST_MANIFEST_URL).href);
        expect(picture.getAttribute('alt')).toBe('');
        const text = shadowText(element);
        expect(text).toContain('Sală de *concerte*.');
        expect(text).toContain('Sursa: Wikipedia (CC BY-SA 4.0)');
        expect(text).not.toContain('Ani necunoscuți');
        expect(shadowQuery(element, 'a').textContent).toContain('Citește pe Wikipedia');
    });

    it('badPath_noThumbnailOrAnUnreadableAddressShowsNoPicture', async () => {
        const element = await detail({ poi: poi('casa-uranus'), category: category('cladiri'), thumbnail: null });
        expect(element.shadowRoot?.querySelector('img.picture')).toBeNull();
        const broken = await detail({
            poi: poi('casa-uranus'),
            category: category('cladiri'),
            thumbnail: 'a.jpg',
            manifestUrl: 'https://[',
        });
        expect(broken.shadowRoot?.querySelector('img.picture')).toBeNull();
    });
});

describe('<hcm-poi-detail> media (M17 §12)', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aPlaceShowsItsMediaByKindAndAMapOpensOnTheMap @S-V80-HAPPY-PLACE-MEDIA', async () => {
        const place = poi('casa-uranus');
        const [first, second] = MANIFEST.photos;
        const layer = MANIFEST.layers[0];
        if (first === undefined || second === undefined || layer === undefined) {
            throw new Error('fixture');
        }
        const element = await detail({
            poi: { ...place, photoIds: [first.id] },
            photos: [first, { ...second, kind: 'interior', placeIds: [place.id] }],
            layers: [{ ...layer, placeIds: [place.id] }],
            category: category('cladiri'),
            locale: 'en',
        });

        expect(shadowText(element)).toContain('Media');
        const chips = segmentLabels(element, '.kinds');
        expect(chips).toEqual(['Maps', 'Exterior', 'Interior']);
        const events = recordEvents(element, 'hcm-layer-show');
        await page.getByRole('button', { name: `Show the map on the map: ${layer.label.en}` }).click();
        expect(events).toEqual([{ type: 'hcm-layer-show', detail: { layerId: layer.id } }]);

        await page.getByRole('radio', { name: 'Interior' }).click();
        await element.updateComplete;
        expect(shadowQueryAll(element, '.thumbs button')).toHaveLength(1);
    });

    it('badPath_aPlaceWithoutMediaShowsNoMediaAndANewPlaceStartsAtItsFirstKind @S-V80-BAD-NO-MEDIA', async () => {
        const element = await detail({
            poi: { ...poi('casa-uranus'), photoIds: [] },
            category: category('cladiri'),
            layers: MANIFEST.layers,
        });
        expect(element.shadowRoot?.querySelector('.media')).toBeNull();

        element.mediaKind = 'interior';
        element.poi = poi('casa-uranus');
        await element.updateComplete;
        expect(element.mediaKind).toBeNull();
        expect(shadowQueryAll(element, '.thumbs button')).toHaveLength(2);
    });

    it('happyPath_aBuildingsPlansShowByLevelWithTheirInteriorPhotos @S-V82-HAPPY-LEVELS', async () => {
        const place = poi('casa-uranus');
        const [first, second] = MANIFEST.photos;
        const [plan, upper] = MANIFEST.layers;
        if (first === undefined || second === undefined || plan === undefined || upper === undefined) {
            throw new Error('fixture');
        }
        const element = await detail({
            poi: { ...place, photoIds: [] },
            photos: [
                { ...first, kind: 'interior', placeIds: [place.id], level: 0 },
                { ...second, kind: 'interior', placeIds: [place.id], level: 1 },
            ],
            layers: [
                { ...plan, placeIds: [place.id], level: { order: 1, label: { ro: 'Etaj 1', en: 'First floor' } } },
                { ...upper, placeIds: [place.id], level: { order: 0, label: { ro: 'Parter', en: 'Ground floor' } } },
            ],
            category: category('cladiri'),
            locale: 'en',
        });

        await page.getByRole('radio', { name: 'Plans' }).click();
        await element.updateComplete;
        expect(segmentLabels(element, '.levels')).toEqual(['Ground floor', 'First floor']);
        expect(shadowQueryAll(element, '.thumbs button')).toHaveLength(1);
        await page.getByRole('radio', { name: 'First floor' }).click();
        await element.updateComplete;
        expect(shadowQueryAll(element, '.maps button')[0]?.getAttribute('aria-label')).toContain(plan.label.en);
        expect(shadowQueryAll(element, '.maps button')).toHaveLength(1);
    });
});
