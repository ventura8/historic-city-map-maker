import { STORAGE_PATHS, publicObjectUrl, type EngineConfig } from '@hcm/shared';
import { MAP_GLYPH_PATH, MAP_ICON_GEOMETRY, followViewerTheme, paintTabIcon } from '@hcm/shared/tab-icon';

import { contentSecurityPolicy } from '../csp.js';
import type { SiteFileSystem } from '../files.js';
import { bucketOrigins } from '../origins.js';
import { ENGINE_FOLDER, renderSitePage } from '../page.js';
import { publicManifest } from '../public-manifest.js';
import type { SiteSpec } from '../site-spec.js';

/**
 * The Hosting site's generic city page (docs/research/M6-interfaces.md §2.4, behaviour V30): a city made in the admin
 * needs no repository step. Hosting rewrites every address that names a city id (`/bacau/`, `CITY_PATH_REGEX`) to
 * `/city/index.html` when no committed site has that folder; the page's `config.js` takes the city id from the address's
 * first segment, checks it with `CITY_ID_PATTERN` (inline: the script is self-contained; a test pins it to the shared one) and reads `cities/<id>/manifest.json` of the public bucket, which the
 * admin publishes. A city never published answers 404 there, and the viewer says its map was not found. The page's files
 * are absolute (`/engine/…`, `/city/config.js`, `/site.css`: the root site's engine and styles), since the browser's
 * address is the city's folder, not `/city/`.
 *
 * `configureCityPage` is the configuration's script, written like the admin's push service worker: typed and tested, its
 * source text the file, with the bucket's address parts as arguments (values of the build, never of the address).
 */

/** The page's folder on the Hosting site (a reserved city id: `RESERVED_CITY_IDS`). */
export const CITY_PAGE_FOLDER = 'city';

/** The addresses Hosting rewrites to the page: a city id, with or without its slash (`firebase.json` → `rewrites`). */
export const CITY_PATH_REGEX = '^/[a-z0-9-]{2,32}/?$';

/** What the script uses of the page's `window`. */
export interface CityConfigScope {
    readonly location: { readonly pathname: string };
    HistoricCityMapConfig?: unknown;
}

/**
 * Sets the engine's configuration from the address: the city id of its first segment (else `fallback`) and its
 * manifest in the public bucket, `before + id + after`. Self-contained: its source text is the page's `config.js`.
 */
export function configureCityPage(scope: CityConfigScope, before: string, after: string, fallback: string): void {
    const segment = scope.location.pathname.split('/')[1] ?? '';
    const cityId = /^[a-z0-9-]{2,32}$/.test(segment) ? segment : fallback;
    scope.HistoricCityMapConfig = { cityId, manifestUrl: `${before}${cityId}${after}` };
}

/** What the icon script uses of the page's `window`: its configuration, its document and `Image`. */
export interface CityIconScope {
    readonly HistoricCityMapConfig?: unknown;
    readonly document: {
        querySelectorAll(selector: string): ArrayLike<{ href: string; removeAttribute(name: string): void; remove(): void }>;
        createElement(tag: 'link'): { rel: string; href: string };
        readonly head: { append(node: { rel: string; href: string }): void };
    };
    readonly Image: new () => { onload: (() => void) | null; src: string };
    readonly fetch: (address: string) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;
}

/**
 * The city's own tab icon (`docs/ENGINE_API.md` → *The page's tab icon*), from the public bucket's folder of the city
 * (`before + id + /`, the files `cities.setIcon` and the manifest's build write). When the city's manifest says it has an
 * editor's uploaded icon (`city.ownIcon`: only then does `icon-own-32.png` exist, so a city on the default never asks
 * for a missing file, which the browser blocks as an opaque error), the tab shows it in every theme: the first icon link takes its
 * address and loses its `media`, the others go, and `paintTabIcon` leaves a link that is no `data:` address alone. A
 * phone's home screen gets the city's 180 px icon (`icon-180.png`: the upload, or the default in the city's colour) once
 * that has loaded. A city without either keeps the page's default. Self-contained, like `configureCityPage`, after
 * which it runs; it builds elements, never HTML.
 */
export function showCityIcon(scope: CityIconScope, before: string): void {
    const config = scope.HistoricCityMapConfig as { readonly cityId?: unknown } | undefined;
    const folder = `${before}${typeof config?.cityId === 'string' ? config.cityId : ''}/`;
    const whenLoaded = (address: string, show: () => void): void => {
        const probe = new scope.Image();
        probe.onload = show;
        probe.src = address;
    };
    const manifestUrl = (config as { readonly manifestUrl?: unknown } | undefined)?.manifestUrl;
    const showOwn = (): void => {
        Array.from(scope.document.querySelectorAll('link[rel="icon"]')).forEach((link, index) => {
            if (index > 0) {
                link.remove();
                return;
            }
            link.href = `${folder}icon-own-32.png`;
            link.removeAttribute('media');
        });
    };
    if (typeof manifestUrl === 'string') {
        scope
            .fetch(manifestUrl)
            .then(async (response) => (response.ok ? response.json() : undefined))
            .then((manifest) => {
                if ((manifest as { readonly city?: { readonly ownIcon?: unknown } } | undefined)?.city?.ownIcon === true) {
                    showOwn();
                }
            })
            .catch(() => undefined);
    }
    whenLoaded(`${folder}icon-180.png`, () => {
        const touch = scope.document.createElement('link');
        touch.rel = 'apple-touch-icon';
        touch.href = `${folder}icon-180.png`;
        scope.document.head.append(touch);
    });
}

