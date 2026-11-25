import { describe, expect, it } from 'vitest';
import type { Manifest, Photo, Poi, Story } from '@hcm/shared';

import {
    geometryCenter,
    normalizeSearchText,
    pickSearchResult,
    searchDock,
    searchManifest,
    selectSearchResult,
    type SearchResult,
} from '../../src/viewer/viewer-search.js';
import { EMPTY } from '../../src/viewer/empty.js';
import { FakeStore, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

function firstPhoto(manifest: Manifest): Photo {
    const photo = manifest.photos[0];
    if (photo === undefined) {
        throw new Error('Expected test manifest to contain at least one photo');
    }
    return photo;
}

function manifestWithSearchData(): Manifest {
    const base = testManifest();
    const basePhoto = firstPhoto(base);
    const street: Poi = {
        id: 'str-coltei',
        category: 'lost-streets',
        geometry: {
            type: 'LineString',
            coordinates: [
                [26.1, 44.43],
                [26.12, 44.45],
            ],
        },
        title: { ro: 'Strada Colței', en: 'Coltei Street' },
        links: [],
    };
    const square: Poi = {
        id: 'piata-unirii',
        category: 'landmarks',
        geometry: {
            type: 'Polygon',
            coordinates: [
                [
                    [26.1, 44.42],
                    [26.12, 44.42],
                    [26.12, 44.44],
                    [26.1, 44.42],
                ],
            ],
        },
        title: { ro: 'Piața Unirii' },
        links: [],
    };
    const orphanPoi: Poi = {
        id: 'orphan-place',
        category: 'missing-cat',
        geometry: { type: 'Point', coordinates: [26.09, 44.43] },
        title: { ro: 'Hanul fără categorie' },
        links: [],
    };
    const storyWithPoi: Story = {
        id: 'story-coltei',
        title: { ro: 'Povestea Turnului Colței', en: 'Story of Coltei Tower' },
        body: { ro: 'Text scurt.' },
        poiIds: ['str-coltei'],
    };
    const storyWithPhoto: Story = {
        id: 'story-photo',
        title: { ro: 'Fotografii din centru', en: 'Downtown photographs' },
        body: { ro: 'Text scurt.' },
        photoIds: [basePhoto.id],
    };
    const storyUnplaced: Story = {
        id: 'story-none',
        title: { ro: 'Poveste generală', en: 'General story' },
        body: { ro: 'Text scurt.' },
    };
    return {
        ...base,
        poiCategories: [
            ...(base.poiCategories ?? []),
            {
                id: 'lost-streets',
                label: { ro: 'Străzi dispărute', en: 'Disappeared streets' },
                icon: 'route',
                color: '#8d6e63',
                defaultOpacity: 1,
                defaultVisible: false,
                pinned: true,
            },
            {
                id: 'landmarks',
                label: { ro: 'Repere', en: 'Landmarks' },
                icon: 'account_balance',
                color: '#1976d2',
                defaultOpacity: 1,
            },
        ],
        pois: [...(base.pois ?? []), street, square, orphanPoi],
        stories: [storyWithPoi, storyWithPhoto, storyUnplaced],
    };
}

describe('viewer-search', () => {
    it('happyPath_normalizesDiacriticsAndCase', () => {
        expect(normalizeSearchText('  Piața Ștefan cel Mare — Împărat  ')).toBe('piata stefan cel mare — imparat');
        expect(normalizeSearchText('Strada Colţei')).toBe('strada coltei');
    });

    it('happyPath_computesGeometryCenterForPointLineAndPolygon', () => {
        expect(geometryCenter({ type: 'Point', coordinates: [26.1, 44.43] })).toEqual([26.1, 44.43]);
        expect(
            geometryCenter({
                type: 'LineString',
                coordinates: [
                    [26.1, 44.42],
                    [26.2, 44.44],
                ],
            }),
        ).toEqual([expect.closeTo(26.15, 9), expect.closeTo(44.43, 9)]);
        expect(
            geometryCenter({
                type: 'Polygon',
                coordinates: [
                    [
                        [26.0, 44.4],
                        [26.2, 44.4],
                        [26.2, 44.6],
                        [26.0, 44.4],
                    ],
                ],
            }),
        ).toEqual([26.1, 44.5]);
    });

    it('happyPath_findsPoisStreetsPhotosAndStoriesAcrossRoAndEn', () => {
        const manifest = manifestWithSearchData();
        const coltei = searchManifest(manifest, 'coltei', 'ro');
        // The street's English title starts with the word (a prefix match), the story's only contains it.
        expect(coltei.map((r) => r.id)).toEqual(['str-coltei', 'story-coltei']);
        expect(coltei[0]?.subtitle).toBe('Străzi dispărute');
        expect(coltei[0]?.center).toEqual(coltei[1]?.center);

        const samplePhoto = firstPhoto(manifest);
        const enSearch = searchManifest(manifest, 'downtown', 'en');
        expect(enSearch.map((r) => r.id)).toEqual(['story-photo']);
        expect(enSearch[0]?.center).toEqual([samplePhoto.location.lng, samplePhoto.location.lat]);

        const photoTitle = samplePhoto.title.ro;
        const photoHits = searchManifest(manifest, photoTitle.slice(0, 5), 'ro');
        expect(photoHits.some((r) => r.kind === 'photo' && r.id === samplePhoto.id)).toBe(true);

        const orphan = searchManifest(manifest, 'hanul', 'ro');
        expect(orphan[0]?.subtitle).toBe('Loc');

        const unplaced = searchManifest(manifest, 'generala', 'ro');
        expect(unplaced[0]?.center).toBeNull();
    });

    it('badPath_emptyOrUnmatchedQueryReturnsEmptyList', () => {
        const manifest = manifestWithSearchData();
        expect(searchManifest(manifest, '   ', 'ro')).toEqual([]);
        expect(searchManifest(manifest, 'zzzz-no-match', 'en')).toEqual([]);
        expect(searchManifest(manifest, 'a', 'ro', 1)).toHaveLength(1);
    });

    it('happyPath_selectSearchResultFliesAndOpensEachKind', () => {
        const manifest = manifestWithSearchData();
        const samplePhoto = firstPhoto(manifest);
        const store = new FakeStore(readyState(manifest));

        const photo: SearchResult = {
            id: samplePhoto.id,
            kind: 'photo',
            title: 'Photo',
            subtitle: 'Fotografie',
            center: [26.1, 44.43],
            icon: 'photo_camera',
        };
        selectSearchResult(store, photo);
        expect(store.callsOf('flyTo')).toHaveLength(1);
        expect(store.callsOf('openPhoto')).toEqual([[samplePhoto.id]]);

        const poi: SearchResult = {
            id: 'str-coltei',
            kind: 'poi',
            title: 'Strada Colței',
            subtitle: 'Străzi dispărute',
            center: [26.11, 44.44],
            icon: 'route',
            categoryId: 'lost-streets',
        };
        selectSearchResult(store, poi);
        expect(store.callsOf('toggleOverlay')).toEqual([['lost-streets', true]]);
        expect(store.callsOf('openPoi')).toEqual([['str-coltei']]);

        const story: SearchResult = {
            id: 'story-none',
            kind: 'story',
            title: 'Poveste generală',
            subtitle: 'Poveste',
            center: null,
            icon: 'museum',
        };
        selectSearchResult(store, story);
        expect(store.callsOf('flyTo')).toHaveLength(2);
        expect(store.callsOf('openStory')).toEqual([['story-none']]);
    });
});

describe('viewer-search without its data or its map', () => {
    it('badPath_missingLinksListsAndCategoryLeaveAResultWithNoPlaceAndNoOverlay', () => {
        const manifest = manifestWithSearchData();
        const lost: Story = {
            id: 'story-lost',
            title: { ro: 'Poveste pierdută' },
            body: { ro: 'Text.' },
            poiIds: ['gone'],
            photoIds: ['gone'],
        };
        const bare: Manifest = { ...manifest, poiCategories: undefined, pois: undefined, stories: [lost] };
        expect(searchManifest(bare, 'poveste', 'ro').map((r) => [r.id, r.center])).toEqual([['story-lost', null]]);
        expect(searchManifest({ ...bare, stories: undefined }, 'poveste', 'ro')).toEqual([]);

        const store = new FakeStore(readyState(manifest));
        const result: SearchResult = {
            id: 'piata-unirii',
            kind: 'poi',
            title: 'Piața Unirii',
            subtitle: 'Loc',
            center: null,
            icon: 'place',
        };
        pickSearchResult(store, new CustomEvent('hcm-search-select', { detail: { result } }));
        expect(store.callsOf('flyTo')).toEqual([]);
        expect(store.callsOf('toggleOverlay')).toEqual([]);
        expect(store.callsOf('openPoi')).toEqual([['piata-unirii']]);
    });

    it('badPath_noSearchBarWithoutAMap', () => {
        const manifest = manifestWithSearchData();
        const handlers = { onSearchSelect: () => undefined };
        expect(searchDock(false, manifest, 'ro', handlers)).toBe(EMPTY);
        expect(searchDock(true, manifest, 'ro', handlers)).not.toBe(EMPTY);
    });
});
