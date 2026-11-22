/**
 * The Wikipedia overlay at a manifest build (`functions/src/wikipedia/refresh.ts`, S-A230-*): a fetch when one is due, the
 * free thumbnails copied, the file without the hidden articles, the manifest's category and reference, and a failure of
 * Wikipedia that keeps the articles of before and never fails the build.
 */
import { gunzipSync } from 'node:zlib';

import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    WIKIPEDIA_ATTRIBUTION,
    WIKIPEDIA_CATEGORY_ID,
    timestampFromDate,
    validateManifest,
    wikipediaFileSchema,
    wikipediaStateDocSchema,
    type Manifest,
    type WikipediaArticle,
    type WikipediaStateDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../src/publish/build-manifest.js';
import {
    MAX_THUMBS,
    WIKIPEDIA_CATEGORY,
    fetchDue,
    publishFile,
    refreshState,
    shownArticles,
    wikipediaForBuild,
    withWikipedia,
} from '../../src/wikipedia/refresh.js';
import { CITY_ID, cityDoc, seedCity } from '../publish/city.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import { FAKE_IMAGE, createFakeWikipedia, wikiPage, type FakeWikipedia } from '../support/wikipedia-fake.js';

const NOW = '2026-11-22T08:00:00.000Z';
const WEEK_AGO = timestampFromDate(new Date('2026-11-15T07:00:00.000Z'));
const YESTERDAY = timestampFromDate(new Date('2026-11-21T08:00:00.000Z'));
const STATE_PATH = FIRESTORE_PATHS.wikipedia(CITY_ID);
const FILE = STORAGE_PATHS.wikipediaFile(CITY_ID);

