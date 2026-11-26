/**
 * The admin's hash routes (`docs/research/M2b-interfaces.md` §1.1): `#/<route>` plus at most two id segments
 * (`#/photos/<photoId>`, `#/history/<entity>/<id>`, `#/setup/<step>`). Hash routing needs no Hosting rewrite and keeps
 * every address on the one `index.html`. `#/home` is the dashboard the M2c editors added (`docs/research/M2c-interfaces.md`
 * CR-M2c-24); `#/imagery` and `#/georef/<versionId>` are M3's (`docs/research/M3-interfaces.md` §10.1, CR-M3-9);
 * `#/inbox` is M4's (`docs/research/M4-interfaces.md` §5.5). M5 (`docs/research/M5-interfaces.md` §1.5): an optional
 * `#/c/<city>/` prefix names the city of a city page (`#/c/cluj/photos/abc`), and `#/cities/new` is the New city flow.
 */
import { ADMIN_CITY_SEGMENT, CITY_ID_PATTERN } from '@hcm/shared';

export const ADMIN_ROUTES = [
    'home',
    'setup',
    'photos',
    'pois',
    /** M17 (`docs/research/M17-stories.md` §6): the city's stories, after Places. */
    'stories',
    'layers',
    'imagery',
    'jobs',
    'inbox',
    'settings',
    'admins',
    'history',
    'crashes',
    'georef',
    /** The tile-import wizard (`#/help/<versionId>/tiles`, docs/research/M20-import-local.md §19.11): from a series' page. */
    'help',
    'cities',
    /** M13 (`docs/research/M13-roles.md` §8): the review queue. */
    'review',
    /** M13: the Contribute page (`#/contribute/<city>/<photoId>`), from the public map, for any signed-in account. */
    'contribute',
] as const;

export type AdminRouteId = (typeof ADMIN_ROUTES)[number];

export interface AdminRouteSpec {
    /** The navigation icon (a Material Symbols name the admin's icon subset bundles). */
    readonly icon: string;
    /** False only for Setup: every other page reads Firestore or calls a function, so it waits for the server. */
    readonly needsBackend: boolean;
    /** One of the four destinations of the compact navigation bar while Setup is not complete; the rest sit under "More". */
    readonly inCompactBar: boolean;
    /**
     * One of the four once Setup is complete: the dashboard takes Setup's place, Setup moves under "More"
     * (`DECISIONS-for-review.md` §34i).
     */
    readonly inCompactBarOnceSetUp: boolean;
    /** False for a page reached only from another (the georeferencer, from a version): never a navigation destination. */
    readonly inNavigation?: false;
    /**
     * M5: `city` pages show and edit the current city (their address may name it, `#/c/<city>/...`); `project` pages are
     * the project's (Setup, the crash reports, the inbox, New city), whatever city is open.
     */
    readonly scope: 'city' | 'project';
}

