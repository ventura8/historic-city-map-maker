import { overlaysFromManifest, withOverlayOpacity, withOverlayVisibility, type Manifest } from '@hcm/shared';
import type { MapLabels } from '@hcm/shared/map-labels';
import { describe, expect, it } from 'vitest';

import {
    CONE_LENGTH_M,
    mapOptions,
    ALL_PHOTOS,
    photoFeatures,
    poiSpecs,
    rasterSpec,
    resolveAssetUrl,
    withPhotoAreas,
    type MapMoment,
} from '../../src/core/map-specs.js';
import { cityView } from '../../src/core/state.js';
import { category, layer, manifest, omit, photo, poi } from './fixtures.js';

const ALL_LABELS = { streets: true, pois: true };

function moment(city: Manifest, labels: MapLabels): MapMoment {
    return { view: cityView(city), locale: 'ro', reducedMotion: false, labels, light: 'day' };
}

describe('map specs', () => {
    it('happyPath_relativeAssetsResolveAgainstTheManifest', () => {
        const base = 'https://storage.example.org/cities/bucuresti/manifest.json';

        expect(resolveAssetUrl('derived/a/web.webp', base)).toBe('https://storage.example.org/cities/bucuresti/derived/a/web.webp');
        expect(resolveAssetUrl('/x.pmtiles', base)).toBe('https://storage.example.org/x.pmtiles');
    });

    it('badPath_httpsOrUnresolvableAssetsStayAsTheyAre', () => {
        expect(resolveAssetUrl('https://cdn.example.org/a.webp', 'https://storage.example.org/m.json')).toBe(
            'https://cdn.example.org/a.webp',
        );
        expect(resolveAssetUrl('derived/a.webp', undefined)).toBe('derived/a.webp');
        expect(resolveAssetUrl('derived/a.webp', 'not a url')).toBe('derived/a.webp');
    });

    it('happyPath_aRasterSpecFollowsItsOverlay', () => {
        const kh4 = layer({
            bounds: [
                [25.95, 44.35],
                [26.2, 44.5],
            ],
            adjustments: { contrast: 0.2 },
        });
        const overlays = withOverlayOpacity(
            withOverlayVisibility(overlaysFromManifest(manifest({ layers: [kh4] })), kh4.id, true),
            kh4.id,
            0.4,
        );

        expect(rasterSpec(kh4, overlays[0], undefined)).toEqual({
            id: 'kh4-1966',
            source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
            minzoom: 10,
            maxzoom: 17,
            visible: true,
            opacity: 0.4,
            order: 1966,
            attribution: 'USGS EROS',
            bounds: [
                [25.95, 44.35],
                [26.2, 44.5],
            ],
            adjustments: { contrast: 0.2 },
        });
    });

    it('happyPath_layersStackByDateNewestOnTopWhateverTheirOrder', () => {
        // The owner 2026-11-09: the map draws a higher `order` on top; the admin's `order` does not count.
        const older = rasterSpec(layer({ id: 'old', year: 1950, order: 9 }), undefined, undefined);
        const newer = rasterSpec(layer({ id: 'new', year: 1980, order: 1 }), undefined, undefined);

        expect(newer.order).toBeGreaterThan(older.order);
        expect([older.order, newer.order]).toEqual([1950, 1980]);
    });

    it('happyPath_withoutAnOverlayTheManifestDefaultsApply', () => {
        const spec = rasterSpec(layer({ defaultVisible: true, opacity: 0.7 }), undefined, undefined);

        expect(spec).toMatchObject({ visible: true, opacity: 0.7 });
        expect(spec).not.toHaveProperty('bounds');
        expect(spec).not.toHaveProperty('adjustments');
        expect(
            rasterSpec(
                layer({
                    bounds: [
                        [25.95, 44.35],
                        [26.2, 44.5],
                    ],
                }),
                undefined,
                undefined,
            ),
        ).not.toHaveProperty('adjustments');
    });

    it('happyPath_theMapCreditsAKnownSourceInTheVisitorsLanguage', () => {
        // The Pixel Tablet, 2026-11-12: the Romanian map's attribution line credited the USGS layers in English.
        const usgs = layer({ attribution: 'USGS EROS, declassified imagery (public domain)' });

        expect(rasterSpec(usgs, undefined, undefined, 'ro').attribution).toBe('USGS EROS, imagini desecretizate (domeniu public)');
        expect(rasterSpec(usgs, undefined, undefined, 'en').attribution).toBe('USGS EROS, declassified imagery (public domain)');
    });

    it('badPath_anUnknownCreditOrNoLanguageKeepsTheStoredText', () => {
        expect(rasterSpec(layer({ attribution: 'Arhiva' }), undefined, undefined, 'en').attribution).toBe('Arhiva');
        expect(
            rasterSpec(layer({ attribution: 'USGS EROS, declassified imagery (public domain)' }), undefined, undefined).attribution,
        ).toBe('USGS EROS, declassified imagery (public domain)');
    });

    it('happyPath_aPmtilesArchiveResolvesAgainstTheManifest', () => {
        const spec = rasterSpec(
            layer({ source: { type: 'pmtiles', url: 'tiles/kh4.pmtiles' } }),
            undefined,
            'https://site.example.org/m/manifest.json',
        );

        expect(spec.source).toEqual({ type: 'pmtiles', url: 'https://site.example.org/m/tiles/kh4.pmtiles' });
    });
});

