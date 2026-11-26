/**
 * The Contribute page's welcome (M13, `docs/research/M13-roles.md` §3): a public visitor who opens `#/contribute/<city>` from the
 * map while signed out is welcomed as a contributor, never shown the admin's sign-in. The map's menu link names the language
 * (`?lang=`) and the city's name in it (`name`): the admin cannot read the city before sign-in (the rules let only its
 * members read it), so the name comes from the link and is shown as text. The way back is the city's map on the admin's
 * own Hosting (`docs/research/M6-interfaces.md` §2.4): the project's first city at `/`, every other at `/<city>/`.
 */
import { DEFAULT_LOCALE, isUiLocale, type UiLocale } from '@hcm/shared';

import { parseAdminRoute } from '../routing/routes.js';
import { LANGUAGE_KEY, resolveAdminLocale } from '../state/locale.js';
import type { HashLocation, KeyValueStore, Unsubscribe } from './ports.js';

export interface ContributorWelcome {
    /** The city the address names (`#/contribute/<city>`), or null. */
    readonly cityId: string | null;
    /** The city's name as the map's link gave it, or null (the title then names no city). */
    readonly cityName: string | null;
    /** Where "Back to the map" goes. */
    readonly mapUrl: string;
}

type WelcomeLocation = Pick<HashLocation, 'hash' | 'search' | 'page'>;

/** A name longer than this is cut: it comes from a link anyone may write. */
const NAME_MAX = 80;

function nameOf(value: string | null): string | null {
    const name = (value ?? '').replace(/\p{Cc}/gu, '').trim();
    return name === '' ? null : name.slice(0, NAME_MAX);
}

/** The city's public map on the admin's Hosting: the root for the project's first city (or none named), else `/<city>/`. */
function mapUrlOf(cityId: string | null, firstCity: string | null, page: string): string {
    const root = `${new URL(page).origin}/`;
    return cityId === null || cityId === firstCity ? root : `${root}${cityId}/`;
}

/** The welcome of the address now (`firstCity`: the project's first city), null unless it is the Contribute page. */
export function contributorWelcome(location: WelcomeLocation, firstCity: string | null): ContributorWelcome | null {
    const route = parseAdminRoute(location.hash());
    if (route?.id !== 'contribute') {
        return null;
    }
    const cityId = route.params[0] ?? null;
    const cityName = nameOf(new URLSearchParams(location.search()).get('name'));
    return { cityId, cityName, mapUrl: mapUrlOf(cityId, firstCity, location.page()) };
}

/** Keeps `welcome` on the address (`cities`: the project's, the first at the Hosting root): another link may open in the tab. */
export function followWelcome(
    location: HashLocation,
    cities: readonly string[],
    update: (welcome: ContributorWelcome | null) => void,
): Unsubscribe {
    const firstCity = cities[0] ?? null;
    return location.onHashChange(() => {
        update(contributorWelcome(location, firstCity));
    });
}

function localeOf(value: string | null): UiLocale | null {
    return isUiLocale(value) ? value : null;
}

/**
 * The admin's first language. On the Contribute page's address it is the map's: the link's `?lang=`, else the language the
 * visitor chose on that city's map (the viewer's `hcm:<city>:lang`, on the same origin: a photo's link carries no
 * language), else the admin's own choice, else the map's Romanian. Anywhere else, `resolveAdminLocale`'s order.
 */
export function startLocale(location: Pick<HashLocation, 'hash' | 'search'>, local: KeyValueStore, languages: readonly string[]): UiLocale {
    const route = parseAdminRoute(location.hash());
    if (route?.id !== 'contribute') {
        return resolveAdminLocale(location.search(), local.get(LANGUAGE_KEY), languages);
    }
    return contributorLocale(route.params[0] ?? '', location.search(), local);
}

function contributorLocale(cityId: string, search: string, local: KeyValueStore): UiLocale {
    const asked = localeOf(new URLSearchParams(search).get('lang'));
    return asked ?? localeOf(local.get(`hcm:${cityId}:lang`)) ?? localeOf(local.get(LANGUAGE_KEY)) ?? DEFAULT_LOCALE;
}
