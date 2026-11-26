/**
 * What the detail sheet shows (`src/viewer/viewer-selection.ts`, S-V90-*): a photo, one of the city's places with its
 * category, or a Wikipedia article as a place of the overlay's category in the visitor's language with its thumbnail.
 */
import type { WikipediaArticle } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { selectionOf } from '../../src/viewer/viewer-selection.js';
import { testManifest } from './fixtures.js';

const MANIFEST = testManifest();
const ARTICLE: WikipediaArticle = {
    id: 'ro-1',
    lng: 26.0973,
    lat: 44.4413,
    versions: {
        ro: { title: 'Ateneul Român', extract: '', url: 'https://ro.wikipedia.org/wiki/A' },
        en: { title: 'Romanian Athenaeum', extract: '', url: 'https://en.wikipedia.org/wiki/A' },
    },
    thumb: 'wikipedia/ro-1.jpg',
};
const BASE = { sheet: 'poi', selectedPhotoId: null, locale: 'en', wikipedia: { articles: [ARTICLE] } } as const;

describe('selectionOf', () => {
    it('happyPath_anArticleIsAPlaceWithItsThumbnail', () => {
        const selection = selectionOf({ ...BASE, selectedPoiId: 'wikipedia-ro-1' }, MANIFEST);

        expect(selection.poi?.title.en).toBe('Romanian Athenaeum');
        expect(selection.thumbnail).toBe('wikipedia/ro-1.jpg');
        expect(selection.photo).toBeNull();
        expect(selection.category).toBeNull();
        const bare = selectionOf(
            { ...BASE, selectedPoiId: 'wikipedia-ro-1', wikipedia: { articles: [{ ...ARTICLE, thumb: undefined }] } },
            MANIFEST,
        );
        expect(bare.thumbnail).toBeNull();
    });

    it('happyPath_theCitysOwnPlaceKeepsItsCategory', () => {
        const own = MANIFEST.pois?.[0];
        const selection = selectionOf({ ...BASE, selectedPoiId: own?.id ?? null }, MANIFEST);

        expect(selection.poi).toBe(own);
        expect(selection.category?.id).toBe(own?.category);
        expect(selection.thumbnail).toBeNull();
    });

    it('badPath_anUnknownIdAnotherSheetOrNoArticlesSelectNoPlace', () => {
        expect(selectionOf({ ...BASE, selectedPoiId: 'wikipedia-ro-9' }, MANIFEST).poi).toBeNull();
        expect(selectionOf({ ...BASE, sheet: 'photo', selectedPoiId: 'wikipedia-ro-1' }, MANIFEST).poi).toBeNull();
        expect(
            selectionOf({ sheet: 'poi', selectedPoiId: 'wikipedia-ro-1', selectedPhotoId: null, locale: 'ro' }, MANIFEST).poi,
        ).toBeNull();
    });
});
