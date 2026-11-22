/**
 * The Wikipedia overlay's fetch (`functions/src/wikipedia/fetch.ts`): the cells of the bounds, one article per place read on
 * both Wikipedias, articles of their own for pages only the other language has, the nearest first, the extract cut short.
 */
import { MAX_WIKIPEDIA_ARTICLES, WIKIPEDIA_EXTRACT_CHARS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    CELL_LAT_DEG,
    CELL_LNG_DEG,
    GEOSEARCH_LIMIT,
    MAX_CELLS,
    MAX_SPLIT_DEPTH,
    cellsOf,
    fetchArticles,
    quartersOf,
    shortExtract,
} from '../../src/wikipedia/fetch.js';
import { createFakeWikipedia, wikiPage } from '../support/wikipedia-fake.js';

const BOUNDS = { west: 26.0, south: 44.4, east: 26.2, north: 44.5 };
const BOX = { west: 26.0, south: 44.4, east: 26.1, north: 44.48 };

describe('cellsOf', () => {
    it('happyPath_theBoundsAreCutIntoCellsWithinGeosearchsBox', () => {
        const cells = cellsOf(BOUNDS);

        expect(cells).toHaveLength(4);
        for (const cell of cells) {
            expect(cell.east - cell.west).toBeLessThanOrEqual(CELL_LNG_DEG + 1e-9);
            expect(cell.north - cell.south).toBeLessThanOrEqual(CELL_LAT_DEG + 1e-9);
        }
    });

    it('badPath_aHugeAreaKeepsTheCellsNearestItsCentre', () => {
        const cells = cellsOf({ west: 20, south: 40, east: 30, north: 48 });

        expect(cells).toHaveLength(MAX_CELLS);
        const [first] = cells;
        expect(first !== undefined && first.west < 25 && first.east > 24.9).toBe(true);
    });
});

describe('shortExtract', () => {
    it('happyPath_aShortTextStaysAndALongOneIsCutAtAWord', () => {
        expect(shortExtract('  O   sală\\nde concerte. ')).toBe('O sală\\nde concerte.');
        const long = shortExtract('cuvânt '.repeat(80));
        expect(long.length).toBeLessThanOrEqual(WIKIPEDIA_EXTRACT_CHARS);
        expect(long.endsWith('t…')).toBe(true);
        expect(shortExtract('x'.repeat(WIKIPEDIA_EXTRACT_CHARS + 5))).toHaveLength(WIKIPEDIA_EXTRACT_CHARS);
    });
});