describe('map specs: photos, POIs, options', () => {
    it('happyPath_photoMarkersAndConesInTheVisitorsLanguage', () => {
        const photos = [photo(), { ...omit(photo(), 'bearing', 'fov', 'year'), id: 'plain' }];

        const data = photoFeatures(photos, 'en');

        expect(data.features).toHaveLength(3);
        expect(data.features[0]).toEqual({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.091611, 44.431722] },
            properties: { id: 'mihai-voda-1978', title: 'Mihai Voda street', year: 1978, bearing: 46.8 },
        });
        expect(data.features[1]?.properties).toEqual({ id: 'plain', title: 'Mihai Voda street', year: null, bearing: null });
        const cone = data.features[2];
        expect(cone?.geometry.type).toBe('Polygon');
        expect(cone?.properties).toEqual({ id: 'mihai-voda-1978' });
        expect(CONE_LENGTH_M).toBe(60);
    });

    it('happyPath_aConeWithoutFieldOfViewUsesTheDefault', () => {
        const data = photoFeatures([omit(photo(), 'fov')], 'ro');

        expect(data.features[1]?.geometry.type).toBe('Polygon');
    });

    it('badPath_photosFarFromTheYearAreStillShownWithTheirYear', () => {
        const [point] = photoFeatures([photo({ year: 1900 })], 'ro').features;
        expect(point?.properties).toMatchObject({ year: 1900 });
        expect(photoFeatures([photo({ year: 1900 })], 'ro', 1980, ALL_PHOTOS).features).toHaveLength(2);
    });

    it('happyPath_theNearYearScopeKeepsOnlyThePhotosWithinItsWindow', () => {
        const scope = { kind: 'near-year', window: 10 } as const;
        expect(photoFeatures([photo({ year: 1900 })], 'ro', 1980, scope).features).toEqual([]);
        expect(photoFeatures([photo({ year: 1975 })], 'ro', 1980, scope).features).toHaveLength(2);
        expect(photoFeatures([photo({ year: 1900 })], 'ro', null, scope).features).toHaveLength(2);
    });

    it('happyPath_oneVectorOverlayPerCategoryWithTheYearsPois', () => {
        const city = manifest();
        const overlays = withOverlayOpacity(overlaysFromManifest(city), 'strazi', 0.3);

        const specs = poiSpecs(city, overlays, 'en', 1870);

        expect(specs.map((spec) => [spec.id, spec.features.map((feature) => feature.properties.id)])).toEqual([
            ['cladiri', ['eveniment']],
            ['strazi', ['strada']],
        ]);
        expect(specs[1]).toMatchObject({ kind: 'poi', color: '#B3261E', icon: 'location_on', visible: true, opacity: 0.3 });
        expect(specs[0]?.features[0]?.properties.title).toBe('Event');
        expect(specs[1]?.features[0]?.properties.title).toBe('Stradă');
    });

    it('happyPath_aBundledIconIsKept', () => {
        const specs = poiSpecs(manifest({ categories: [category()], pois: [poi()] }), [], 'ro', null);

        expect(specs[0]).toMatchObject({ icon: 'domain_disabled', visible: true, opacity: 1 });
    });

    it('badPath_aManifestWithoutPoisHasNoVectorOverlays', () => {
        const city = manifest();
        const bare = { ...omit(city, 'poiCategories', 'pois') };

        expect(poiSpecs(bare, [], 'ro', null)).toEqual([]);
        expect(poiSpecs({ ...city, pois: [] }, [], 'ro', null).every((spec) => spec.features.length === 0)).toBe(true);
        expect(poiSpecs({ ...omit(city, 'pois') }, [], 'ro', null)).toHaveLength(2);
    });

    it('happyPath_mapOptionsOfACity', () => {
        const city = manifest();

        expect(
            mapOptions(city, {
                view: { center: [26.1, 44.43], zoom: 15, bearing: 10 },
                locale: 'en',
                reducedMotion: true,
                labels: ALL_LABELS,
                light: 'day',
            }),
        ).toEqual({
            style: 'mapbox://styles/mapbox/standard-satellite',
            config: { lightPreset: 'day' },
            accessToken: 'pk.test-viewer-token',
            view: { center: [26.1, 44.43], zoom: 15, bearing: 10 },
            minZoom: 10,
            maxZoom: 20,
            maxBounds: city.city.bounds,
            locale: 'en',
            reducedMotion: true,
        });
        const plain = { ...city, city: { ...city.city, basemap: { style: 'mapbox://styles/mapbox/standard' } } };
        expect(mapOptions(plain, moment(city, ALL_LABELS))).not.toHaveProperty('config');
    });

    it('happyPath_aChosenLabelGoesIntoTheMountSoALinkNeverFlashesIt', () => {
        const city = manifest();

        expect(mapOptions(city, moment(city, { streets: false, pois: true })).config).toEqual({
            lightPreset: 'day',
            showRoadLabels: false,
        });
    });

    it('happyPath_theCityConfigStaysItsOwnWhenTheChoiceAgreesWithIt', () => {
        const city = manifest();
        const basemap = { style: 'mapbox://styles/mapbox/standard', config: { showPointOfInterestLabels: false } };
        const quiet = { ...city, city: { ...city.city, basemap } };

        expect(mapOptions(quiet, moment(quiet, { streets: true, pois: false })).config).toEqual({
            ...basemap.config,
            showTransitLabels: false,
        });
        expect(mapOptions(quiet, moment(quiet, ALL_LABELS)).config).toEqual({ showPointOfInterestLabels: true });
    });

    it('happyPath_pointsOfInterestOffHideTransitStationsFromTheFirstFrame', () => {
        const city = manifest();

        expect(mapOptions(city, moment(city, { streets: true, pois: false })).config).toEqual({
            lightPreset: 'day',
            showPointOfInterestLabels: false,
            showTransitLabels: false,
        });
    });

    it('badPath_aCityShowingTransitWithoutPointsOfInterestKeepsItsChoice', () => {
        const city = manifest();
        const basemap = { style: 'mapbox://styles/mapbox/standard', config: { showPointOfInterestLabels: false, showTransitLabels: true } };
        const transit = { ...city, city: { ...city.city, basemap } };

        expect(mapOptions(transit, moment(transit, { streets: true, pois: false })).config).toEqual(basemap.config);
    });
});

