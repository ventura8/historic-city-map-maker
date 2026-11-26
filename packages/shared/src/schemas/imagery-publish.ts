/**
 * Publishing a layer version to Mapbox MTS (`docs/research/M3-interfaces.md` §7): the deterministic tileset and source
 * ids (a retry never makes a second tileset), the raster recipe, the compute-unit estimate and the guard's verdict
 * against the month's counter `usage/mapbox-YYYY-MM` (security review §3.3). Pure functions: the publisher
 * (`functions/src/imagery/`) runs them, the admin's approval card shows the same numbers.
 *
 * **UNVERIFIED** (no Mapbox account may be called from a test): the raster recipe's exact shape, the processing
 * precisions by zoom, and how many compute units a km² costs at each. The numbers here are conservative; each published
 * version records what Mapbox reported (`layerVersions.mapbox.precisions`), the calibration of the table.
 */
import type { MtsPrecision } from './imagery.js';

/** Compute units a month includes for free (security review §3.1; the guard's default budget). UNVERIFIED. */
export const MAPBOX_FREE_COMPUTE_UNITS = 20;

/** About what one compute unit beyond the free ones costs, for "Pay about $X". UNVERIFIED. */
export const USD_PER_COMPUTE_UNIT = 0.9;

/** At most this many published tilesets without the user's explicit approval (security review §3.3). */
export const MAX_TILESETS = 24;

/** Mapbox Studio's free upload takes a GeoTIFF of at most 300 MB. */
export const STUDIO_MAX_BYTES = 300 * 1000 * 1000;

/** km² one compute unit processes at each precision. UNVERIFIED (conservative; calibrated from `precisions`). */
export const KM2_PER_COMPUTE_UNIT: Readonly<Record<MtsPrecision, number>> = { '10m': 100_000, '1m': 1000, '30cm': 25, '1cm': 2.5 };

/** Mapbox's precision of a tileset whose tiles reach `maxzoom`. */
export function precisionOf(maxzoom: number): MtsPrecision {
    if (maxzoom <= 5) {
        return '10m';
    }
    if (maxzoom <= 10) {
        return '1m';
    }
    return maxzoom <= 16 ? '30cm' : '1cm';
}

/** The compute units publishing `areaKm2` up to `maxzoom` takes, rounded up to a tenth. */
export function estimateComputeUnits(areaKm2: number, maxzoom: number): number {
    return Math.ceil((Math.max(0, areaKm2) / KM2_PER_COMPUTE_UNIT[precisionOf(maxzoom)]) * 10) / 10;
}

/** `YYYY-MM` of a time, in UTC: the month of `usage/mapbox-YYYY-MM`. */
export function usageMonth(at: Date): string {
    return at.toISOString().slice(0, 7);
}

