/**
 * The manifest of a city from its documents: the manifest shapes, the order, the English fallback, what is listed,
 * and every way a document is left out (reported, never failing the build) or the city itself refused.
 */
import { validateManifest, type CityDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import type { InvalidDocument, QueryResult } from '../../src/ports/documents.js';
import { assembleManifest, type Assembly, type CityContent } from '../../src/publish/assemble.js';
import { TEST_CONFIG } from './fakes.js';
import { CITY_ID, categoryDoc, cityDoc, layerDoc, photoDoc, poiDoc } from './city.js';

function result<T>(documents: readonly (readonly [string, T])[], invalid: readonly InvalidDocument[] = []): QueryResult<T> {
    return { documents: documents.map(([id, data]) => ({ id, path: `cities/${CITY_ID}/x/${id}`, data })), invalid };
}

function content(overrides: Partial<Omit<CityContent, 'city'>> & { readonly city?: Partial<CityDoc> } = {}): CityContent {
    return {
        cityId: CITY_ID,
        layers: result([['flight-1940', layerDoc()]]),
        photos: result([
            ['p2', photoDoc('p2')],
            ['p1', photoDoc('p1', { title: { ro: 'Unu', en: 'One' } })],
        ]),
        poiCategories: result([['churches', categoryDoc()]]),
        pois: result([['enei', poiDoc({ photoIds: ['p1', 'gone'] })]]),
        stories: result([]),
        ...overrides,
        city: cityDoc(overrides.city),
    };
}

function manifestOf(assembly: Assembly) {
    if (!assembly.ok) {
        throw new Error(`refused: ${JSON.stringify(assembly.issues)}`);
    }
    return assembly.manifest;
}

describe('assembleManifest: the manifest', () => {
    it('happyPath_everyListedDocumentInItsManifestShape', () => {
        const assembly = assembleManifest(content(), TEST_CONFIG.errorEndpoint);
        const manifest = manifestOf(assembly);

        expect(validateManifest(manifest).ok).toBe(true);
        expect(assembly.skipped).toEqual([]);
        expect(manifest.city).toMatchObject({
            id: CITY_ID,
            name: { ro: 'București dispărut', en: 'Lost Bucharest' },
            about: { ro: 'Despre **hartă**.', en: 'Despre **hartă**.' },
            bounds: [
                [25.93, 44.33],
                [26.25, 44.55],
            ],
            center: [26.09, 44.44],
            zoom: 13,
            minZoom: 10,
            maxZoom: 20,
            credits: [],
            basemap: { style: 'mapbox://styles/mapbox/standard' },
            mapbox: { publicToken: 'pk.test-viewer-token' },
            analytics: { measurementId: 'G-TEST1234', errorEndpoint: TEST_CONFIG.errorEndpoint },
        });
        expect(manifest.layers).toEqual([
            expect.objectContaining({
                id: 'flight-1940',
                label: { ro: 'Zbor 1940', en: 'Zbor 1940' },
                bounds: [
                    [26, 44.4],
                    [26.2, 44.5],
                ],
            }),
        ]);
        expect(manifest.photos.map((photo) => [photo.id, photo.links, photo.image.w, photo.image.h])).toEqual([
            ['p1', [], 2048, 1365],
            ['p2', [], 2048, 1365],
        ]);
        expect(manifest.photos[0]?.image.web).toBe(photoDoc('p1').image?.web);
        expect(manifest.photosOverlay).toEqual({ defaultOpacity: 0.9 });
        expect(manifest.poiCategories).toEqual([
            { id: 'churches', label: { ro: 'Biserici', en: 'Biserici' }, icon: 'church', color: '#aa3300', defaultOpacity: 0.9 },
        ]);
        expect(manifest.pois).toEqual([
            expect.objectContaining({ id: 'enei', geometry: { type: 'Point', coordinates: [26.1, 44.43] }, links: [], photoIds: ['p1'] }),
        ]);
    });

    it('happyPath_aCityThatSetsItsViewKeepsIt', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({
                    city: {
                        center: { lat: 44.43, lng: 26.1 },
                        zoom: 14.5,
                        minZoom: 12,
                        maxZoom: 21,
                        basemap: { style: 'mapbox://styles/mapbox/standard-satellite' },
                    },
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );

        expect([manifest.city.center, manifest.city.zoom, manifest.city.minZoom, manifest.city.maxZoom]).toEqual([
            [26.1, 44.43],
            14.5,
            12,
            21,
        ]);
        expect(manifest.city.basemap.style).toBe('mapbox://styles/mapbox/standard-satellite');
    });

    it('happyPath_layersAndCategoriesByOrderThenId', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({
                    layers: result([
                        ['b', layerDoc({ order: 2, bounds: undefined })],
                        ['c', layerDoc({ order: 1, description: { ro: 'Descriere' } })],
                        ['a', layerDoc({ order: 2 })],
                    ]),
                    poiCategories: result([
                        ['schools', categoryDoc({ order: 2 })],
                        ['churches', categoryDoc({ order: 2 })],
                        ['parks', categoryDoc({ order: 0 })],
                    ]),
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );

        expect(manifest.layers.map((layer) => layer.id)).toEqual(['c', 'a', 'b']);
        expect(manifest.layers[2]?.bounds).toBeUndefined();
        expect(manifest.layers[0]?.description).toEqual({ ro: 'Descriere', en: 'Descriere' });
        expect(manifest.poiCategories?.map((category) => category.id)).toEqual(['parks', 'churches', 'schools']);
    });

    it('badPath_unpublishedNotReadyAndUnprocessedDocumentsAreNotListed', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({
                    layers: result([
                        ['draft', layerDoc({ published: false })],
                        ['processing', layerDoc({ status: 'processing' })],
                    ]),
                    photos: result([
                        ['hidden', photoDoc('hidden', { published: false })],
                        ['pending', photoDoc('pending', { processing: 'pending' })],
                    ]),
                    pois: result([['secret', poiDoc({ published: false })]]),
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );

        expect([manifest.layers, manifest.photos, manifest.pois]).toEqual([[], [], []]);
    });

    it('badPath_aPoiWhosePhotosAreAllUnpublishedKeepsNone', () => {
        const manifest = manifestOf(
            assembleManifest(content({ pois: result([['enei', poiDoc({ photoIds: ['gone'] })]]) }), TEST_CONFIG.errorEndpoint),
        );

        expect(manifest.pois?.[0]?.photoIds).toBeUndefined();
    });
});

describe('assembleManifest: left out and reported', () => {
    it('badPath_aDocumentTheManifestRefusesIsSkippedWithItsFirstIssue', () => {
        const assembly = assembleManifest(
            content({
                photos: result([
                    ['p1', photoDoc('p1')],
                    ['unknown-rights', photoDoc('unknown-rights', { license: 'unknown' })],
                    ['far', photoDoc('far', { location: { lat: 47, lng: 26 } })],
                    ['both', photoDoc('both', { license: 'unknown', author: '' })],
                ]),
                layers: result([['photos', layerDoc()]]),
            }),
            TEST_CONFIG.errorEndpoint,
        );

        expect(manifestOf(assembly).photos.map((photo) => photo.id)).toEqual(['p1']);
        // A document its own fields refuse goes first; the rules across documents run once every field is valid.
        expect(assembly.skipped).toEqual([
            { entity: 'photo', id: 'both', code: 'validation.tooSmall', path: 'author' },
            { entity: 'photo', id: 'unknown-rights', code: 'validation.value', path: 'license' },
            { entity: 'layer', id: 'photos', code: 'validation.duplicateId', path: 'id' },
            { entity: 'photo', id: 'far', code: 'validation.outsideCity', path: 'location' },
        ]);
    });

    it('badPath_aCategoryLeftOutTakesItsPoisWithIt', () => {
        const assembly = assembleManifest(
            content({
                layers: result([['churches', layerDoc()]]),
                pois: result([
                    ['enei', poiDoc()],
                    ['lost', poiDoc({ category: 'nowhere' })],
                ]),
            }),
            TEST_CONFIG.errorEndpoint,
        );

        const manifest = manifestOf(assembly);
        expect([manifest.poiCategories, manifest.pois]).toEqual([[], []]);
        expect(assembly.skipped).toEqual([
            { entity: 'poiCategory', id: 'churches', code: 'validation.duplicateId', path: 'id' },
            { entity: 'poi', id: 'lost', code: 'validation.reference', path: 'category' },
            { entity: 'poi', id: 'enei', code: 'validation.reference', path: 'category' },
        ]);
    });

    it('badPath_documentsTheirSchemaRefusedAreReportedToo', () => {
        const invalid = (id: string): InvalidDocument => ({
            id,
            path: `x/${id}`,
            issues: [{ path: 'title.ro', code: 'validation.required' }],
        });
        const assembly = assembleManifest(
            content({
                layers: result([], [invalid('l1')]),
                photos: result([], [invalid('p9')]),
                poiCategories: result([], [{ id: 'c1', path: 'x/c1', issues: [] }]),
                pois: result([], [invalid('o1')]),
            }),
            TEST_CONFIG.errorEndpoint,
        );

        expect(assembly.skipped).toEqual([
            { entity: 'layer', id: 'l1', code: 'validation.required', path: 'title.ro' },
            { entity: 'photo', id: 'p9', code: 'validation.required', path: 'title.ro' },
            { entity: 'poiCategory', id: 'c1', code: 'validation.invalid', path: '' },
            { entity: 'poi', id: 'o1', code: 'validation.required', path: 'title.ro' },
        ]);
    });
});

describe('assembleManifest: the city itself', () => {
    it.each([
        ['no public token yet', { mapbox: {} }, 'city.mapbox.publicToken'],
        ['no About text', { about: undefined }, 'city.about'],
        ['no theme', { theme: undefined }, 'city.theme'],
        ['a zoom outside its own limits', { zoom: 5, minZoom: 10 }, 'city.zoom'],
    ] as const)('badPath_%s', (_name, city, path) => {
        const assembly = assembleManifest(content({ city }), TEST_CONFIG.errorEndpoint);

        expect(assembly.ok).toBe(false);
        expect(assembly.ok ? [] : assembly.issues.map((issue) => issue.path)).toEqual([path]);
    });
});

describe("assembleManifest: a photo's date and source", () => {
    it('happyPath_aPhotosDateAndSourceReachTheManifest', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({
                    photos: result([
                        [
                            'named',
                            photoDoc('named', {
                                year: 1936,
                                month: 7,
                                day: 12,
                                sourceUrl: 'https://arhiva.example/1',
                                sourceLabel: 'Arhiva',
                            }),
                        ],
                        ['plain', photoDoc('plain', { year: 1936, month: 7, sourceUrl: 'https://arhiva.example/2' })],
                    ]),
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );

        expect(manifest.photos.map(({ id, month, day, source }) => ({ id, month, day, source }))).toEqual([
            { id: 'named', month: 7, day: 12, source: { url: 'https://arhiva.example/1', label: 'Arhiva' } },
            { id: 'plain', month: 7, source: { url: 'https://arhiva.example/2' } },
        ]);
    });

    it('happyPath_aPhotosVersionsAndTheirCreditsReachTheManifest', () => {
        const sha256 = 'b'.repeat(64);
        const image = {
            web: 'https://storage.googleapis.com/p/v.webp',
            thumb: 'https://storage.googleapis.com/p/vt.webp',
            w: 4,
            h: 3,
            sha256,
        };
        const original = { path: 'originals/photos/x/v/b.jpg', contentType: 'image/jpeg', bytes: 9, sha256 } as const;
        const versioned = photoDoc('versioned', {
            versions: { improved: { image, original }, colorized: { image, original } },
            versionCredits: { colorized: 'Ana Pop' },
        });
        const manifest = manifestOf(
            assembleManifest(
                content({
                    photos: result([
                        ['versioned', versioned],
                        ['plain', photoDoc('plain')],
                    ]),
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );
        const shown = { web: image.web, thumb: image.thumb, w: image.w, h: image.h };

        expect(manifest.photos.map(({ id, versions }) => ({ id, versions }))).toEqual([
            { id: 'plain', versions: undefined },
            { id: 'versioned', versions: { improved: { ...shown, credit: undefined }, colorized: { ...shown, credit: 'Ana Pop' } } },
        ]);
    });

    it('badPath_aSourceNameWithoutAnAddressStaysInTheAdmin', () => {
        const manifest = manifestOf(
            assembleManifest(content({ photos: result([['p1', photoDoc('p1', { sourceLabel: 'Arhiva' })]]) }), TEST_CONFIG.errorEndpoint),
        );

        expect(manifest.photos[0]?.source).toBeUndefined();
    });
});

describe('assembleManifest: M13 (docs/research/M13-roles.md §§2, 5)', () => {
    const unplaced = () => photoDoc('lost', { location: undefined, bearing: undefined, credit: 'Maria' });

    it('happyPath_aPhotoWithNoPlaceJoinsTheUnplacedListAndNotTheMap @S-V40-HAPPY-MANIFEST', () => {
        const assembly = assembleManifest(
            content({
                photos: result([
                    ['p1', photoDoc('p1')],
                    ['lost', unplaced()],
                ]),
            }),
            TEST_CONFIG.errorEndpoint,
        );
        const manifest = manifestOf(assembly);
        expect(manifest.photos.map((photo) => photo.id)).toEqual(['p1']);
        expect(manifest.unplaced?.map((photo) => [photo.id, photo.credit])).toEqual([['lost', 'Maria']]);
        expect(assembly.ok && assembly.counts.unplaced).toBe(1);
    });

    it('badPath_aPlacedPhotoStillNeedsItsPlace @S-V40-BAD-PLACED-NEEDS-LOCATION', () => {
        const manifest = manifestOf(assembleManifest(content(), TEST_CONFIG.errorEndpoint));
        const withoutPlace = manifest.photos.map((photo) => omit(photo, ['location', 'bearing']));
        expect(validateManifest({ ...manifest, photos: withoutPlace }).ok).toBe(false);
    });

    it('happyPath_noUnplacedPhotosLeaveTheManifestAsItWas', () => {
        const manifest = manifestOf(assembleManifest(content(), TEST_CONFIG.errorEndpoint));
        const published: object = JSON.parse(JSON.stringify(manifest)) as object;
        expect(Object.keys(published)).not.toContain('unplaced');
        expect(Object.keys(published)).not.toContain('contributeUrl');
    });

    it('happyPath_theContributeLinkNamesTheCity', () => {
        const manifest = manifestOf(
            assembleManifest(content(), TEST_CONFIG.errorEndpoint, { adminUrl: 'https://demo-hcm.web.app/admin/' }),
        );
        expect(manifest.contributeUrl).toBe(`https://demo-hcm.web.app/admin/#/contribute/${CITY_ID}`);
    });

    it.each(['pending', 'refused'] as const)(
        'badPath_a_%s_itemNeverReachesThePublicWhateverItsPublishedSays @S-A90-BAD-NOT-PUBLIC-BEFORE',
        (reviewStatus) => {
            const manifest = manifestOf(
                assembleManifest(
                    content({
                        photos: result([
                            ['p1', photoDoc('p1')],
                            ['held', photoDoc('held', { reviewStatus })],
                            ['heldLost', photoDoc('heldLost', { reviewStatus, location: undefined, bearing: undefined })],
                        ]),
                        pois: result([['held', poiDoc({ reviewStatus })]]),
                    }),
                    TEST_CONFIG.errorEndpoint,
                ),
            );
            expect(manifest.photos.map((photo) => photo.id)).toEqual(['p1']);
            expect(manifest.unplaced).toBeUndefined();
            expect(manifest.pois).toEqual([]);
        },
    );

    it('happyPath_anApprovedItemIsPublic', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({ photos: result([['p1', photoDoc('p1', { reviewStatus: 'approved' })]]) }),
                TEST_CONFIG.errorEndpoint,
            ),
        );
        expect(manifest.photos.map((photo) => photo.id)).toEqual(['p1']);
    });

    it('badPath_aRefusedUnplacedPhotoIsReportedLikeAnyOther', () => {
        const assembly = assembleManifest(
            content({ photos: result([['lost', photoDoc('lost', { location: undefined, bearing: undefined, license: 'unknown' })]]) }),
            TEST_CONFIG.errorEndpoint,
        );
        expect(assembly.skipped.map((item) => [item.entity, item.id])).toEqual([['photo', 'lost']]);
    });
});

describe('assembleManifest: M27 disappeared streets (docs/research/M27-lost-streets.md)', () => {
    it('happyPath_aPinnedHiddenCategoryAndItsTracedStreetReachTheManifest @S-V71-HAPPY-PINNED', () => {
        const manifest = manifestOf(
            assembleManifest(
                content({
                    poiCategories: result([
                        ['churches', categoryDoc({ defaultVisible: false, pinned: true, attribution: 'OpenHistoricalMap (CC0)' })],
                    ]),
                    pois: result([['enei', poiDoc({ sourceLayer: 'flight-1940' })]]),
                }),
                TEST_CONFIG.errorEndpoint,
            ),
        );

        expect(validateManifest(manifest).ok).toBe(true);
        expect(manifest.poiCategories?.[0]).toMatchObject({ defaultVisible: false, pinned: true, attribution: 'OpenHistoricalMap (CC0)' });
        expect(manifest.pois?.[0]?.sourceLayer).toBe('flight-1940');
    });

    it('badPath_aStreetTracedOnALayerTheManifestDoesNotListKeepsTheStreetNotTheLayer @S-V71-BAD-UNKNOWN-LAYER', () => {
        const manifest = manifestOf(
            assembleManifest(content({ pois: result([['enei', poiDoc({ sourceLayer: 'retired-1911' })]]) }), TEST_CONFIG.errorEndpoint),
        );

        expect(validateManifest(manifest).ok).toBe(true);
        expect(manifest.pois?.map((poi) => [poi.id, poi.sourceLayer])).toEqual([['enei', undefined]]);
        expect(manifest.poiCategories?.[0]).not.toHaveProperty('pinned', true);
    });
});

describe('assembleManifest: the tab icon flag', () => {
    it.each([
        ['an uploaded icon says so @S-V54-HAPPY', 'custom', true],
        ['a default icon says nothing @S-V54-BAD-NOREQUEST', 'default', undefined],
    ] as const)('happyPath_ownIcon_%s', (_name, source, ownIcon) => {
        const icon = { source, url: 'https://example.test/icon-180.png', sha256: 'a'.repeat(64), updatedBy: 'u-1' };
        const manifest = manifestOf(assembleManifest(content({ city: { icon } as Partial<CityDoc> }), TEST_CONFIG.errorEndpoint));

        expect(validateManifest(manifest).ok).toBe(true);
        expect(manifest.city.ownIcon).toBe(ownIcon);
    });
});
