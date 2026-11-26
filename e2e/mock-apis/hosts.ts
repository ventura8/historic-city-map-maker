import { SERVER_ONLY_HOSTS, upstreamHosts } from '@hcm/test-support/fakes';

import { E2E_TELEMETRY_HOST, E2E_TILE_HOST } from '../fixtures/world.js';

/**
 * Which hosts the e2e browser may reach, and how (docs/research/design-review-testability.md §4.2):
 *
 * - loopback (`127.0.0.1`, `localhost`): the site server and the mock APIs themselves;
 * - the mocked hosts below: every request is forwarded to the mock APIs, recorded, and answered there (M29: the public
 *   Landsat catalogue of the imagery census, catalogue.ts);
 * - in the admin projects only, also the hosts of the fake upstreams (`upstreamHosts()` of `@hcm/test-support/fakes`:
 *   Google Cloud's REST APIs and OAuth tokeninfo, Mapbox; CR-M2-21), which the admin calls from the browser (PLAN
 *   Addendum 1); a viewer page that reached one of them is still blocked;
 * - never, in any project: the hosts only servers call (`SERVER_ONLY_HOSTS`: USGS, the STAC catalogue and its COGs,
 *   Overpass, and since M4 Nominatim, Vertex AI and FCM, which only the functions' assists and notifications reach; the
 *   Functions emulator and the pipeline reach their fakes), an OpenStreetMap tile server, and Mapbox
 *   Satellite (never a georeferencing reference, docs/research/M3-interfaces.md §5.5, §13): `refusedAddress` names them;
 * - anything else (Firestore, real Google, an unknown CDN): aborted by the firewall, and the test fails.
 */

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export type HostKind = 'mapbox' | 'mapbox-events' | 'analytics' | 'cdn' | 'tiles' | 'telemetry' | 'catalogue';

/** Exact hosts, then suffixes (`.google-analytics.com` covers `region1.google-analytics.com`). */
const EXACT: ReadonlyMap<string, HostKind> = new Map<string, HostKind>([
    ['api.mapbox.com', 'mapbox'],
    ['events.mapbox.com', 'mapbox-events'],
    ['www.googletagmanager.com', 'analytics'],
    ['firebase.googleapis.com', 'analytics'],
    ['firebaseinstallations.googleapis.com', 'analytics'],
    ['firebaselogging.googleapis.com', 'analytics'],
    ['firebaselogging-pa.googleapis.com', 'analytics'],
    ['firebaseremoteconfig.googleapis.com', 'analytics'],
    ['cdn.jsdelivr.net', 'cdn'],
    [E2E_TILE_HOST, 'tiles'],
    [E2E_TELEMETRY_HOST, 'telemetry'],
    // M29: the public Landsat catalogue of the imagery census (catalogue.ts).
    ['planetarycomputer.microsoft.com', 'catalogue'],
]);

const SUFFIXES: readonly (readonly [string, HostKind])[] = [
    ['.tiles.mapbox.com', 'mapbox'],
    ['.google-analytics.com', 'analytics'],
    ['.analytics.google.com', 'analytics'],
    ['.googletagmanager.com', 'analytics'],
];

/** How the mock APIs answer `host`, or null when the host is not mocked (the firewall blocks it). */
export function mockedHostKind(host: string): HostKind | null {
    const name = host.toLowerCase();
    return EXACT.get(name) ?? SUFFIXES.find(([suffix]) => name.endsWith(suffix))?.[1] ?? null;
}

const BROWSER_UPSTREAM_HOSTS: ReadonlySet<string> = new Set(upstreamHosts().filter((host) => !SERVER_ONLY_HOSTS.includes(host)));

/** True when a fake upstream answers `host` for a browser (the admin projects forward it to the mock APIs). */
export function isUpstreamHost(host: string): boolean {
    return BROWSER_UPSTREAM_HOSTS.has(host.toLowerCase());
}

/** Mapbox Satellite's style and tilesets, on any Mapbox host (`mapbox://styles/mapbox/satellite-v9`, `mapbox.satellite`). */
const MAPBOX_SATELLITE = /^\/(?:styles\/v1\/mapbox\/satellite[\w-]*|v4\/mapbox\.satellite\b|raster\/v1\/mapbox\.satellite\b)/;
/** OpenStreetMap's tile servers: the admin and the viewer draw Mapbox basemaps only. */
const OSM_TILES = /(?:^|\.)tile\.openstreetmap\.org$/;

/** Why the firewall refuses `url` whatever the project (a reference the admin must never load), or null. */
export function refusedAddress(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    if (SERVER_ONLY_HOSTS.includes(host)) {
        return 'server-only upstream';
    }
    if (OSM_TILES.test(host)) {
        return 'OpenStreetMap tiles';
    }
    return mockedHostKind(host) === 'mapbox' && MAPBOX_SATELLITE.test(url.pathname) ? 'Mapbox Satellite' : null;
}

export function isLoopback(host: string): boolean {
    return LOOPBACK_HOSTS.includes(host);
}
