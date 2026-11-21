/**
 * M29 (`docs/research/M29-imagery-census.md`): how many old images from above exist for a city, before any account. Landsat is
 * counted exactly from a public STAC catalogue that answers a browser (Microsoft's Planetary Computer: Landsat Collection 2,
 * Level-1 for the MSS years 1972–1981, Level-2 from 1982); the best scene of each decade comes with the catalogue's own preview.
 * The declassified frames need a USGS login (M2M), so they are a labelled estimate, with the scan price the app uses.
 */
import { z } from 'zod';

import { USGS_ORDER_FEE_USD, USGS_SCAN_PRICE_USD } from './usgs-order.js';

/** The catalogue's origin: the only host whose previews the census shows (and the CSPs allow). */
export const CENSUS_ORIGIN = 'https://planetarycomputer.microsoft.com';
export const CENSUS_SEARCH_URL = `${CENSUS_ORIGIN}/api/stac/v1/search`;
/** A scene counts when at most this share of it is cloud (the harvest's own cap, `LANDSAT_SEARCH_MAX_CLOUD`). */
export const CENSUS_MAX_CLOUD = 40;
/** A page of ids; a city has a few thousand scenes, so at most `CENSUS_MAX_PAGES` pages are read before saying "more than". */
const PAGE_SIZE = 1000;
export const CENSUS_MAX_PAGES = 8;
/** When the declassified estimate's figures were set (the harvests of Bucharest, 2026-10 and 2026-11). */
export const CENSUS_ESTIMATE_CHECKED_ON = '2026-11-15';

export type CensusBox = readonly [west: number, south: number, east: number, north: number];
export interface CountRange {
    readonly low: number;
    readonly high: number;
}

/**
 * The declassified frames (Corona, Argon, Gambit, Hexagon; 1960–1984) a city usually has, from the harvests the app ran:
 * Bucharest's reached the 500-scene cap of two datasets. Most Corona frames are already scanned (free to download); the rest are
 * scanned on request at `USGS_SCAN_PRICE_USD` a frame. An estimate, never shown as a count.
 */
export const DECLASSIFIED_SCANNED: CountRange = { low: 70, high: 600 };
export const DECLASSIFIED_TO_SCAN: CountRange = { low: 30, high: 400 };

const ERAS = [
    { collection: 'landsat-c2-l1', from: '1972-07-01', to: '1981-12-31' },
    { collection: 'landsat-c2-l2', from: '1982-01-01', to: '..' },
] as const;
export const CENSUS_DECADES = [1970, 1980, 1990, 2000, 2010, 2020] as const;

const nextSchema = z.object({ rel: z.literal('next'), body: z.record(z.string(), z.unknown()) });
const pageSchema = z.object({
    features: z.array(z.object({ id: z.string() })),
    links: z.array(z.union([nextSchema, z.object({ rel: z.string() })])).default([]),
});
const bestSchema = z.object({
    features: z.array(
        z.object({
            id: z.string().regex(/^L[A-Z]\d{2}_/),
            properties: z.object({ datetime: z.string(), 'eo:cloud_cover': z.number() }),
            assets: z.object({ rendered_preview: z.object({ href: z.string() }).optional() }),
        }),
    ),
});

export interface CensusPreview {
    readonly decade: number;
    readonly id: string;
    /** `YYYY-MM-DD`. */
    readonly date: string;
    /** Landsat's mission number (1 to 9). */
    readonly mission: number;
    readonly cloud: number;
    /** The catalogue's own preview (on `CENSUS_ORIGIN`), or null. */
    readonly image: string | null;
}

export interface ImageryCensus {
    /** Landsat scenes under the cloud cap: exact, unless `landsatMore` (the count stopped at the pages read). */
    readonly landsat: number;
    readonly landsatMore: boolean;
    readonly declassifiedFree: CountRange;
    readonly declassifiedPaid: CountRange;
    readonly free: CountRange;
    readonly total: CountRange;
    readonly scanUsd: number;
    readonly orderFeeUsd: number;
    /** The best scene of each decade that has one, oldest first. */
    readonly previews: readonly CensusPreview[];
}

/** Why the search failed: no answer (offline, blocked), a refusal (the catalogue's error), or an answer the app cannot read. */
export type CensusFailure = 'offline' | 'refused' | 'unreadable';
export class CensusError extends Error {
    constructor(readonly reason: CensusFailure) {
        super(`imagery census: ${reason}`);
        this.name = 'CensusError';
    }
}

