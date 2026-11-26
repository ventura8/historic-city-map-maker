/**
 * What only the `e2e` build of the admin carries (CR-M2c-7): the OAuth stand-in, a test's own city, its map token and the
 * switch for the Imagery area's automatic search. `E2E_KIT` is null in production: the mode is a constant for the bundler.
 */
import { CITY_ID_PATTERN } from '@hcm/shared';

import { createStandInPopup } from '../auth/stand-in.js';

/** What only the `e2e` build carries: the OAuth stand-in and the per-test city; the Firebase emulators come with it. */
export interface E2eKit {
    readonly standInPopup: typeof createStandInPopup;
    /** The address's `?city=` (a test's own city, CR-M2c-7), or null. */
    readonly city: (search: string) => string | null;
    /**
     * The address's `?mapToken=`: the admin map's token for that city, so it needs no `setup/status` (CR-M2c-7); `none` (or
     * anything that is not a public token) is no token at all; undefined without the parameter (the token of `setup/status`).
     */
    readonly mapToken: (search: string) => string | null | undefined;
    /**
     * Whether the Imagery area may search USGS by itself on opening: not for a test's own city (`?city=`), whose test does
     * not own `setup/status`, which the server's search checks and the locked specs rewrite (lesson 823).
     */
    readonly autoSearch: (search: string) => boolean;
}

/** The `?city=` of the `e2e` build's address: a valid city id, else null (the project's first city). */
export function e2eCity(search: string): string | null {
    const city = new URLSearchParams(search).get('city');
    return city !== null && CITY_ID_PATTERN.test(city) ? city : null;
}

/**
 * The `?mapToken=` of the `e2e` build's address: a Mapbox public token (`pk.`); null for any other value (`none`: the test's
 * city has no map); undefined without the parameter (the admin map reads `setup/status`, as in production).
 */
export function e2eMapToken(search: string): string | null | undefined {
    const token = new URLSearchParams(search).get('mapToken');
    if (token === null) {
        return undefined;
    }
    return /^pk\.[A-Za-z0-9._-]{1,200}$/.test(token) ? token : null;
}

/** The Imagery area's automatic search in the `e2e` build: off for a test's own city (`?city=`), on otherwise. */
export function e2eAutoSearch(search: string): boolean {
    return e2eCity(search) === null;
}

/**
 * The kit of the `e2e` build, null in production: the mode is a constant for the bundler, so the production bundle
 * carries no stand-in, no city override, no map token and no switch for the automatic search.
 */
export const E2E_KIT: E2eKit | null =
    import.meta.env.MODE === 'e2e'
        ? { standInPopup: createStandInPopup, city: e2eCity, mapToken: e2eMapToken, autoSearch: e2eAutoSearch }
        : null;
