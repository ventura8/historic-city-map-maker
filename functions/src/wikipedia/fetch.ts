/**
 * The Wikipedia overlay's fetch (`docs/research/M31-wikipedia.md` §2): the geotagged articles in the city's bounds, in each
 * language the city chose. The bounds are cut into cells small enough for `list=geosearch`'s box (at most `MAX_CELLS`); the
 * first language's pages are asked for their titles in the others, so one place read on both Wikipedias is one article with
 * two versions; a page of another language that no first-language page links to is an article of its own. The nearest
 * `MAX_WIKIPEDIA_ARTICLES` to the city's centre are kept; each keeps the address of its free page image, if any.
 */
import {
    MAX_WIKIPEDIA_ARTICLES,
    WIKIPEDIA_EXTRACT_CHARS,
    type WikipediaArticle,
    type WikipediaLanguage,
    type WikipediaVersion,
} from '@hcm/shared';

import type { WikipediaApi, WikipediaBox, WikipediaPage, WikipediaPlace } from '../ports/wikipedia-api.js';

/** A cell's size in degrees: within geosearch's largest box (about 10 km a side) at any latitude a city has. */
export const CELL_LAT_DEG = 0.08;
export const CELL_LNG_DEG = 0.1;
/** At most this many cells a language (a larger city keeps those nearest its centre). */
export const MAX_CELLS = 36;
/** `list=geosearch` answers at most this many places a box (`gslimit`): a box that fills it may hold more. */
export const GEOSEARCH_LIMIT = 500;
/** A full box is cut into four, at most this many times (a dense centre: Bucharest's held more than 500 a cell). */
export const MAX_SPLIT_DEPTH = 4;
const PAGES_PER_REQUEST = 20;

/** One fetched article and its free page image's address (copied to the public bucket by `refresh.ts`). */
export interface FetchedArticle {
    readonly article: WikipediaArticle;
    readonly thumbnail?: string;
}

function centreOf(box: WikipediaBox): readonly [number, number] {
    return [(box.west + box.east) / 2, (box.south + box.north) / 2];
}

function distance([lng, lat]: readonly [number, number], [toLng, toLat]: readonly [number, number]): number {
    return Math.hypot((lng - toLng) * Math.cos((lat * Math.PI) / 180), lat - toLat);
}

/** The bounds cut into cells, nearest the centre first, at most `MAX_CELLS`. */
export function cellsOf(bounds: WikipediaBox): readonly WikipediaBox[] {
    const columns = Math.ceil((bounds.east - bounds.west) / CELL_LNG_DEG);
    const rows = Math.ceil((bounds.north - bounds.south) / CELL_LAT_DEG);
    const width = (bounds.east - bounds.west) / columns;
    const height = (bounds.north - bounds.south) / rows;
    const cells = Array.from({ length: columns * rows }, (_, index) => {
        const west = bounds.west + (index % columns) * width;
        const south = bounds.south + Math.floor(index / columns) * height;
        return { west, south, east: west + width, north: south + height };
    });
    const centre = centreOf(bounds);
    return cells.toSorted((a, b) => distance(centreOf(a), centre) - distance(centreOf(b), centre)).slice(0, MAX_CELLS);
}

function inside(bounds: WikipediaBox, place: WikipediaPlace): boolean {
    return place.lng >= bounds.west && place.lng <= bounds.east && place.lat >= bounds.south && place.lat <= bounds.north;
}

/** The four quarters of a box. */
export function quartersOf(box: WikipediaBox): readonly WikipediaBox[] {
    const [lng, lat] = centreOf(box);
    return [
        { west: box.west, south: lat, east: lng, north: box.north },
        { west: lng, south: lat, east: box.east, north: box.north },
        { west: box.west, south: box.south, east: lng, north: lat },
        { west: lng, south: box.south, east: box.east, north: lat },
    ];
}

/** The places of one box; a box that fills geosearch's answer is asked again in quarters, so none is cut off. */
async function placesIn(
    api: WikipediaApi,
    language: WikipediaLanguage,
    box: WikipediaBox,
    depth: number,
): Promise<readonly WikipediaPlace[]> {
    const places = await api.places(language, box);
    if (places.length < GEOSEARCH_LIMIT || depth >= MAX_SPLIT_DEPTH) {
        return places;
    }
    const parts = [];
    for (const quarter of quartersOf(box)) {
        parts.push(...(await placesIn(api, language, quarter, depth + 1)));
    }
    return parts;
}

/** Every geotagged page of the language in the bounds, once, nearest the centre first, at most `MAX_WIKIPEDIA_ARTICLES`. */
async function placesOf(api: WikipediaApi, language: WikipediaLanguage, bounds: WikipediaBox): Promise<readonly WikipediaPlace[]> {
    const found = new Map<number, WikipediaPlace>();
    for (const cell of cellsOf(bounds)) {
        for (const place of await placesIn(api, language, cell, 0)) {
            if (inside(bounds, place)) {
                found.set(place.pageId, place);
            }
        }
    }
    const centre = centreOf(bounds);
    return [...found.values()]
        .toSorted((a, b) => distance([a.lng, a.lat], centre) - distance([b.lng, b.lat], centre))
        .slice(0, MAX_WIKIPEDIA_ARTICLES);
}

