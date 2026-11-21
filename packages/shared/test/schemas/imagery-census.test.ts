// M29 (docs/research/M29-imagery-census.md): the imagery census against a fake public Landsat catalogue.
import { describe, expect, it } from 'vitest';

import {
    CENSUS_MAX_PAGES,
    CENSUS_SEARCH_URL,
    CensusError,
    DECLASSIFIED_SCANNED,
    DECLASSIFIED_TO_SCAN,
    imageryCensus,
    translateCensus,
    type CensusFetch,
} from '../../src/census.js';
import { en } from '../../src/i18n/census/en.js';
import { ro } from '../../src/i18n/census/ro.js';

const BOX = [26.85, 46.53, 26.97, 46.6] as const;

interface Body {
    readonly collections: readonly string[];
    readonly datetime: string;
    readonly fields?: unknown;
    readonly token?: string;
}

const answer = (value: unknown, ok = true): ReturnType<CensusFetch> =>
    Promise.resolve({ ok, status: ok ? 200 : 503, json: () => Promise.resolve(value) });

function scene(id: string, href: string | undefined): object {
    return {
        id,
        properties: { datetime: '1998-09-12T08:00:00Z', 'eo:cloud_cover': 3.6 },
        assets: href === undefined ? {} : { rendered_preview: { href } },
    };
}

/** A catalogue with `pages` pages of ids per collection and a scene in every decade but the 1970s. */
function catalogue(pages = 1): { fetcher: CensusFetch; bodies: Body[] } {
    const bodies: Body[] = [];
    const fetcher: CensusFetch = (url, init) => {
        expect(url).toBe(CENSUS_SEARCH_URL);
        const body = JSON.parse(init.body as string) as Body;
        bodies.push(body);
        if (body.fields !== undefined) {
            const page = body.token === undefined ? 1 : Number(body.token);
            const next = page < pages ? [{ rel: 'next', body: { ...body, token: String(page + 1) } }] : [];
            return answer({ features: [{ id: 'a' }, { id: 'b' }], links: [...next, { rel: 'self' }] });
        }
        if (body.datetime.startsWith('1970')) {
            return answer({ features: [] });
        }
        const href = body.datetime.startsWith('1980')
            ? 'https://elsewhere.example.org/p.png'
            : 'https://planetarycomputer.microsoft.com/p.png';
        return answer({ features: [scene('LT05_L2SP_183028_19980912_02_T1', body.datetime.startsWith('2020') ? undefined : href)] });
    };
    return { fetcher, bodies };
}

describe('imageryCensus', () => {
    it('counts Landsat exactly, adds the declassified estimate and keeps a preview per decade on the catalogue only', async () => {
        const { fetcher, bodies } = catalogue();
        const census = await imageryCensus(fetcher, BOX);
        expect(census.landsat).toBe(4);
        expect(census.landsatMore).toBe(false);
        expect(census.free).toEqual({ low: DECLASSIFIED_SCANNED.low + 4, high: DECLASSIFIED_SCANNED.high + 4 });
        expect(census.total.low).toBe(census.free.low + DECLASSIFIED_TO_SCAN.low);
        expect(census.scanUsd).toBe(30);
        expect(census.previews.map((preview) => preview.decade)).toEqual([1980, 1990, 2000, 2010, 2020]);
        expect(census.previews[0]).toMatchObject({ mission: 5, cloud: 4, date: '1998-09-12', image: null });
        expect(census.previews[1]?.image).toBe('https://planetarycomputer.microsoft.com/p.png');
        expect(census.previews[4]?.image).toBeNull();
        expect(bodies.filter((body) => body.fields !== undefined).map((body) => body.collections[0])).toEqual([
            'landsat-c2-l1',
            'landsat-c2-l2',
        ]);
    });

    it('follows the next pages and says "more than" past the last page it reads', async () => {
        expect((await imageryCensus(catalogue(3).fetcher, BOX)).landsat).toBe(12);
        const capped = await imageryCensus(catalogue(CENSUS_MAX_PAGES + 2).fetcher, BOX);
        expect(capped).toMatchObject({ landsat: 4 * CENSUS_MAX_PAGES, landsatMore: true });
    });

    it('stops at an empty page', async () => {
        const fetcher: CensusFetch = (_url, init) =>
            (JSON.parse(init.body as string) as { fields?: unknown }).fields === undefined
                ? answer({ features: [] })
                : answer({ features: [], links: [{ rel: 'next', body: {} }] });
        expect(await imageryCensus(fetcher, BOX)).toMatchObject({ landsat: 0, landsatMore: false, previews: [] });
    });

    it('names why it failed: no answer, a refusal, an answer it cannot read', async () => {
        const reason = (fetcher: CensusFetch) => imageryCensus(fetcher, BOX).catch((error: unknown) => (error as CensusError).reason);
        expect(await reason(() => Promise.reject(new TypeError('Failed to fetch')))).toBe('offline');
        expect(await reason(() => answer({}, false))).toBe('refused');
        expect(await reason(() => answer({ features: 'no' }))).toBe('unreadable');
        expect(await reason(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('x')) }))).toBe(
            'unreadable',
        );
    });

    it('lets a cancelled search reject as the browser did, not as a failure of the catalogue', async () => {
        const abort = new AbortController();
        abort.abort();
        const error = new DOMException('aborted', 'AbortError');
        await expect(imageryCensus(() => Promise.reject(error), BOX, abort.signal)).rejects.toBe(error);
        expect(new CensusError('offline').message).toContain('offline');
    });
});

describe('the census texts', () => {
    it('has every Romanian key in English with the same placeholders', () => {
        const sorted = (keys: readonly string[]): string[] => keys.toSorted((a, b) => a.localeCompare(b));
        expect(sorted(Object.keys(en))).toEqual(sorted(Object.keys(ro)));
        expect(translateCensus('en', 'census.landsat', { count: '7' })).toContain('7 images');
        expect(translateCensus('ro', 'census.preview', { decade: '1990', mission: '5', date: 'd', cloud: '3' })).toContain('nori 3 %');
    });
});