describe('map specs: aerial photos', () => {
    it('happyPath_anAerialPhotoIsMarkedAerialAndAStreetPhotoIsNot', () => {
        const data = photoFeatures(
            [
                { ...photo(), kind: 'aerial' },
                { ...photo(), id: 'street', kind: 'ground' },
            ],
            'en',
        );

        expect(data.features[0]?.properties).toMatchObject({ aerial: true });
        expect(data.features[1]?.properties).not.toHaveProperty('aerial');
    });
});

describe('withPhotoAreas: the viewed area of an aerial photo', () => {
    it('happyPath_anAerialPhotosViewedAreaIsAClosedRingFocusedWhileSelected', () => {
        const viewedArea = [
            { lat: 44.431, lng: 26.09 },
            { lat: 44.433, lng: 26.089 },
            { lat: 44.433, lng: 26.094 },
            { lat: 44.431, lng: 26.093 },
        ];
        const aerial = photo({ kind: 'aerial', viewedArea });

        const idle = withPhotoAreas(photoFeatures([aerial], 'ro'), [aerial], null).features[2];
        const selected = withPhotoAreas(photoFeatures([aerial], 'ro'), [aerial], aerial.id).features[2];

        expect(idle?.properties).toEqual({ id: aerial.id, area: true });
        expect(selected?.properties).toEqual({ id: aerial.id, area: true, focus: true });
        expect(selected?.geometry.coordinates).toEqual([
            [
                [26.09, 44.431],
                [26.089, 44.433],
                [26.094, 44.433],
                [26.093, 44.431],
                [26.09, 44.431],
            ],
        ]);
    });

    it('badPath_aPhotoWithoutAViewedAreaDrawsNoArea', () => {
        const plain = photoFeatures([photo()], 'ro');
        const aerial = photo({ year: 1900, kind: 'aerial', viewedArea: [] });

        expect(withPhotoAreas(plain, [photo()], photo().id)).toBe(plain);
        // A photo the timeline's scope hides keeps its area hidden too.
        expect(withPhotoAreas({ type: 'FeatureCollection', features: [] }, [aerial], aerial.id).features).toEqual([]);
    });
});
