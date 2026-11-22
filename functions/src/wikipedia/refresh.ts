/**
 * The Wikipedia overlay at a manifest build (`docs/research/M31-wikipedia.md` §2): when the city has it on and its last
 * fetch is older than `WIKIPEDIA_REFRESH_DAYS` (or the admin asked for one), the articles are fetched again and their free
 * thumbnails copied to the public bucket; then `wikipedia.json` is written beside the manifest without the hidden articles,
 * and the manifest gets the overlay's category and `wikipedia`. A failed fetch is recorded (`failure`) and the articles of
 * the fetch before are kept: Wikipedia never fails the build. Off, or with no article, the file is removed.
 */
import { gzipSync } from 'node:zlib';

import {
    FIRESTORE_PATHS,
    MANIFEST_CACHE_CONTROL,
    MAX_POI_CATEGORIES,
    STORAGE_PATHS,
    WIKIPEDIA_ATTRIBUTION,
    WIKIPEDIA_CATEGORY_ID,
    WIKIPEDIA_FILE,
    WIKIPEDIA_REFRESH_DAYS,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    wikipediaArticleSchema,
    wikipediaStateDocSchema,
    type CityDoc,
    type Manifest,
    type PoiCategory,
    type WikipediaArticle,
    type WikipediaFailure,
    type WikipediaFile,
    type WikipediaRef,
    type WikipediaStateDoc,
} from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { fetchArticles, type FetchedArticle } from './fetch.js';

export type WikipediaDeps = Pick<Ports, 'log' | 'clock' | 'documents' | 'blobs' | 'wiki'>;

const DAY_MS = 86_400_000;
/** At most this many thumbnails are copied a fetch. */
export const MAX_THUMBS = 150;
const THUMB_CACHE_CONTROL = 'public, max-age=86400';
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** The overlay's row in Layers: hidden at open, its own switch and slider, the text's licence as its credit. */
export const WIKIPEDIA_CATEGORY: PoiCategory = {
    id: WIKIPEDIA_CATEGORY_ID,
    label: { ro: 'Wikipedia', en: 'Wikipedia' },
    icon: 'info',
    color: '#3c4043',
    defaultOpacity: 1,
    defaultVisible: false,
    attribution: WIKIPEDIA_ATTRIBUTION,
};

/** Whether the state asks for a fetch at `now`. */
export function fetchDue(state: WikipediaStateDoc | undefined, now: Date): boolean {
    if (state?.enabled !== true) {
        return false;
    }
    if (state.refreshRequested === true || state.refreshedAt === undefined) {
        return true;
    }
    return now.getTime() - timestampToDate(state.refreshedAt).getTime() >= WIKIPEDIA_REFRESH_DAYS * DAY_MS;
}

function failureOf(error: unknown): WikipediaFailure {
    if (error instanceof UpstreamError && (error.failure === 'rateLimited' || error.failure === 'unavailable')) {
        return error.failure;
    }
    return 'invalid';
}

/** Copies an article's free thumbnail; the article without it when the image cannot be read. */
async function withThumb(deps: WikipediaDeps, cityId: string, fetched: FetchedArticle): Promise<WikipediaArticle> {
    if (fetched.thumbnail === undefined) {
        return fetched.article;
    }
    try {
        const image = await deps.wiki.image(fetched.thumbnail);
        if (image === undefined) {
            return fetched.article;
        }
        const thumb = `wikipedia/${fetched.article.id}.${EXTENSIONS[image.contentType]}`;
        await deps.blobs.write('public', STORAGE_PATHS.wikipediaThumb(cityId, thumb), image.bytes, {
            contentType: image.contentType,
            cacheControl: THUMB_CACHE_CONTROL,
        });
        return { ...fetched.article, thumb };
    } catch (error) {
        deps.log.warn('wikipedia thumbnail skipped', { cityId, articleId: fetched.article.id, error: String(error) });
        return fetched.article;
    }
}

/** The articles the schema accepts (a title Wikipedia lets be longer than ours is dropped, never the fetch). */
function valid(articles: readonly WikipediaArticle[]): WikipediaArticle[] {
    return articles.filter((article) => wikipediaArticleSchema.safeParse(article).success);
}

async function fetched(deps: WikipediaDeps, cityId: string, city: CityDoc, state: WikipediaStateDoc): Promise<WikipediaArticle[]> {
    const found = await fetchArticles(deps.wiki, city.bounds, state.languages);
    const articles: WikipediaArticle[] = [];
    for (const [index, article] of found.entries()) {
        articles.push(index < MAX_THUMBS ? await withThumb(deps, cityId, article) : article.article);
    }
    return valid(articles);
}

