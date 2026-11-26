/**
 * The Wikipedia adapter (`functions/src/adapters/wikipedia.ts`, `docs/research/M31-wikipedia.md` §2) against a scripted `fetch`
 * (no network): the requests the API etiquette asks for (the generic User-Agent, `maxlag`, one at a time with a gap), what it
 * reads of `geosearch` and of the pages, a thumbnail of upload.wikimedia.org only, and its failures.
 */
import { WIKIPEDIA_USER_AGENT } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { createWikipediaApi, MAX_IMAGE_BYTES, MIN_GAP_MS } from '../../src/adapters/wikipedia.js';
import type { Fetch } from '../../src/adapters/upstream-http.js';
import { UpstreamError } from '../../src/ports/errors.js';

interface Call {
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
}

function addressOf(input: Parameters<Fetch>[0]): string {
    if (typeof input === 'string') {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
}

function scripted(answers: readonly Response[]) {
    const calls: Call[] = [];
    const queue = [...answers];
    const fetch: Fetch = (input, init) => {
        calls.push({ url: new URL(addressOf(input)), headers: (init?.headers ?? {}) as Record<string, string> });
        const next = queue.shift();
        return next === undefined ? Promise.reject(new TypeError('network down')) : Promise.resolve(next);
    };
    return { calls, fetch };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const BOX = { west: 26.05, south: 44.4, east: 26.15, north: 44.48 };

function api(answers: readonly Response[], clock = { now: 0 }) {
    const waits: number[] = [];
    const script = scripted(answers);
    const wiki = createWikipediaApi({
        fetch: script.fetch,
        now: () => clock.now,
        sleep: (ms) => {
            waits.push(ms);
            clock.now += ms;
            return Promise.resolve();
        },
    });
    return { ...script, wiki, waits };
}

describe('places', () => {
    it('happyPath_geosearchOverTheBoxAnswersThePlacesPolitely', async () => {
        const { wiki, calls } = api([
            json({
                query: {
                    geosearch: [
                        { pageid: 10, title: 'Ateneul Român', lat: 44.4413, lon: 26.0973 },
                        { pageid: 'x', title: 'Broken', lat: 1, lon: 2 },
                    ],
                },
            }),
        ]);

        await expect(wiki.places('ro', BOX)).resolves.toEqual([{ pageId: 10, title: 'Ateneul Român', lat: 44.4413, lng: 26.0973 }]);
        const [call] = calls;
        expect(call?.url.origin).toBe('https://ro.wikipedia.org');
        expect(Object.fromEntries(call?.url.searchParams ?? [])).toMatchObject({
            action: 'query',
            list: 'geosearch',
            gsbbox: '44.48|26.05|44.4|26.15',
            gslimit: '500',
            maxlag: '5',
            formatversion: '2',
        });
        expect(call?.headers['User-Agent']).toBe(WIKIPEDIA_USER_AGENT);
    });

    it('happyPath_twoRequestsAreSpacedByTheGap', async () => {
        const { wiki, waits } = api([json({ query: { geosearch: [] } }), json({ query: {} })]);

        await wiki.places('en', BOX);
        await expect(wiki.places('en', BOX)).resolves.toEqual([]);
        expect(waits).toEqual([MIN_GAP_MS]);
    });

    it('badPath_maxlagIsRateLimitedAndAnotherErrorInvalid', async () => {
        await expect(api([json({ error: { code: 'maxlag' } })]).wiki.places('ro', BOX)).rejects.toMatchObject({ failure: 'rateLimited' });
        await expect(api([json({ error: { code: 'toobig' } })]).wiki.places('ro', BOX)).rejects.toMatchObject({ failure: 'invalid' });
        await expect(api([new Response('<html>', { status: 200 })]).wiki.places('ro', BOX)).rejects.toMatchObject({ failure: 'invalid' });
    });

    it('badPath_statusesAndTheNetworkAreUpstreamErrors', async () => {
        await expect(api([json({}, 429)]).wiki.places('ro', BOX)).rejects.toMatchObject({ failure: 'rateLimited' });
        await expect(api([json({}, 503)]).wiki.places('ro', BOX)).rejects.toMatchObject({ failure: 'unavailable' });
        await expect(api([]).wiki.places('ro', BOX)).rejects.toBeInstanceOf(UpstreamError);
    });
});

describe('pages', () => {
    it('happyPath_theDetailsWithAFreeThumbnailAndTheOtherTitle', async () => {
        const { wiki, calls } = api([
            json({
                query: {
                    pages: [
                        {
                            pageid: 10,
                            title: 'Ateneul Român',
                            extract: 'O sală de concerte.',
                            fullurl: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n',
                            thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' },
                            langlinks: [
                                { lang: 'en', title: 'Romanian Athenaeum' },
                                { lang: 'de', title: 'Rumänisches Athenäum' },
                            ],
                        },
                        { pageid: 11, title: 'Fără text', fullurl: 'https://ro.wikipedia.org/wiki/F' },
                        { pageid: 12, title: 'Fără adresă' },
                    ],
                },
            }),
        ]);

        await expect(wiki.pages('ro', [10, 11, 12], ['en'])).resolves.toEqual([
            {
                pageId: 10,
                title: 'Ateneul Român',
                extract: 'O sală de concerte.',
                url: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n',
                thumbnail: 'https://upload.wikimedia.org/a.jpg',
                titles: { en: 'Romanian Athenaeum' },
            },
            { pageId: 11, title: 'Fără text', extract: '', url: 'https://ro.wikipedia.org/wiki/F', titles: {} },
        ]);
        expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toMatchObject({
            pageids: '10|11|12',
            prop: 'extracts|info|pageimages|langlinks',
            pilicense: 'free',
            lllang: 'en',
            explaintext: '1',
        });
    });

    it('happyPath_noOtherLanguageAsksNoLanglinksAndNoPageAsksNothing', async () => {
        const { wiki, calls } = api([json({ query: { pages: [] } })]);

        await expect(wiki.pages('en', [], [])).resolves.toEqual([]);
        await expect(wiki.pages('en', [1], [])).resolves.toEqual([]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url.searchParams.get('prop')).toBe('extracts|info|pageimages');
        expect(calls[0]?.url.searchParams.has('lllang')).toBe(false);
    });
});

describe('image', () => {
    it('happyPath_aThumbnailOfUploadWikimediaOrg', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const { wiki } = api([new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })]);

        await expect(wiki.image('https://upload.wikimedia.org/x/320px-a.jpg')).resolves.toEqual({ bytes, contentType: 'image/jpeg' });
    });

    it('badPath_anotherHostATypeOrASizeIsSkipped', async () => {
        const { wiki, calls } = api([
            new Response('svg', { headers: { 'content-type': 'image/svg+xml' } }),
            new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { headers: { 'content-type': 'image/png' } }),
            new Response('x'),
        ]);

        await expect(wiki.image('https://example.org/a.jpg')).resolves.toBeUndefined();
        expect(calls).toHaveLength(0);
        await expect(wiki.image('https://upload.wikimedia.org/a.svg')).resolves.toBeUndefined();
        await expect(wiki.image('https://upload.wikimedia.org/b.png')).resolves.toBeUndefined();
        await expect(wiki.image('https://upload.wikimedia.org/c')).resolves.toBeUndefined();
    });

    it('badPath_aFailedAnswerIsAnUpstreamError', async () => {
        await expect(api([new Response('', { status: 404 })]).wiki.image('https://upload.wikimedia.org/a.jpg')).rejects.toMatchObject({
            failure: 'notFound',
        });
    });
});

describe('defaults', () => {
    it('happyPath_theClockAndTimerOfTheRuntimeAreUsedWithoutOptions', async () => {
        vi.useFakeTimers();
        try {
            const script = scripted([json({ query: { geosearch: [] } }), json({ query: { geosearch: [] } })]);
            const wiki = createWikipediaApi({ fetch: script.fetch });

            await wiki.places('ro', BOX);
            const second = wiki.places('ro', BOX);
            await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
            await expect(second).resolves.toEqual([]);
            expect(script.calls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
