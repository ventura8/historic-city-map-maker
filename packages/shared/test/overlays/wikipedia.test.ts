/**
 * The Wikipedia overlay's shared parts (`schemas/wikipedia.ts`, `overlays/wikipedia.ts`, S-V90-*): the file the viewer loads,
 * and its articles as places of the overlay's category in the visitor's language, their extract kept plain text.
 */
import { describe, expect, it } from 'vitest';

import {
    WIKIPEDIA_CATEGORY_ID,
    literalMarkdown,
    manifestSchema,
    parseMarkdown,
    shownWikipediaLanguage,
    wikipediaArticleOf,
    wikipediaFileSchema,
    wikipediaPoi,
    wikipediaPoiId,
    wikipediaPois,
    type WikipediaArticle,
} from '../../src/index.js';

const BOTH: WikipediaArticle = {
    id: 'ro-1',
    lng: 26.0973,
    lat: 44.4413,
    versions: {
        ro: { title: 'Ateneul Român', extract: 'Sală de *concerte* [1].', url: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n' },
        en: { title: 'Romanian Athenaeum', extract: 'A concert hall.', url: 'https://en.wikipedia.org/wiki/Romanian_Athenaeum' },
    },
    thumb: 'wikipedia/ro-1.jpg',
};

const ENGLISH_ONLY: WikipediaArticle = {
    id: 'en-5',
    lng: 26.1,
    lat: 44.45,
    versions: { en: { title: 'Only English', extract: '', url: 'https://en.wikipedia.org/wiki/Only' } },
};

describe('wikipediaFileSchema', () => {
    it('happyPath_aFileWithArticlesIsValid', () => {
        const file = {
            version: 1,
            generatedAt: '2026-11-22T08:00:00.000Z',
            attribution: 'Wikipedia (CC BY-SA 4.0)',
            articles: [BOTH, ENGLISH_ONLY],
        };
        expect(wikipediaFileSchema.safeParse(file).success).toBe(true);
    });

    it('badPath_anArticleWithNoVersionAnOutsideLinkOrAnOutsideThumbIsRefused', () => {
        const file = (article: unknown) => ({ version: 1, generatedAt: '2026-11-22T08:00:00.000Z', attribution: 'W', articles: [article] });
        expect(wikipediaFileSchema.safeParse(file({ ...BOTH, versions: {} })).success).toBe(false);
        expect(
            wikipediaFileSchema.safeParse(
                file({ ...ENGLISH_ONLY, versions: { en: { ...ENGLISH_ONLY.versions.en, url: 'https://evil.example/wiki/x' } } }),
            ).success,
        ).toBe(false);
        expect(wikipediaFileSchema.safeParse(file({ ...BOTH, thumb: 'https://upload.wikimedia.org/a.jpg' })).success).toBe(false);
    });

    it('happyPath_theManifestTakesTheReference', () => {
        const ref = { file: 'wikipedia.json', count: 2, generatedAt: '2026-11-22T08:00:00.000Z' };
        expect(manifestSchema.shape.wikipedia.safeParse(ref).success).toBe(true);
        expect(manifestSchema.shape.wikipedia.safeParse({ ...ref, count: 0 }).success).toBe(false);
    });
});

describe('wikipediaPoi', () => {
    it('happyPath_theVisitorsLanguageFirstAsAPlaceOfTheOverlay @S-V90-HAPPY-LANGUAGE', () => {
        expect(shownWikipediaLanguage(BOTH, 'en')).toBe('en');
        expect(shownWikipediaLanguage(BOTH, 'fr')).toBe('ro');
        const poi = wikipediaPoi(BOTH, 'en');
        expect(poi).toMatchObject({
            id: 'wikipedia-ro-1',
            category: WIKIPEDIA_CATEGORY_ID,
            geometry: { type: 'Point', coordinates: [26.0973, 44.4413] },
            title: { ro: 'Romanian Athenaeum', en: 'Romanian Athenaeum' },
            links: [{ url: 'https://en.wikipedia.org/wiki/Romanian_Athenaeum', label: 'Read on Wikipedia' }],
        });
        expect(poi.yearStart).toBeUndefined();
    });

    it('badPath_theOtherLanguageWhenTheVisitorsIsMissingAndNoExtractNoDescription', () => {
        const poi = wikipediaPoi(ENGLISH_ONLY, 'ro');
        expect(poi.title.ro).toBe('Only English');
        expect(poi.description).toBeUndefined();
        expect(poi.links[0]?.label).toBe('Citește pe Wikipedia');
        expect(wikipediaPoi({ ...ENGLISH_ONLY, versions: {} }, 'ro').title.ro).toBe('en-5');
    });

    it('happyPath_theExtractStaysPlainTextInTheMarkdownSubset', () => {
        const text = wikipediaPoi(BOTH, 'ro').description?.ro ?? '';
        expect(text).toBe(literalMarkdown('Sală de *concerte* [1].'));
        const parsed = parseMarkdown(text);
        expect(parsed.paragraphs[0]?.children).toEqual([{ type: 'text', text: 'Sală de *concerte* [1].' }]);
        expect(literalMarkdown('a\\b_(c)')).toBe('a\\\\b\\_\\(c\\)');
    });

    it('happyPath_allArticlesAndTheArticleBehindAnId', () => {
        expect(wikipediaPois([BOTH, ENGLISH_ONLY], 'ro').map((poi) => poi.id)).toEqual([wikipediaPoiId('ro-1'), 'wikipedia-en-5']);
        expect(wikipediaArticleOf([BOTH], 'wikipedia-ro-1')).toBe(BOTH);
        expect(wikipediaArticleOf([BOTH], 'church-1')).toBeUndefined();
        expect(wikipediaArticleOf([BOTH], null)).toBeUndefined();
    });
});