export const ADMIN_ROUTE_SPECS: Readonly<Record<AdminRouteId, AdminRouteSpec>> = {
    /**
     * The dashboard (M2c, ops-screens): the first screen once Setup is complete, and then on the compact bar in Setup's
     * place (`DECISIONS-for-review.md` §34i); under More before.
     */
    home: { icon: 'home', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: true, scope: 'city' },
    setup: { icon: 'checklist', needsBackend: false, inCompactBar: true, inCompactBarOnceSetUp: false, scope: 'project' },
    photos: { icon: 'photo_library', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true, scope: 'city' },
    pois: { icon: 'place', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true, scope: 'city' },
    stories: { icon: 'museum', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    layers: { icon: 'layers', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true, scope: 'city' },
    /** M3's Imagery area: after Layers in the rail, under More on the compact bar (`docs/research/M3-interfaces.md` §10.1). */
    imagery: { icon: 'satellite_alt', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    jobs: { icon: 'pending_actions', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    /** M4's inbox (`docs/research/M4-interfaces.md` §5.5): after Jobs in the rail, under More on the compact bar. */
    inbox: { icon: 'notifications', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'project' },
    settings: { icon: 'settings', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    admins: { icon: 'group', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    history: { icon: 'history', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    crashes: { icon: 'bug_report', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'project' },
    /** The georeferencer: opened from a version or a layer (`#/georef/<versionId>`), never from the navigation. */
    georef: {
        icon: 'add_location_alt',
        needsBackend: true,
        inCompactBar: false,
        inCompactBarOnceSetUp: false,
        inNavigation: false,
        scope: 'city',
    },
    /** The tile-import wizard: opened from an archive series waiting with `layout-check`, never from the navigation. */
    help: {
        icon: 'crop_free',
        needsBackend: true,
        inCompactBar: false,
        inCompactBarOnceSetUp: false,
        inNavigation: false,
        scope: 'city',
    },
    /** M5's New city flow (`#/cities/new`): opened from the city menu by the project's owner, never from the navigation. */
    review: { icon: 'approval', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, scope: 'city' },
    contribute: {
        icon: 'add_photo_alternate',
        needsBackend: true,
        inCompactBar: false,
        inCompactBarOnceSetUp: false,
        inNavigation: false,
        scope: 'project',
    },
    cities: {
        icon: 'add_location_alt',
        needsBackend: true,
        inCompactBar: false,
        inCompactBarOnceSetUp: false,
        inNavigation: false,
        scope: 'project',
    },
};

/**
 * M13 (`docs/research/M13-roles.md` §8): the pages each limited standing opens, in the navigation's order. The rules deny the
 * data anyway; this keeps a moderator or an uploader away from screens that could only fail. Staff open every route.
 */
const LIMITED_ROUTES: Readonly<Record<'uploader' | 'moderator' | 'visitor', readonly AdminRouteId[]>> = {
    uploader: ['photos', 'pois', 'stories', 'inbox', 'contribute'],
    moderator: ['photos', 'pois', 'stories', 'review', 'inbox', 'contribute'],
    visitor: ['contribute'],
};

/** Who the shell shows pages to: staff (the default), a limited role of the open city, or a visitor of the Contribute page. */
export type RouteStanding = 'staff' | keyof typeof LIMITED_ROUTES;

export function routeAllowed(id: AdminRouteId, standing: RouteStanding): boolean {
    return standing === 'staff' || LIMITED_ROUTES[standing].includes(id);
}

/** Where a limited standing lands when its address opens nothing it may see. */
export function firstAllowedRoute(standing: Exclude<RouteStanding, 'staff'>): AdminRoute {
    return { id: LIMITED_ROUTES[standing][0] ?? 'contribute', params: [] };
}

export interface AdminRoute {
    readonly id: AdminRouteId;
    /** The id segments after the route, each `^[A-Za-z0-9_-]{1,64}$`; at most two. */
    readonly params: readonly string[];
    /** M5: the city the address names (`#/c/<city>/...`); absent, the current city. */
    readonly cityId?: string;
}

/** Where an unknown or malformed address lands, and an empty one before Setup is complete. */
export const DEFAULT_ADMIN_ROUTE: AdminRoute = { id: 'setup', params: [] };

/** Where an empty address lands once Setup is complete (`DECISIONS-for-review.md` §34i). */
export const SET_UP_ADMIN_ROUTE: AdminRoute = { id: 'home', params: [] };

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PARAMS = 2;

function isRouteId(value: string): value is AdminRouteId {
    return (ADMIN_ROUTES as readonly string[]).includes(value);
}

/** A route's segments without the address's city prefix, and that city (null: no prefix; undefined: a malformed one). */
function withoutCity(segments: readonly string[]): { readonly segments: readonly string[]; readonly cityId: string | null | undefined } {
    if (segments[0] !== ADMIN_CITY_SEGMENT) {
        return { segments, cityId: null };
    }
    const cityId = segments[1] ?? '';
    return { segments: segments.slice(2), cityId: CITY_ID_PATTERN.test(cityId) ? cityId : undefined };
}

/**
 * Reads `#/photos/abc` as `{id: 'photos', params: ['abc']}` and `#/c/cluj/photos` as `{id: 'photos', params: [],
 * cityId: 'cluj'}`; null for anything that is not exactly a known route (a malformed city among them).
 */
export function parseAdminRoute(hash: string): AdminRoute | null {
    const { segments, cityId } = withoutCity(hash.replace(/^#\/?/, '').split('/'));
    const [first = '', ...params] = segments;
    if (cityId === undefined || !isRoute(first, params)) {
        return null;
    }
    return cityId === null ? { id: first, params } : { id: first, params, cityId };
}

/** A known route with at most two well-formed id segments. */
function isRoute(first: string, params: readonly string[]): first is AdminRouteId {
    return isRouteId(first) && params.length <= MAX_PARAMS && params.every((param) => SEGMENT.test(param));
}

/** The address of a route, the inverse of `parseAdminRoute`. */
export function adminRouteHash(route: AdminRoute): string {
    const city = route.cityId === undefined ? [] : [ADMIN_CITY_SEGMENT, route.cityId];
    return ['#', ...city, route.id, ...route.params].join('/');
}