/** The address of a city's folder in `bucket`, up to its id (the same address every site build names). */
function cityFolderPrefix(bucket: string): string {
    const marker = 'hcm-city-id';
    return publicObjectUrl(bucket, STORAGE_PATHS.manifest(marker)).split(marker)[0] ?? '';
}

/**
 * The lines a viewer page's `config.js` ends with (`docs/ENGINE_API.md` → *The page's tab icon*): the default icon
 * follows the theme the visitor chose (`followViewerTheme`, `paintTabIcon` of `@hcm/shared`), and a page that reads
 * `bucket` shows its city's own uploaded icon instead once it has loaded. Throws RangeError on a name no bucket has.
 */
export function tabIconSource(bucket: string | undefined): string {
    const glyph = JSON.stringify({ path: MAP_GLYPH_PATH, ...MAP_ICON_GEOMETRY });
    const own = bucket === undefined ? [] : [`(${showCityIcon.toString()})(window, ${JSON.stringify(cityFolderPrefix(bucket))});`];
    return [
        "// The tab icon (docs/ENGINE_API.md → The page's tab icon), from scripts/site/src/hosting/city-page.ts.",
        `(${followViewerTheme.toString()})(window, ${paintTabIcon.toString()}, ${glyph});`,
        ...own,
        '',
    ].join('\n');
}

function cityPageSpec(themeColor: string): SiteSpec {
    return {
        lang: 'ro',
        title: 'Hartă istorică',
        description: 'Fotografii vechi și straturi istorice ale orașului, așezate pe harta de azi.',
        themeColor,
        noscript: {
            ro: 'Harta are nevoie de JavaScript. Activează JavaScript în browser ca să vezi fotografiile și straturile istorice ale orașului.',
            en: 'The map needs JavaScript. Turn JavaScript on in your browser to see the historical photos and layers of the city.',
        },
        publicManifest: true,
    };
}

export interface CityPageInputs {
    readonly bucket: string;
    /** `sha384-…` of the pinned mapbox-gl.js (the page links no mapbox-gl.css: `page.ts`). */
    readonly mapboxGlIntegrity: { readonly script: string };
    /** The root site's theme colour. */
    readonly themeColor: string;
}

/** The page's two files, relative to the Hosting tree's root. */
export interface CityPageFiles {
    readonly page: { readonly to: string; readonly content: string };
    readonly config: { readonly to: string; readonly content: string };
}

/** The bucket's address of a city's manifest, split around the city id (the same address every site build names). */
function manifestAddressParts(bucket: string): { readonly before: string; readonly after: string } {
    const marker = 'hcm-city-id';
    const [before = '', after = ''] = publicObjectUrl(bucket, STORAGE_PATHS.manifest(marker)).split(marker);
    return { before, after };
}

/** The `config.js` of the page. */
function configSource(bucket: string): string {
    const { before, after } = manifestAddressParts(bucket);
    const args = [before, after, CITY_PAGE_FOLDER].map((value) => JSON.stringify(value)).join(', ');
    return [
        "// Historic City Map Maker: the city page's configuration.",
        "'use strict';",
        `(${configureCityPage.toString()})(window, ${args});`,
        tabIconSource(bucket),
    ].join('\n');
}

/**
 * The page and its configuration; its meta policy names the public bucket and the project's crash endpoint
 * (`publicManifest`, as a city site reading the bucket names them). Throws SiteBuildError on a bucket name that is no
 * bucket's or a missing project file.
 */
export function planCityPage(inputs: CityPageInputs, files: SiteFileSystem): CityPageFiles {
    const sample: EngineConfig = { cityId: CITY_PAGE_FOLDER };
    const remote = publicManifest(inputs.bucket, sample, CITY_PAGE_FOLDER, files);
    const csp = contentSecurityPolicy(bucketOrigins(remote.config, remote.connect));
    const page = renderSitePage({
        spec: cityPageSpec(inputs.themeColor),
        csp,
        mapboxGlIntegrity: inputs.mapboxGlIntegrity,
        assets: { engineFolder: `/${ENGINE_FOLDER}/`, config: `/${CITY_PAGE_FOLDER}/config.js`, stylesheet: '/site.css' },
    });
    return {
        page: { to: `${CITY_PAGE_FOLDER}/index.html`, content: page },
        config: { to: `${CITY_PAGE_FOLDER}/config.js`, content: configSource(inputs.bucket) },
    };
}