/** The state without the request and the failure a fetch settles. */
function settled(state: WikipediaStateDoc): WikipediaStateDoc {
    const copy = { ...state };
    delete copy.refreshRequested;
    delete copy.failure;
    return copy;
}

/** A fetch, recorded on the state: its articles, or its failure with the articles of the fetch before. */
export async function refreshState(
    deps: WikipediaDeps,
    cityId: string,
    city: CityDoc,
    state: WikipediaStateDoc,
): Promise<WikipediaStateDoc> {
    const now = deps.clock.now();
    const stamp = { updatedBy: systemWriter('publish'), updatedAt: timestampFromDate(now) };
    const rest = settled(state);
    let next: WikipediaStateDoc;
    try {
        const articles = await fetched(deps, cityId, city, state);
        next = { ...rest, ...stamp, articles, refreshedAt: timestampFromDate(now) };
        deps.log.info('wikipedia fetched', { cityId, articles: articles.length, languages: state.languages.join(',') });
    } catch (error) {
        const failure = failureOf(error);
        deps.log.warn('wikipedia fetch failed', { cityId, failure, error: String(error) });
        next = { ...rest, ...stamp, failure };
    }
    await deps.documents.set(FIRESTORE_PATHS.wikipedia(cityId), wikipediaStateDocSchema, next);
    return next;
}

/** The articles visitors see: the last fetch's, without the hidden ones. */
export function shownArticles(state: WikipediaStateDoc | undefined): readonly WikipediaArticle[] {
    if (state?.enabled !== true) {
        return [];
    }
    const hidden = new Set(state.hidden);
    return (state.articles ?? []).filter((article) => !hidden.has(article.id));
}

/** Writes `wikipedia.json` (or removes it when there is nothing to show); its reference for the manifest. */
export async function publishFile(
    deps: WikipediaDeps,
    cityId: string,
    state: WikipediaStateDoc | undefined,
): Promise<WikipediaRef | undefined> {
    const articles = shownArticles(state);
    const path = STORAGE_PATHS.wikipediaFile(cityId);
    if (articles.length === 0) {
        await deps.blobs.delete('public', path);
        return undefined;
    }
    const generatedAt = deps.clock.now().toISOString();
    const file: WikipediaFile = { version: 1, generatedAt, attribution: WIKIPEDIA_ATTRIBUTION, articles: [...articles] };
    await deps.blobs.write('public', path, gzipSync(JSON.stringify(file), { level: 9 }), {
        contentType: 'application/json',
        contentEncoding: 'gzip',
        cacheControl: MANIFEST_CACHE_CONTROL,
    });
    return { file: WIKIPEDIA_FILE, count: articles.length, generatedAt };
}

/**
 * The overlay at a build: a fetch when one is due, then the file. Any failure is logged and the manifest goes out without
 * the overlay (`undefined`), never a failed build.
 */
export async function wikipediaForBuild(deps: WikipediaDeps, cityId: string, city: CityDoc): Promise<WikipediaRef | undefined> {
    try {
        let state = await deps.documents.get(FIRESTORE_PATHS.wikipedia(cityId), wikipediaStateDocSchema);
        if (state !== undefined && fetchDue(state, deps.clock.now())) {
            state = await refreshState(deps, cityId, city, state);
        }
        return await publishFile(deps, cityId, state);
    } catch (error) {
        deps.log.error('wikipedia overlay skipped', { cityId, error: String(error) });
        return undefined;
    }
}

/** Whether the manifest has room for the overlay's category: its id free, a category to spare. */
function roomFor(manifest: Manifest): boolean {
    const categories = manifest.poiCategories ?? [];
    const ids = [...categories.map((category) => category.id), ...manifest.layers.map((layer) => layer.id)];
    return !ids.includes(WIKIPEDIA_CATEGORY_ID) && categories.length < MAX_POI_CATEGORIES;
}

/** The manifest with the overlay: its category last in Layers' places, and the file's reference. */
export function withWikipedia(manifest: Manifest, ref: WikipediaRef | undefined): Manifest {
    if (ref === undefined || !roomFor(manifest)) {
        return manifest;
    }
    return { ...manifest, poiCategories: [...(manifest.poiCategories ?? []), WIKIPEDIA_CATEGORY], wikipedia: ref };
}
