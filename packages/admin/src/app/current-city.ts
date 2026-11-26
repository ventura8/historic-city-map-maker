/**
 * Which city the admin opens (`docs/research/M5-interfaces.md` §1.5; S-A49-*): one city per page load, decided once
 * `admin.session` lists the admin's cities. The address's city when the admin administers it, else the `e2e` build's own
 * city (`?city=`, CR-M2c-7), else the city chosen last in this browser (`localStorage`, a convenience that may be
 * missing), else the first by name in the admin's language; an address naming a city the admin does not administer
 * opens the current one (the navigation says so: `adminShell.city.notMember`). Switching is a page
 * load (`switchTo`): every area, listener and draft belongs to one city, and a reload is the one way that cannot leave a
 * listener of the previous city behind.
 */
import type { UiLocale, Logger, SessionResponse } from '@hcm/shared';

import type { CallablesPort } from '../firebase/ports.js';
import { RETURN_TO_KEY } from '../routing/router.js';
import { adminRouteHash, parseAdminRoute, type AdminRoute } from '../routing/routes.js';
import type { AdminCity, ShellState, ShellStateAccess } from '../state/state.js';
import type { Clock, HashLocation, KeyValueStore } from './ports.js';

/** `localStorage`: the city an admin chose last in this browser, per account (`hcm:admin:city:<uid>`). */
const CITY_MEMORY_PREFIX = 'hcm:admin:city:';

export function cityMemoryKey(uid: string): string {
    return `${CITY_MEMORY_PREFIX}${uid}`;
}

/** A city's name in `locale` (its Romanian name when it has no English one). */
export function cityName(city: Pick<AdminCity, 'name'>, locale: UiLocale): string {
    return locale === 'en' ? (city.name.en ?? city.name.ro) : city.name.ro;
}

/** The cities by name in `locale`, then by id. */
export function sortedCities(cities: readonly AdminCity[], locale: UiLocale): AdminCity[] {
    return [...cities].sort((a, b) => cityName(a, locale).localeCompare(cityName(b, locale), locale) || a.id.localeCompare(b.id));
}

export interface CityChoiceDeps {
    readonly location: HashLocation;
    /** `sessionStorage`: the address kept while signed out (`RETURN_TO_KEY`) names the city a deep link asked for. */
    readonly session: KeyValueStore;
    readonly local: KeyValueStore;
    /** The `e2e` build's own city (`?city=`), or null. */
    readonly preferred: string | null;
    readonly uid: () => string | null;
    readonly locale: () => UiLocale;
}

/** What the session decides of the shell: the cities, the current one and the project role. */
export type CityChoice = Pick<ShellState, 'cities' | 'cityId' | 'projectOwner'>;

/** The city the address (or the deep link kept while signed out) names, or null. */
function askedCity(deps: CityChoiceDeps): string | null {
    return parseAdminRoute(deps.session.get(RETURN_TO_KEY) ?? deps.location.hash())?.cityId ?? null;
}

function rememberedCity(deps: CityChoiceDeps): string | null {
    const uid = deps.uid();
    return uid === null ? null : deps.local.get(cityMemoryKey(uid));
}

/** The first of `candidates` the admin administers, else the first city by name, else null. */
function firstMember(cities: readonly AdminCity[], candidates: readonly (string | null)[]): string | null {
    const member = candidates.find((candidate) => candidate !== null && cities.some((city) => city.id === candidate));
    return member ?? cities[0]?.id ?? null;
}

/** The shell's cities and current city once `admin.session` answered; the current city is remembered in this browser. */
export function chooseCity(session: Pick<SessionResponse, 'cities' | 'projectOwner'>, deps: CityChoiceDeps): CityChoice {
    const locale = deps.locale();
    const cities = sortedCities(session.cities, locale);
    const cityId = firstMember(cities, [askedCity(deps), deps.preferred, rememberedCity(deps)]);
    remember(deps, cityId);
    return { cities, cityId, projectOwner: session.projectOwner };
}

function remember(deps: CityChoiceDeps, cityId: string | null): void {
    const uid = deps.uid();
    if (uid !== null && cityId !== null) {
        deps.local.set(cityMemoryKey(uid), cityId);
    }
}

/** A city to open, and its page (Home unless given). */
export interface CityChange {
    readonly uid: string | null;
    readonly cityId: string;
    readonly route?: AdminRoute | undefined;
}

/** Opens `cityId` with a page load at its page (`#/c/<city>/home` by default), remembering it for this account. */
export function switchTo(location: HashLocation, local: KeyValueStore, change: CityChange): void {
    if (change.uid !== null) {
        local.set(cityMemoryKey(change.uid), change.cityId);
    }
    const route = change.route ?? { id: 'home', params: [] };
    location.setHash(adminRouteHash({ id: route.id, params: route.params, cityId: change.cityId }), false);
    location.reload();
}

/** The city menu asks the server for the admin's cities at most this often. */
export const CITIES_REFRESH_MS = 60_000;

export interface CityRefreshDeps {
    readonly callables: CallablesPort;
    readonly shell: ShellStateAccess;
    readonly clock: Clock;
    readonly log: Logger;
}

/**
 * The city menu's refresh (S-A49-HAPPY): `admin.session` again, at most once a minute, so a city the admin was just added
 * to (or invited to, accepted by the session) appears without a reload; the open city does not change. `immediately`
 * skips the minute: New city's Create (S-A50-HAPPY-LISTED, `docs/LESSONS.md` 251).
 */
export function cityRefresher(deps: CityRefreshDeps): (immediately?: boolean) => Promise<void> {
    let last = Number.NEGATIVE_INFINITY;
    return async (immediately = false) => {
        const now = deps.clock.now();
        if (!immediately && now - last < CITIES_REFRESH_MS) {
            return;
        }
        last = now;
        try {
            const session = await deps.callables.call('admin.session', {});
            deps.shell.update({ cities: sortedCities(session.cities, deps.shell.get().locale), projectOwner: session.projectOwner });
        } catch (error) {
            deps.log.warn('the cities could not be asked again', { error: String(error) });
        }
    };
}
