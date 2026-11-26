/**
 * A city's id and rectangle, checked without any schema: what the start page (`docs/research/M14-start-your-map.md`) and the
 * New city flow share. Apart from `cities.ts`, whose imports (the API's limits, the Firestore stamps) bring every Firestore
 * schema and the API catalogue into a bundle (docs/LESSONS.md 593); `cities.ts` re-exports all of it.
 */
import { slugify, truncateSlug } from '../migration/slug.js';
import { CITY_ID_PATTERN } from './primitives.js';

/** The longest city id (`CITY_ID_PATTERN`: it names Storage folders and the public site's path). */
export const MAX_CITY_ID_LENGTH = 32;

/**
 * Ids no city may take: the folders of a public site, the starter kit and the export (`engine/`, `photos/`, ...) and
 * the admin's own words, so `/<city>/` on GitHub Pages and on Firebase Hosting and `#/c/<city>/` in the admin never collide
 * with them. M6 (`docs/research/M6-interfaces.md` §2.1, hosting): `city`, the folder of the Hosting site's generic city page
 * (`/city/`), which every other city's address is rewritten to; `admin` is the admin's folder there.
 */
export const RESERVED_CITY_IDS = [
    'admin',
    'api',
    'assets',
    'cdn',
    'cities',
    'city',
    'data',
    'engine',
    'export',
    'fonts',
    'legacy',
    'media',
    'new',
    'photos',
    'rasters',
    'starter-kit',
    'templates',
] as const;

/** A well-formed id that is not reserved. */
export function isUsableCityId(cityId: string): boolean {
    return CITY_ID_PATTERN.test(cityId) && !(RESERVED_CITY_IDS as readonly string[]).includes(cityId);
}

function unavailable(cityId: string, taken: ReadonlySet<string>): boolean {
    return taken.has(cityId) || !isUsableCityId(cityId);
}

/**
 * The id the New city flow suggests for a name (`Cluj-Napoca` → `cluj-napoca`, `Bacău` → `bacau`): the slug cut to
 * `MAX_CITY_ID_LENGTH` at a word boundary, `my-city` when the name has no letter or digit (`city` is reserved since M6),
 * then `-2`, `-3`, ... while it is taken or reserved.
 */
/** The suggestion for a name without a letter or a digit. */
const FALLBACK_CITY_ID = 'my-city';

export function suggestCityId(name: string, taken: readonly string[] = []): string {
    const used = new Set(taken);
    const slug = truncateSlug(slugify(name), MAX_CITY_ID_LENGTH);
    const root = slug.length >= 2 ? slug : FALLBACK_CITY_ID;
    let id = root;
    let suffix = 1;
    while (unavailable(id, used)) {
        suffix += 1;
        id = `${truncateSlug(root, MAX_CITY_ID_LENGTH - String(suffix).length - 1)}-${String(suffix)}`;
    }
    return id;
}

/** A city's rectangle: at least this many degrees on its shorter side, at most this many on its longer one. */
export const CITY_SPAN_LIMITS = { minDeg: 0.01, maxDeg: 2 } as const;

/** `{west, south, east, north}` in degrees, as the city document stores it. */
export interface CityBounds {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

/** Why a drawn rectangle cannot be a city (`validation.bounds`, `.tooSmall`, `.tooBig`), or null when it can. */
export function cityBoundsProblem(bounds: CityBounds): 'validation.bounds' | 'validation.tooSmall' | 'validation.tooBig' | null {
    const width = bounds.east - bounds.west;
    const height = bounds.north - bounds.south;
    if (!(width > 0 && height > 0)) {
        return 'validation.bounds';
    }
    if (Math.min(width, height) < CITY_SPAN_LIMITS.minDeg) {
        return 'validation.tooSmall';
    }
    return Math.max(width, height) > CITY_SPAN_LIMITS.maxDeg ? 'validation.tooBig' : null;
}