/** The first instant of the next month, UTC: when a deferred publish runs. */
export function nextMonthStart(at: Date): Date {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/**
 * What the guard reads of `usage/mapbox-YYYY-MM` (absent fields are zero; the budget defaults to the free units). The
 * optional members also take `undefined`, so a `UsageDoc` as read (`exactOptionalPropertyTypes`) is one (CR-M3-26).
 */
export interface UsageCounters {
    readonly computeUnits?: number | undefined;
    readonly computeUnitBudget?: number | undefined;
    readonly overageComputeUnits?: number | undefined;
    readonly reservations?: Readonly<Record<string, { readonly computeUnits: number }>> | undefined;
}

export interface GuardInput {
    /** This version's estimate. */
    readonly estimate: number;
    readonly usage: UsageCounters | undefined;
    /** The published tilesets of the Mapbox account the city uses (layers with `mapbox.tilesetId`, this one excluded). */
    readonly tilesets: number;
    /** The version itself holds a reservation already (a retried publish): it is not counted twice. */
    readonly versionId: string;
    /**
     * M5 (`docs/research/M5-interfaces.md` §1.8): what the version's city may still spend this month
     * (`cityComputeUnitsAvailable`); absent for a city without limits, which the project's month alone holds.
     */
    readonly cityAvailable?: number;
}

export interface GuardOutcome {
    readonly verdict: 'within' | 'over' | 'tileset-limit' | 'city-over';
    /** Compute units left before this publish. */
    readonly available: number;
    /** About what the overage costs, when over. */
    readonly overageUsd: number;
}

function reserved(usage: UsageCounters, versionId: string): number {
    return Object.entries(usage.reservations ?? {})
        .filter(([id]) => id !== versionId)
        .reduce((sum, [, held]) => sum + held.computeUnits, 0);
}

/** Compute units left this month: the budget plus any paid overage, minus what is spent and held by other publishes. */
export function availableComputeUnits(usage: UsageCounters | undefined, versionId: string): number {
    const counters = usage ?? {};
    const budget = (counters.computeUnitBudget ?? MAPBOX_FREE_COMPUTE_UNITS) + (counters.overageComputeUnits ?? 0);
    return budget - (counters.computeUnits ?? 0) - reserved(counters, versionId);
}

/**
 * The guard's verdict on publishing one version now: the tileset cap first, then the project's month, then (M5) the
 * city's share; `city-over` gives what the city has left as `available`.
 */
export function guardVerdict(input: GuardInput): GuardOutcome {
    const available = availableComputeUnits(input.usage, input.versionId);
    const overage = Math.max(0, input.estimate - available);
    const overageUsd = Math.round(overage * USD_PER_COMPUTE_UNIT * 100) / 100;
    if (input.tilesets >= MAX_TILESETS) {
        return { verdict: 'tileset-limit', available, overageUsd };
    }
    if (overage > 0) {
        return { verdict: 'over', available, overageUsd };
    }
    const cityAvailable = input.cityAvailable ?? Number.POSITIVE_INFINITY;
    return input.estimate > cityAvailable
        ? { verdict: 'city-over', available: cityAvailable, overageUsd: 0 }
        : { verdict: 'within', available, overageUsd };
}

/** Mapbox allows 32 characters in a tileset's (and a source's) own name. */
const MAPBOX_NAME_MAX = 32;
const HASH_SUFFIX = 9;

/** FNV-1a, 32 bits, as 8 hex digits: a short, stable hash both TypeScript and Python compute alike. */
export function fnv1a32(text: string): string {
    let hash = 0x81_1c_9d_c5;
    for (const byte of new TextEncoder().encode(text)) {
        hash = Math.imul(hash ^ byte, 0x01_00_01_93) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * The name of a layer's tileset and of its tileset source: `hcm-<city>-<layer>` in lowercase. A layer id with capitals
 * (ids allow them, Mapbox names do not) or a name past 32 characters keeps its first 23 characters and adds `-` and the
 * FNV-1a hash of `<city>/<layer>`, so two layers never share a tileset.
 */
export function tilesetName(cityId: string, layerId: string): string {
    const plain = `hcm-${cityId}-${layerId}`;
    if (plain.length <= MAPBOX_NAME_MAX && plain === plain.toLowerCase()) {
        return plain;
    }
    const hash = fnv1a32([cityId, layerId].join('/'));
    return `${plain.toLowerCase().slice(0, MAPBOX_NAME_MAX - HASH_SUFFIX)}-${hash}`;
}

/** `<user>.<name>`: the layer's tileset id at Mapbox. */
export function tilesetIdFor(user: string, cityId: string, layerId: string): string {
    return `${user}.${tilesetName(cityId, layerId)}`;
}

/** The MTS raster recipe of a layer: one source, its zoom range. UNVERIFIED shape (the fake checks exactly this). */
export function rasterRecipe(user: string, sourceId: string, minzoom: number, maxzoom: number) {
    return {
        version: 1,
        type: 'raster',
        sources: [{ uri: `mapbox://tileset-source/${user}/${sourceId}` }],
        minzoom,
        maxzoom,
    } as const;
}