const ARTICLE: WikipediaArticle = {
    id: 'ro-1',
    lng: 26.0973,
    lat: 44.4413,
    versions: { ro: { title: 'Ateneul Român', extract: 'Sală.', url: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n' } },
};

function state(overrides: Partial<WikipediaStateDoc> = {}): WikipediaStateDoc {
    return { enabled: true, languages: ['ro'], hidden: [], updatedBy: 'u-admin', updatedAt: YESTERDAY, ...overrides };
}

function withWiki(deps: ContentDeps, wiki: FakeWikipedia): ContentDeps {
    return { ...deps, wiki };
}

const ATHENAEUM = wikiPage('ro', 1, 'Ateneul Român', 26.0973, 44.4413, {
    extract: 'Sală.',
    thumbnail: 'https://upload.wikimedia.org/a.jpg',
});

function fileOf(deps: ContentDeps): unknown {
    return JSON.parse(gunzipSync(deps.blobs.object('public', FILE)?.bytes ?? new Uint8Array()).toString('utf8'));
}

describe('fetchDue', () => {
    it('happyPath_onAndOlderThanAWeekOrAskedForOrNeverFetched', () => {
        const now = new Date(NOW);
        expect(fetchDue(state({ refreshedAt: WEEK_AGO }), now)).toBe(true);
        expect(fetchDue(state({ refreshedAt: YESTERDAY, refreshRequested: true }), now)).toBe(true);
        expect(fetchDue(state(), now)).toBe(true);
    });

    it('badPath_offOrFreshOrAbsentIsNotDue', () => {
        const now = new Date(NOW);
        expect(fetchDue(state({ refreshedAt: YESTERDAY }), now)).toBe(false);
        expect(fetchDue(state({ enabled: false }), now)).toBe(false);
        expect(fetchDue(undefined, now)).toBe(false);
    });
});

describe('refreshState', () => {
    it('happyPath_theArticlesAndTheirFreeThumbnailsAreRecorded @S-A230-HAPPY-FETCH', async () => {
        const wiki = createFakeWikipedia([ATHENAEUM], new Map([['https://upload.wikimedia.org/a.jpg', FAKE_IMAGE]]));
        const deps = withWiki(contentDeps(NOW), wiki);

        const next = await refreshState(deps, CITY_ID, cityDoc(), state({ refreshRequested: true, failure: 'unavailable' }));

        expect(next.articles).toEqual([{ ...ARTICLE, thumb: 'wikipedia/ro-1.jpg' }]);
        expect(next.refreshRequested).toBeUndefined();
        expect(next.failure).toBeUndefined();
        expect(next.updatedBy).toBe('system:publish');
        expect(deps.blobs.object('public', STORAGE_PATHS.wikipediaThumb(CITY_ID, 'wikipedia/ro-1.jpg'))?.options.contentType).toBe(
            'image/jpeg',
        );
        await expect(deps.documents.get(STATE_PATH, wikipediaStateDocSchema)).resolves.toMatchObject({ articles: next.articles });
    });

    it('badPath_aThumbnailThatFailsOrIsRefusedLeavesTheArticleWithoutOne', async () => {
        const wiki = createFakeWikipedia(
            [ATHENAEUM, wikiPage('ro', 2, 'Palatul CEC', 26.0966, 44.4313, { thumbnail: 'https://upload.wikimedia.org/b.jpg' })],
            new Map([['https://upload.wikimedia.org/a.jpg', new Error('image down')]]),
        );
        const deps = withWiki(contentDeps(NOW), wiki);

        const next = await refreshState(deps, CITY_ID, cityDoc(), state());

        expect(next.articles?.every((article) => article.thumb === undefined)).toBe(true);
        expect(deps.recording.records.some((record) => record.message === 'wikipedia thumbnail skipped')).toBe(true);
    });

    it('badPath_anArticleTheSchemaRefusesIsDroppedNotTheFetch', async () => {
        const wiki = createFakeWikipedia([ATHENAEUM, wikiPage('ro', 2, 'x'.repeat(250), 26.1, 44.45)]);

        const next = await refreshState(withWiki(contentDeps(NOW), wiki), CITY_ID, cityDoc(), state());

        expect(next.articles?.map((article) => article.id)).toEqual(['ro-1']);
    });

    it('badPath_aFailedFetchKeepsTheArticlesOfBeforeAndSaysWhy @S-A230-BAD-WIKIPEDIA-DOWN', async () => {
        for (const [failure, recorded] of [
            ['rateLimited', 'rateLimited'],
            ['unavailable', 'unavailable'],
            ['invalid', 'invalid'],
        ] as const) {
            const wiki = createFakeWikipedia([]);
            wiki.failWith(failure);
            const next = await refreshState(
                withWiki(contentDeps(NOW), wiki),
                CITY_ID,
                cityDoc(),
                state({ articles: [ARTICLE], refreshedAt: WEEK_AGO }),
            );
            expect(next).toMatchObject({ failure: recorded, articles: [ARTICLE], refreshedAt: WEEK_AGO });
        }
        const wiki = createFakeWikipedia([]);
        wiki.failWith(new Error('bug'));
        await expect(refreshState(withWiki(contentDeps(NOW), wiki), CITY_ID, cityDoc(), state())).resolves.toMatchObject({
            failure: 'invalid',
        });
    });

    it('happyPath_onlyTheFirstThumbnailsAreCopied', async () => {
        const pages = Array.from({ length: MAX_THUMBS + 2 }, (_, index) =>
            wikiPage('ro', index + 1, `P${String(index)}`, 26.0 + index / 2000, 44.45, {
                thumbnail: `https://upload.wikimedia.org/${String(index)}.jpg`,
            }),
        );
        const images = new Map(pages.map((page) => [page.thumbnail ?? '', FAKE_IMAGE]));
        const wiki = createFakeWikipedia(pages, images);

        const next = await refreshState(withWiki(contentDeps(NOW), wiki), CITY_ID, cityDoc(), state());

        expect(next.articles?.filter((article) => article.thumb !== undefined)).toHaveLength(MAX_THUMBS);
        expect(wiki.calls.image).toBe(MAX_THUMBS);
    });
});

describe('publishFile', () => {
    it('happyPath_theFileHoldsTheShownArticles', async () => {
        const deps = contentDeps(NOW);
        const hiddenOne = { ...ARTICLE, id: 'ro-2' };

        await expect(publishFile(deps, CITY_ID, state({ articles: [ARTICLE, hiddenOne], hidden: ['ro-2'] }))).resolves.toEqual({
            file: 'wikipedia.json',
            count: 1,
            generatedAt: NOW,
        });
        const file = wikipediaFileSchema.parse(fileOf(deps));
        expect(file).toEqual({ version: 1, generatedAt: NOW, attribution: WIKIPEDIA_ATTRIBUTION, articles: [ARTICLE] });
        expect(deps.blobs.object('public', FILE)?.options).toMatchObject({ contentEncoding: 'gzip', contentType: 'application/json' });
    });

    it('badPath_offOrEmptyRemovesTheFile', async () => {
        const deps = contentDeps(NOW);
        deps.blobs.put('public', FILE, new Uint8Array([1]));

        await expect(publishFile(deps, CITY_ID, state({ enabled: false, articles: [ARTICLE] }))).resolves.toBeUndefined();
        expect(deps.blobs.object('public', FILE)).toBeUndefined();
        expect(shownArticles(undefined)).toEqual([]);
        expect(shownArticles(state())).toEqual([]);
    });
});

describe('wikipediaForBuild', () => {
    it('happyPath_aDueFetchThenTheFile', async () => {
        const deps = withWiki(contentDeps(NOW), createFakeWikipedia([ATHENAEUM]));
        deps.documents.seed(STATE_PATH, state());

        await expect(wikipediaForBuild(deps, CITY_ID, cityDoc())).resolves.toMatchObject({ count: 1 });
    });

    it('happyPath_aFreshFetchIsNotAskedAgain', async () => {
        const wiki = createFakeWikipedia([ATHENAEUM]);
        const deps = withWiki(contentDeps(NOW), wiki);
        deps.documents.seed(STATE_PATH, state({ refreshedAt: YESTERDAY, articles: [ARTICLE] }));

        await expect(wikipediaForBuild(deps, CITY_ID, cityDoc())).resolves.toMatchObject({ count: 1 });
        expect(wiki.calls.places).toBe(0);
    });

    it('badPath_noStateOrABrokenStoreLeavesTheOverlayOut', async () => {
        const deps = contentDeps(NOW);
        await expect(wikipediaForBuild(deps, CITY_ID, cityDoc())).resolves.toBeUndefined();
        deps.documents.recorder.failNext('get', new Error('firestore down'));
        await expect(wikipediaForBuild(deps, CITY_ID, cityDoc())).resolves.toBeUndefined();
        expect(deps.recording.records.some((record) => record.message === 'wikipedia overlay skipped')).toBe(true);
    });
});

describe('withWikipedia', () => {
    const ref = { file: 'wikipedia.json', count: 1, generatedAt: NOW };
    const base = { layers: [], poiCategories: [] } as unknown as Manifest;

    it('happyPath_theCategoryAndTheReferenceAreAdded', () => {
        expect(withWikipedia(base, ref)).toMatchObject({ poiCategories: [WIKIPEDIA_CATEGORY], wikipedia: ref });
        expect(withWikipedia({ layers: [] } as unknown as Manifest, ref).poiCategories).toEqual([WIKIPEDIA_CATEGORY]);
    });

    it('badPath_noFileATakenIdOrNoRoomLeavesTheManifest', () => {
        expect(withWikipedia(base, undefined)).toBe(base);
        const taken = { layers: [{ id: WIKIPEDIA_CATEGORY_ID }], poiCategories: [] } as unknown as Manifest;
        expect(withWikipedia(taken, ref)).toBe(taken);
        const full = {
            layers: [],
            poiCategories: Array.from({ length: 50 }, (_, index) => ({ id: `c${String(index)}` })),
        } as unknown as Manifest;
        expect(withWikipedia(full, ref)).toBe(full);
    });
});

describe('buildManifest with Wikipedia', () => {
    it('happyPath_theServedManifestHasTheOverlay @S-A230-HAPPY-MANIFEST', async () => {
        const deps = withWiki(contentDeps(NOW), createFakeWikipedia([ATHENAEUM]));
        await seedCity(deps);
        deps.documents.seed(STATE_PATH, state());

        await expect(buildManifest(deps, { cityId: CITY_ID, requestedVersion: 1, full: true })).resolves.toBe('published');

        const served = gunzipSync(deps.blobs.object('public', STORAGE_PATHS.manifest(CITY_ID))?.bytes ?? new Uint8Array()).toString('utf8');
        const manifest = validateManifest(JSON.parse(served));
        expect(manifest.ok && manifest.value.wikipedia).toEqual({ file: 'wikipedia.json', count: 1, generatedAt: NOW });
        expect(manifest.ok && manifest.value.poiCategories?.at(-1)?.id).toBe(WIKIPEDIA_CATEGORY_ID);
    });
});