async function pagesOf(
    api: WikipediaApi,
    language: WikipediaLanguage,
    places: readonly WikipediaPlace[],
    others: readonly WikipediaLanguage[],
): Promise<ReadonlyMap<number, WikipediaPage>> {
    const pages = new Map<number, WikipediaPage>();
    for (let start = 0; start < places.length; start += PAGES_PER_REQUEST) {
        const ids = places.slice(start, start + PAGES_PER_REQUEST).map((place) => place.pageId);
        for (const page of await api.pages(language, ids, others)) {
            pages.set(page.pageId, page);
        }
    }
    return pages;
}

/** The first sentences within `WIKIPEDIA_EXTRACT_CHARS`, cut at a word with an ellipsis. */
export function shortExtract(text: string): string {
    const clean = text.replaceAll(/\s+/g, ' ').trim();
    if (clean.length <= WIKIPEDIA_EXTRACT_CHARS) {
        return clean;
    }
    const cut = clean.slice(0, WIKIPEDIA_EXTRACT_CHARS - 1);
    const word = cut.lastIndexOf(' ');
    return `${(word > 0 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

function versionOf(page: WikipediaPage): WikipediaVersion {
    return { title: page.title, extract: shortExtract(page.extract), url: page.url };
}

interface Draft {
    article: WikipediaArticle;
    thumbnail?: string;
}

function draftOf(language: WikipediaLanguage, place: WikipediaPlace, page: WikipediaPage): Draft {
    const article: WikipediaArticle = {
        id: `${language}-${String(place.pageId)}`,
        lng: place.lng,
        lat: place.lat,
        versions: { [language]: versionOf(page) },
    };
    return page.thumbnail === undefined ? { article } : { article, thumbnail: page.thumbnail };
}

/** A page of another language joins the first-language article that links to it, or is one of its own. */
function joinOther(found: Found, language: WikipediaLanguage, place: WikipediaPlace, page: WikipediaPage): void {
    const { drafts, byTitle } = found;
    const draft = byTitle.get(page.title);
    if (draft === undefined) {
        drafts.push(draftOf(language, place, page));
        return;
    }
    draft.article = { ...draft.article, versions: { ...draft.article.versions, [language]: versionOf(page) } };
    if (draft.thumbnail === undefined && page.thumbnail !== undefined) {
        draft.thumbnail = page.thumbnail;
    }
}

/** What the other languages join: the drafts so far, and each first-language draft's titles on the other Wikipedias. */
interface Found {
    readonly drafts: Draft[];
    readonly byTitle: ReadonlyMap<string, Draft>;
}

async function addOthers(
    api: WikipediaApi,
    request: { readonly bounds: WikipediaBox; readonly others: readonly WikipediaLanguage[] },
    drafts: Draft[],
    titles: ReadonlyMap<Draft, WikipediaPage['titles']>,
): Promise<void> {
    const { bounds, others } = request;
    for (const language of others) {
        const byTitle = new Map(
            [...titles].flatMap(([draft, linked]) => (linked[language] === undefined ? [] : [[linked[language], draft] as const])),
        );
        const places = await placesOf(api, language, bounds);
        const pages = await pagesOf(api, language, places, []);
        for (const place of places) {
            const page = pages.get(place.pageId);
            if (page !== undefined) {
                joinOther({ drafts, byTitle }, language, place, page);
            }
        }
    }
}

/** The articles of the city's bounds in `languages` (the first is the one others join), nearest the centre first. */
export async function fetchArticles(
    api: WikipediaApi,
    bounds: WikipediaBox,
    languages: readonly WikipediaLanguage[],
): Promise<readonly FetchedArticle[]> {
    const [first, ...others] = languages;
    if (first === undefined) {
        return [];
    }
    const places = await placesOf(api, first, bounds);
    const pages = await pagesOf(api, first, places, others);
    const drafts: Draft[] = [];
    const titles = new Map<Draft, WikipediaPage['titles']>();
    for (const place of places) {
        const page = pages.get(place.pageId);
        if (page !== undefined) {
            const draft = draftOf(first, place, page);
            drafts.push(draft);
            titles.set(draft, page.titles);
        }
    }
    await addOthers(api, { bounds, others }, drafts, titles);
    const centre = centreOf(bounds);
    const near = (draft: Draft): number => distance([draft.article.lng, draft.article.lat], centre);
    return drafts
        .toSorted((a, b) => near(a) - near(b))
        .slice(0, MAX_WIKIPEDIA_ARTICLES)
        .map((draft) =>
            draft.thumbnail === undefined ? { article: draft.article } : { article: draft.article, thumbnail: draft.thumbnail },
        );
}