describe('fetchArticles', () => {
    it('happyPath_bothLanguagesJoinIntoOneArticleAndTheOtherOnesStayTheirOwn', async () => {
        const wiki = createFakeWikipedia([
            wikiPage('ro', 1, 'Ateneul Român', 26.0973, 44.4413, {
                extract: 'Sală de concerte.',
                titles: { en: 'Romanian Athenaeum' },
            }),
            wikiPage('ro', 2, 'Palatul CEC', 26.0966, 44.4313),
            wikiPage('en', 50, 'Romanian Athenaeum', 26.0973, 44.4413, {
                extract: 'A concert hall.',
                thumbnail: 'https://upload.wikimedia.org/a.jpg',
            }),
            wikiPage('en', 51, 'Only English', 26.1, 44.45, { thumbnail: 'https://upload.wikimedia.org/b.jpg' }),
            wikiPage('ro', 3, 'Outside', 27, 45),
        ]);

        const articles = await fetchArticles(wiki, BOUNDS, ['ro', 'en']);

        expect(articles.map(({ article }) => article.id).sort((a, b) => a.localeCompare(b))).toEqual(['en-51', 'ro-1', 'ro-2']);
        const athenaeum = articles.find(({ article }) => article.id === 'ro-1');
        expect(athenaeum?.article.versions.ro?.title).toBe('Ateneul Român');
        expect(athenaeum?.article.versions.en).toEqual({
            title: 'Romanian Athenaeum',
            extract: 'A concert hall.',
            url: 'https://en.wikipedia.org/wiki/Romanian_Athenaeum',
        });
        expect(athenaeum?.thumbnail).toBe('https://upload.wikimedia.org/a.jpg');
        expect(articles.find(({ article }) => article.id === 'en-51')?.thumbnail).toBe('https://upload.wikimedia.org/b.jpg');
        expect(articles.find(({ article }) => article.id === 'ro-2')?.thumbnail).toBeUndefined();
    });

    it('happyPath_theFirstLanguagesThumbnailWinsAndTheNearestComeFirst', async () => {
        const wiki = createFakeWikipedia([
            wikiPage('en', 1, 'Far', 26.01, 44.41, { thumbnail: 'https://upload.wikimedia.org/far.jpg', titles: { ro: 'Departe' } }),
            wikiPage('en', 2, 'Near', 26.1, 44.45),
            wikiPage('ro', 9, 'Departe', 26.01, 44.41, { thumbnail: 'https://upload.wikimedia.org/other.jpg' }),
        ]);

        const articles = await fetchArticles(wiki, BOUNDS, ['en', 'ro']);

        expect(articles.map(({ article }) => article.id)).toEqual(['en-2', 'en-1']);
        expect(articles[1]?.thumbnail).toBe('https://upload.wikimedia.org/far.jpg');
        expect(articles[1]?.article.versions.ro?.title).toBe('Departe');
    });

    it('happyPath_aPageThatLostItsDetailsIsSkipped', async () => {
        const wiki = createFakeWikipedia([wikiPage('ro', 1, 'A', 26.1, 44.45)]);
        const missing = { ...wiki, pages: () => Promise.resolve([]) };

        await expect(fetchArticles(missing, BOUNDS, ['ro', 'en'])).resolves.toEqual([]);
        await expect(fetchArticles(wiki, BOUNDS, [])).resolves.toEqual([]);
    });

    it('badPath_atMostTheCapIsKept', async () => {
        const pages = Array.from({ length: MAX_WIKIPEDIA_ARTICLES + 30 }, (_, index) =>
            wikiPage('ro', index + 1, `P${String(index)}`, 26.0 + (index % 100) / 600, 44.4 + Math.floor(index / 100) / 700),
        );

        const articles = await fetchArticles(createFakeWikipedia(pages), BOUNDS, ['ro']);

        expect(articles).toHaveLength(MAX_WIKIPEDIA_ARTICLES);
    });

    it('happyPath_aBoxThatFillsGeosearchsAnswerIsAskedAgainInQuartersSoNoArticleIsCutOff', async () => {
        const pages = Array.from({ length: 1200 }, (_, index) =>
            wikiPage('ro', index + 1, `P${String(index)}`, 26.0013 + (index % 40) * 0.0024, 44.4011 + Math.floor(index / 40) * 0.0025),
        );
        const wiki = createFakeWikipedia(pages, new Map(), GEOSEARCH_LIMIT);

        const articles = await fetchArticles(wiki, BOX, ['ro']);

        expect(articles).toHaveLength(1200);
        expect(wiki.calls.places).toBeGreaterThan(cellsOf(BOX).length);
    });

    it('badPath_splittingStopsAtTheDepthCap', async () => {
        const pages = Array.from({ length: GEOSEARCH_LIMIT + 1 }, (_, index) =>
            wikiPage('ro', index + 1, `P${String(index)}`, 26.001, 44.401),
        );
        const wiki = createFakeWikipedia(pages, new Map(), GEOSEARCH_LIMIT);

        const articles = await fetchArticles(wiki, BOX, ['ro']);

        expect(articles).toHaveLength(GEOSEARCH_LIMIT);
        expect(wiki.calls.places).toBe(cellsOf(BOX).length + 4 * MAX_SPLIT_DEPTH);
        expect(quartersOf({ west: 0, south: 0, east: 2, north: 2 })).toContainEqual({ west: 1, south: 0, east: 2, north: 1 });
    });

    it('badPath_aFailureOfWikipediaIsThrown', async () => {
        const wiki = createFakeWikipedia([]);
        wiki.failWith('unavailable');

        await expect(fetchArticles(wiki, BOUNDS, ['ro'])).rejects.toMatchObject({ failure: 'unavailable' });
    });
});
