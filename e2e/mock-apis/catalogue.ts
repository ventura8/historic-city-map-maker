import { rasterTile } from './tiles.js';

/**
 * The public Landsat catalogue the imagery census searches (M29, `docs/research/M29-imagery-census.md`; Microsoft's Planetary
 * Computer STAC API): a count query (`fields`) answers `E2E_CENSUS_COUNTS` ids of its collection on one page; a decade's best
 * query (`sortby`) answers one scene with the catalogue's preview address, whose GET answers a small PNG. A test that needs a
 * failure routes the host itself (S-A189-BAD-CENSUS).
 */

/** The router's request and answer, by shape (importing router.ts here would be a cycle). */
interface MockRequest {
    readonly method: string;
    readonly path: string;
    readonly body: string;
}
interface MockResponse {
    readonly status: number;
    readonly type?: string;
    readonly body?: string | Uint8Array;
}

const ORIGIN = 'https://planetarycomputer.microsoft.com';
/** Scenes under the cloud cap per collection: Level-1 (the MSS years), Level-2 (1982 on). */
export const E2E_CENSUS_COUNTS: Readonly<Record<string, number>> = { 'landsat-c2-l1': 12, 'landsat-c2-l2': 345 };
/** The decade without a scene (the 1970s have no preview in this world). */
const EMPTY_DECADE = '1970';

interface Search {
    readonly collections?: readonly string[];
    readonly datetime?: string;
    readonly fields?: unknown;
}

function json(value: unknown): MockResponse {
    return { status: 200, type: 'application/geo+json', body: JSON.stringify(value) };
}

function scene(collection: string, decade: string): object {
    const id = `LT05_L2SP_182028_${decade.slice(0, 3)}50715_02_T1`;
    return {
        id,
        properties: { datetime: `${decade.slice(0, 3)}5-07-15T08:30:00Z`, 'eo:cloud_cover': 2.4 },
        assets: { rendered_preview: { href: `${ORIGIN}/api/data/v1/item/preview.png?collection=${collection}&item=${id}` } },
    };
}

function search(request: MockRequest): MockResponse {
    const body = JSON.parse(request.body === '' ? '{}' : request.body) as Search;
    const collection = body.collections?.[0] ?? '';
    if (body.fields !== undefined) {
        const count = E2E_CENSUS_COUNTS[collection] ?? 0;
        return json({ features: Array.from({ length: count }, (_, index) => ({ id: `${collection}-${String(index)}` })), links: [] });
    }
    const decade = (body.datetime ?? '').slice(0, 4);
    return json({ features: decade === EMPTY_DECADE ? [] : [scene(collection, decade)], links: [] });
}

/** The catalogue's answer: the search (POST) and the previews (GET). */
export async function catalogue(request: MockRequest): Promise<MockResponse> {
    if (request.method === 'POST' && request.path === '/api/stac/v1/search') {
        return search(request);
    }
    if (request.path === '/api/data/v1/item/preview.png') {
        return { status: 200, type: 'image/png', body: await rasterTile([96, 128, 96], 'L', 64, 'png') };
    }
    return { status: 404, type: 'text/plain', body: 'not found' };
}
