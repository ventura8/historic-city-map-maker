import { WIKIPEDIA_THUMB_WIDTH, WIKIPEDIA_USER_AGENT, type WikipediaLanguage } from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { WikipediaApi, WikipediaBox, WikipediaImage, WikipediaPage, WikipediaPlace } from '../ports/wikipedia-api.js';
import { at, list, readJson, send, stringAt, upstreamError, type Fetch } from './upstream-http.js';

/**
 * Wikipedia's MediaWiki Action API over REST (`docs/research/M31-wikipedia.md` §2), politely, as its API etiquette asks: one
 * request at a time with at least `MIN_GAP_MS` between two, the project's generic User-Agent (no person's address),
 * `maxlag=5` (a busy wiki answers `maxlag`, read as `rateLimited`), anonymous, no credential. `places` is `list=geosearch`
 * over a box, `pages` is `prop=extracts|info|pageimages|langlinks` (the intro's first two sentences as plain text, the page's
 * address, its page image only when free: `pilicense=free`), `image` reads a thumbnail of `upload.wikimedia.org` only.
 *
 * Failures (`UpstreamError('wikipedia', …)`): HTTP 429 or a `maxlag` error → `rateLimited`; 5xx, a timeout or the network →
 * `unavailable`; another error body or an answer that is not JSON → `invalid`.
 */
const SERVICE = 'wikipedia';

/** The least time between two requests, in milliseconds. */
export const MIN_GAP_MS = 250;
/** A thumbnail bigger than this is skipped. */
export const MAX_IMAGE_BYTES = 400_000;

const IMAGE_HOST = 'https://upload.wikimedia.org/';
const IMAGE_TYPES: readonly WikipediaImage['contentType'][] = ['image/jpeg', 'image/png', 'image/webp'];

/** The answer's image type when it is one the overlay keeps. */
function imageType(response: Response): WikipediaImage['contentType'] | undefined {
    const type = response.headers.get('content-type') ?? '';
    return IMAGE_TYPES.find((candidate) => candidate === type);
}

export interface WikipediaOptions {
    readonly fetch: Fetch;
    /** Waits `ms` milliseconds (tests pass one that does not). */
    readonly sleep?: (ms: number) => Promise<void>;
    /** Milliseconds now (tests pass a fixed clock). */
    readonly now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function apiUrl(language: WikipediaLanguage, params: Readonly<Record<string, string>>): string {
    const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params }).toString();
    return url.href;
}

function numberAt(value: unknown, key: string): number | undefined {
    const found = at(value, key);
    return typeof found === 'number' && Number.isFinite(found) ? found : undefined;
}

function placeOf(entry: unknown): WikipediaPlace[] {
    const pageId = numberAt(entry, 'pageid');
    const lat = numberAt(entry, 'lat');
    const lng = numberAt(entry, 'lon');
    const title = stringAt(entry, 'title');
    return pageId === undefined || lat === undefined || lng === undefined || title === undefined ? [] : [{ pageId, title, lat, lng }];
}

function titlesOf(entry: unknown, others: readonly WikipediaLanguage[]): WikipediaPage['titles'] {
    const pairs = list(at(entry, 'langlinks')).flatMap((link) => {
        const language = others.find((other) => other === stringAt(link, 'lang'));
        const title = stringAt(link, 'title');
        return language === undefined || title === undefined ? [] : [[language, title] as const];
    });
    return Object.fromEntries(pairs);
}

function pageOf(entry: unknown, others: readonly WikipediaLanguage[]): WikipediaPage[] {
    const pageId = numberAt(entry, 'pageid');
    const title = stringAt(entry, 'title');
    const url = stringAt(entry, 'fullurl');
    if (pageId === undefined || title === undefined || url === undefined) {
        return [];
    }
    const page = { pageId, title, url, extract: stringAt(entry, 'extract') ?? '', titles: titlesOf(entry, others) };
    return [withThumbnail(page, stringAt(entry, 'thumbnail', 'source'))];
}

/** The page with its free image's thumbnail, when it has one. */
function withThumbnail(page: WikipediaPage, thumbnail: string | undefined): WikipediaPage {
    return thumbnail === undefined ? page : { ...page, thumbnail };
}

export function createWikipediaApi(options: WikipediaOptions): WikipediaApi {
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    let last = Number.NEGATIVE_INFINITY;

    const request = async (url: string): Promise<Response> => {
        const wait = last + MIN_GAP_MS - now();
        if (wait > 0) {
            await sleep(wait);
        }
        last = now();
        return send(options.fetch, SERVICE, url, {
            headers: { 'User-Agent': WIKIPEDIA_USER_AGENT, 'Api-User-Agent': WIKIPEDIA_USER_AGENT },
        });
    };

    const query = async (language: WikipediaLanguage, params: Readonly<Record<string, string>>): Promise<unknown> => {
        const response = await request(apiUrl(language, params));
        if (!response.ok) {
            throw upstreamError(SERVICE, response);
        }
        const body = await readJson(response);
        const code = stringAt(body, 'error', 'code');
        if (code !== undefined || at(body, 'query') === undefined) {
            throw new UpstreamError(SERVICE, code === 'maxlag' ? 'rateLimited' : 'invalid');
        }
        return at(body, 'query');
    };

    return {
        async places(language: WikipediaLanguage, box: WikipediaBox): Promise<readonly WikipediaPlace[]> {
            const bbox = [box.north, box.west, box.south, box.east].map(String).join('|');
            const answer = await query(language, { list: 'geosearch', gsbbox: bbox, gslimit: '500', gsnamespace: '0' });
            return list(at(answer, 'geosearch')).flatMap(placeOf);
        },

        async pages(language, pageIds, others): Promise<readonly WikipediaPage[]> {
            if (pageIds.length === 0) {
                return [];
            }
            const links = others[0] === undefined ? {} : { lllang: others[0], lllimit: 'max' };
            const answer = await query(language, {
                pageids: pageIds.slice(0, 20).map(String).join('|'),
                prop: others.length === 0 ? 'extracts|info|pageimages' : 'extracts|info|pageimages|langlinks',
                ...{ exintro: '1', explaintext: '1', exsentences: '2', exlimit: '20' },
                ...{ inprop: 'url', piprop: 'thumbnail', pithumbsize: String(WIKIPEDIA_THUMB_WIDTH), pilicense: 'free', pilimit: '20' },
                ...links,
            });
            return list(at(answer, 'pages')).flatMap((entry) => pageOf(entry, others));
        },

        async image(url: string): Promise<WikipediaImage | undefined> {
            if (!url.startsWith(IMAGE_HOST)) {
                return undefined;
            }
            const response = await request(url);
            if (!response.ok) {
                throw upstreamError(SERVICE, response);
            }
            const contentType = imageType(response);
            const bytes = new Uint8Array(await response.arrayBuffer());
            return contentType === undefined || bytes.byteLength > MAX_IMAGE_BYTES ? undefined : { bytes, contentType };
        },
    };
}