export type CensusFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

async function send(fetcher: CensusFetch, body: unknown, signal?: AbortSignal): Promise<Awaited<ReturnType<CensusFetch>>> {
    try {
        return await fetcher(CENSUS_SEARCH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            ...(signal === undefined ? {} : { signal }),
        });
    } catch (error) {
        throw signal?.aborted === true ? error : new CensusError('offline');
    }
}

async function post(fetcher: CensusFetch, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await send(fetcher, body, signal);
    if (!response.ok) {
        throw new CensusError('refused');
    }
    return response.json().catch(() => {
        throw new CensusError('unreadable');
    });
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new CensusError('unreadable');
    }
    return result.data;
}

const cloudQuery = { 'eo:cloud_cover': { lt: CENSUS_MAX_CLOUD } };

/** An era's last day as STAC's interval end (`..`: open). */
const eraEnd = (to: string): string => (to === '..' ? to : `${to}T23:59:59Z`);

async function countEra(fetcher: CensusFetch, box: CensusBox, era: (typeof ERAS)[number], signal?: AbortSignal) {
    let body: Record<string, unknown> = {
        collections: [era.collection],
        bbox: box,
        datetime: `${era.from}T00:00:00Z/${eraEnd(era.to)}`,
        limit: PAGE_SIZE,
        query: cloudQuery,
        fields: { include: ['id'], exclude: ['assets', 'links', 'geometry', 'properties'] },
    };
    let count = 0;
    for (let page = 0; page < CENSUS_MAX_PAGES; page += 1) {
        const answer = parsed(pageSchema, await post(fetcher, body, signal));
        count += answer.features.length;
        const next = answer.links.find((link): link is z.infer<typeof nextSchema> => link.rel === 'next' && 'body' in link);
        if (next === undefined || answer.features.length === 0) {
            return { count, more: false };
        }
        body = next.body;
    }
    return { count, more: true };
}

function decadeEra(decade: number): (typeof ERAS)[number] {
    return decade < 1980 ? ERAS[0] : ERAS[1];
}

/** A preview only from the catalogue's own host: an address elsewhere is dropped, never shown. */
function previewOf(href: string | undefined): string | null {
    return href?.startsWith(`${CENSUS_ORIGIN}/`) === true ? href : null;
}

async function bestOf(fetcher: CensusFetch, box: CensusBox, decade: number, signal?: AbortSignal): Promise<CensusPreview | null> {
    const body = {
        collections: [decadeEra(decade).collection],
        bbox: box,
        datetime: `${String(decade)}-01-01T00:00:00Z/${String(decade + 9)}-12-31T23:59:59Z`,
        limit: 1,
        query: cloudQuery,
        sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    };
    const [feature] = parsed(bestSchema, await post(fetcher, body, signal)).features;
    if (feature === undefined) {
        return null;
    }
    return {
        decade,
        id: feature.id,
        date: feature.properties.datetime.slice(0, 10),
        mission: Number(feature.id.slice(2, 4)),
        cloud: Math.round(feature.properties['eo:cloud_cover']),
        image: previewOf(feature.assets.rendered_preview?.href),
    };
}

const plus = (a: CountRange, b: number): CountRange => ({ low: a.low + b, high: a.high + b });

/** The census of `box`: Landsat counted and previewed per decade, the declassified frames estimated. */
export async function imageryCensus(fetcher: CensusFetch, box: CensusBox, signal?: AbortSignal): Promise<ImageryCensus> {
    const [eras, previews] = await Promise.all([
        Promise.all(ERAS.map((era) => countEra(fetcher, box, era, signal))),
        Promise.all(CENSUS_DECADES.map((decade) => bestOf(fetcher, box, decade, signal))),
    ]);
    const landsat = eras.reduce((sum, era) => sum + era.count, 0);
    const free = plus(DECLASSIFIED_SCANNED, landsat);
    return {
        landsat,
        landsatMore: eras.some((era) => era.more),
        declassifiedFree: DECLASSIFIED_SCANNED,
        declassifiedPaid: DECLASSIFIED_TO_SCAN,
        free,
        total: { low: free.low + DECLASSIFIED_TO_SCAN.low, high: free.high + DECLASSIFIED_TO_SCAN.high },
        scanUsd: USGS_SCAN_PRICE_USD,
        orderFeeUsd: USGS_ORDER_FEE_USD,
        previews: previews.filter((preview): preview is CensusPreview => preview !== null),
    };
}
