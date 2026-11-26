/**
 * The meta Content Security Policy of every static page that boots the engine (M5, `docs/research/M5-interfaces.md`
 * §3.2): a city site of this repository (`scripts/site`, which imports this table: CR-M5-6), the starter kit's page
 * (the engine from its pinned jsDelivr folder) and the static export's (the engine in `engine/` beside the page).
 * GitHub Pages and an export's static host cannot send headers, so the policy is a meta element, the page's first; one
 * table, so the sites, the kit and the export never drift (`docs/research/DECISIONS-for-review.md` §15c).
 *
 * Fixed sources: the page's own origin (the manifest and the photos served next to the page), Mapbox GL JS from
 * api.mapbox.com and the Mapbox APIs, the engine's own files (its script, stylesheet, fonts and languages: the page's
 * origin, or the pinned folder of a release) and the Google Analytics and Firebase hosts the telemetry may load after the visitor
 * consents. A site adds the origins its manifest names (an https manifest, photo or tile host, the crash endpoint).
 */

import { isCspOrigin } from '../text/urls.js';

/** The page's own origin. */
export const SELF_SOURCE = "'self'";

/** Mapbox GL JS (script, stylesheet and its WebAssembly helpers) is loaded from this folder, never bundled. */
export const MAPBOX_GL_CDN = 'https://api.mapbox.com/mapbox-gl-js/';

/** Styles, tiles, fonts, sprites, map sessions (api.mapbox.com) and the map-load event (events.mapbox.com). */
export const MAPBOX_CONNECT_SOURCES: readonly string[] = [
    'https://api.mapbox.com',
    'https://events.mapbox.com',
    'https://*.tiles.mapbox.com',
];

/**
 * GA4 through the Firebase Analytics SDK, loaded only after consent and only when the manifest names a measurement id
 * (`firebase/analytics_and_crash_skill.md`). Listed in every page because the manifest can gain one later without a
 * new page. Performance Monitoring's hosts are gone: the public viewer never loads it (CR-M2-36).
 */
export const ANALYTICS_SCRIPT_SOURCES: readonly string[] = ['https://www.googletagmanager.com'];

export const ANALYTICS_CONNECT_SOURCES: readonly string[] = [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
    'https://firebase.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://firebaseremoteconfig.googleapis.com',
];

export const ANALYTICS_IMAGE_SOURCES: readonly string[] = ['https://*.google-analytics.com', 'https://*.googletagmanager.com'];

/** Origins a page adds to the fixed policy (a site's `manifestOrigins`). */
export interface ExtraSources {
    /** fetch / XHR targets: the manifest, tiles, the crash-report endpoint. */
    readonly connect: readonly string[];
    /** `<img>` and image-decoding targets: photos, tiles. */
    readonly images: readonly string[];
}

/** A page whose manifest and photos are all its own: nothing to add. */
export const NO_EXTRA_SOURCES: ExtraSources = { connect: [], images: [] };

type Directive = readonly [name: string, sources: readonly string[]];

/** The telemetry's hosts, or none for a page whose manifest can name no analytics id (a static export). */
interface Telemetry {
    readonly script: readonly string[];
    readonly connect: readonly string[];
    readonly images: readonly string[];
}

const TELEMETRY: Telemetry = { script: ANALYTICS_SCRIPT_SOURCES, connect: ANALYTICS_CONNECT_SOURCES, images: ANALYTICS_IMAGE_SOURCES };
const NO_TELEMETRY: Telemetry = { script: [], connect: [], images: [] };

function directives(extra: ExtraSources, engine: string, analytics: boolean): readonly Directive[] {
    const telemetry = analytics ? TELEMETRY : NO_TELEMETRY;
    return [
        ['default-src', ["'none'"]],
        // 'wasm-unsafe-eval': Mapbox GL compiles WebAssembly for the Standard style (security review §1.8).
        ['script-src', [engine, MAPBOX_GL_CDN, "'wasm-unsafe-eval'", ...telemetry.script]],
        ['style-src', [engine, MAPBOX_GL_CDN]],
        ['img-src', [SELF_SOURCE, 'data:', 'blob:', 'https://api.mapbox.com', ...telemetry.images, ...extra.images]],
        // The engine's own folder too: it fetches the visitor's language from `<engine>i18n/` (DECISIONS-for-review.md §218).
        ['connect-src', [SELF_SOURCE, engine, ...MAPBOX_CONNECT_SOURCES, ...telemetry.connect, ...extra.connect]],
        // The engine's self-hosted fonts (FontFace from `engineBase`, the folder of its script).
        ['font-src', [engine]],
        // Mapbox GL runs its workers from blob: URLs; child-src covers browsers without worker-src (Safari < 15.5). 'self':
        // the installable app's service worker beside the page (`sw.js`, docs/ENGINE_API.md → Installable app).
        ['worker-src', ['blob:', SELF_SOURCE]],
        ['child-src', ['blob:']],
        ['manifest-src', [SELF_SOURCE]],
        ['base-uri', ["'none'"]],
        ['form-action', ["'none'"]],
        ['object-src', ["'none'"]],
    ];
}

/**
 * The policy as one `content` attribute value: directives in a fixed order, each source once. `engine` is where the
 * engine's script, stylesheet and fonts come from: the page's own origin (a city site, an export), or the pinned
 * folder of a release (`engineCdnBase`, the starter kit), which a source expression with a path matches as a prefix.
 * `analytics` false leaves the telemetry's hosts out (an export, whose manifest carries no analytics id). An extra
 * source that is not an origin (`isCspOrigin`) throws: it could end a directive and add others.
 */
export function contentSecurityPolicy(extra: ExtraSources, engine: string = SELF_SOURCE, analytics = true): string {
    const refused = [...extra.connect, ...extra.images].find((source) => !isCspOrigin(source));
    if (refused !== undefined) {
        throw new RangeError(`not an https origin a policy may name: ${JSON.stringify(refused)}`);
    }
    return directives(extra, engine, analytics)
        .map(([name, sources]) => [name, ...new Set(sources)].join(' '))
        .join('; ');
}

/** The sources a policy's text gives `directive` (none when it has no such directive). */
function sourcesOf(policy: string, directive: string): string[] {
    const found = policy
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .find(([name]) => name === directive);
    return found?.slice(1) ?? [];
}

/**
 * What a page's policy adds to the fixed one (the tile and photo hosts its owner or its export added to `img-src` and
 * `connect-src`, origins only), and whether it names the telemetry's hosts: `create-historic-city upgrade` and `theme`
 * rewrite the policy with these, so a page keeps every source it had (`docs/LESSONS.md` 242).
 */
export function policyExtras(policy: string): { readonly sources: ExtraSources; readonly analytics: boolean } {
    const fixed = new Set(directives(NO_EXTRA_SOURCES, SELF_SOURCE, true).flatMap(([, sources]) => sources));
    const extra = (directive: string): string[] =>
        sourcesOf(policy, directive).filter((source) => !fixed.has(source) && isCspOrigin(source));
    const connect = sourcesOf(policy, 'connect-src');
    return {
        sources: { connect: extra('connect-src'), images: extra('img-src') },
        analytics: ANALYTICS_CONNECT_SOURCES.some((source) => connect.includes(source)),
    };
}
