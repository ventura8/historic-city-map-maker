import { describe, expect, it } from 'vitest';

import type { ImportState } from '../../src/pois/importer.js';
import type { PoiItem } from '../../src/pois/model.js';
import { importOverlays, notFound, photoChoiceOf, placeOverlays, poisQuery, shownPlaces } from '../../src/pois/places.js';
import { AREA, POINT } from './world.js';

function item(id: string, title: { ro: string; en?: string }, published: boolean, category = 'biserici'): PoiItem {
    const value = { category, geometry: POINT, title, links: [], photoIds: [], published };
    return {
        id,
        version: 'v',
        category,
        title,
        yearStart: null,
        yearEnd: null,
        yearSeen: null,
        shape: 'point',
        published,
        geometry: POINT,
        value,
    };
}

const ITEMS = [item('a', { ro: 'Biserica Albă', en: 'White Church' }, true), item('b', { ro: 'Parcul' }, false, 'parcuri')];

describe('the places list: queries and filters', () => {
    it('happyPath_oneIndexedFilterAtATime', () => {
        expect(poisQuery({ category: 'parcuri', unpublished: true, search: '' })).toEqual({
            where: [['category', '==', 'parcuri']],
            orderBy: [['updatedAt', 'desc']],
        });
        expect(poisQuery({ category: null, unpublished: true, search: '' })).toEqual({
            where: [['published', '==', false]],
            orderBy: [['updatedAt', 'desc']],
        });
        expect(poisQuery({ category: null, unpublished: false, search: '' })).toEqual({ where: [], orderBy: [['updatedAt', 'desc']] });
    });

    it('happyPath_unpublishedAndTheSearchFilterTheLoadedPage', () => {
        expect(shownPlaces(ITEMS, { category: null, unpublished: true, search: '' }).map((place) => place.id)).toEqual(['b']);
        expect(shownPlaces(ITEMS, { category: null, unpublished: false, search: ' white ' }).map((place) => place.id)).toEqual(['a']);
        expect(shownPlaces(ITEMS, { category: null, unpublished: false, search: 'ALBĂ' }).map((place) => place.id)).toEqual(['a']);
    });

    it('badPath_aSearchThatMatchesNothingShowsNothing', () => {
        expect(shownPlaces(ITEMS, { category: null, unpublished: false, search: 'zzz' })).toEqual([]);
    });
});

describe('the places list: the map and the picker', () => {
    it('happyPath_eachCategoryDrawsItsPlacesInTheAdminsLanguage', () => {
        const categories = [
            { id: 'biserici', label: { ro: 'Biserici' }, icon: 'nu-exista', color: '#8b5e3c', defaultOpacity: 0.5, order: 1 },
        ];

        const [overlay] = placeOverlays(categories, ITEMS, 'en');

        expect(overlay).toMatchObject({ id: 'biserici', icon: 'location_on', opacity: 0.5 });
        expect(overlay?.features).toEqual([{ type: 'Feature', geometry: POINT, properties: { id: 'a', title: 'White Church' } }]);
    });

    it('happyPath_anImportsPreviewIsOneOverlayClicksPassThrough', () => {
        const value = { category: 'biserici', geometry: AREA, title: { ro: 'Nou' }, links: [], photoIds: [], published: true };
        const state: ImportState = {
            status: 'preview',
            fileName: 'a.geojson',
            refusal: null,
            fallbackCategory: null,
            written: 0,
            plan: {
                created: [
                    { number: 1, id: null, value },
                    { number: 2, id: null, value: { ...value, geometry: null } },
                ],
                updated: [],
                unchanged: 0,
                refused: [],
                uncategorised: 0,
            },
        };

        const [overlay] = importOverlays(state);

        expect(overlay).toMatchObject({ id: 'hcm-import', clickable: false });
        expect(overlay?.features).toEqual([{ type: 'Feature', geometry: AREA, properties: { id: 'hcm-import-1', title: 'Nou' } }]);
        expect(importOverlays(null)).toEqual([]);
        expect(importOverlays({ ...state, status: 'writing' })).toEqual([]);
    });

    it('badPath_aPhotoWithoutAnHttpsThumbnailHasNone', () => {
        const stamp = { updatedBy: 'u', updatedAt: { seconds: 0, nanoseconds: 0 } };
        const base = {
            title: { ro: 'Lipscani', en: 'Lipscani Street' },
            license: 'PD',
            location: { lat: 44.43, lng: 26.1 },
            published: true,
            processing: 'done',
            ...stamp,
        } as const;

        expect(photoChoiceOf({ id: 'p', path: 'x', version: 'v', pending: false, data: base })).toEqual({
            id: 'p',
            title: { ro: 'Lipscani', en: 'Lipscani Street' },
            year: null,
            thumb: null,
        });
        expect(
            photoChoiceOf({
                id: 'p',
                path: 'x',
                version: 'v',
                pending: false,
                data: { ...base, image: { web: 'w.webp', thumb: 't.webp', sha256: 'a'.repeat(64), w: 1, h: 1 } },
            }).thumb,
        ).toBeNull();
        expect(notFound('x')).toMatchObject({ id: 'x', status: 'not-found', draft: null });
    });
});
