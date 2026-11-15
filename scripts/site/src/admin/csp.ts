import { ANALYTICS_IMAGE_SOURCES, ANALYTICS_SCRIPT_SOURCES, MAPBOX_CONNECT_SOURCES, MAPBOX_GL_CDN } from '../csp.js';

/**
 * The admin's Content Security Policy (docs/research/design-review-security-cost.md §1.8, docs/research/M2b-interfaces.md
 * §6.2). Firebase Hosting sends it as a response header (`firebase.json` → `hosting.headers`); the admin page holds no
 * meta policy, so one page serves production and the e2e admin server, which sends its own variant
 * (`e2eContentSecurityPolicy`). `scripts/site/test/admin-csp.test.ts` keeps `firebase.json` equal to this policy.
 *
 * What the admin needs beyond the viewer's sources:
 *
 * - **Firebase Auth's Google popup**: `https://apis.google.com` (the gapi loader), the project's auth domains
 *   (`<project>.web.app`, `<project>.firebaseapp.com`: the sign-in handler and its hidden iframe) and
 *   `https://accounts.google.com` as frames; the Identity Toolkit and Secure Token APIs under `*.googleapis.com`.
 * - **Google REST from the browser** (PLAN Addendum 1, M2b-interfaces §3.4): every Cloud API, OAuth tokeninfo,
 *   Firestore and Cloud Storage for Firebase are `https://*.googleapis.com`; the callables `*.cloudfunctions.net`
 *   and `*.run.app`.
 * - **App Check with reCAPTCHA Enterprise** (security review §1.6): its script on `www.google.com/recaptcha/` and
 *   `www.gstatic.com/recaptcha/`, its frames on `www.google.com/recaptcha/` and `recaptcha.google.com/recaptcha/`.
 * - **Images**: Cloud Storage downloads, the Google account picture, OpenStreetMap tiles (the georeferencer, M3).
 * - **The local worker** (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §2.7): the auto-pair reads
 *   `http://127.0.0.1:8765/state` and posts its code to `/pair` (`localhost` too, the worker page's own name). A
 *   loopback address is potentially trustworthy, so neither mixed-content blocking nor `upgrade-insecure-requests`
 *   touches it (**UNVERIFIED** in every browser: the first live auto-pair proves Chrome's).
 */

/** Firebase Auth's popup flow loads the gapi helper from here. */
const FIREBASE_AUTH_SCRIPT_SOURCES: readonly string[] = ['https://apis.google.com'];

/** reCAPTCHA Enterprise, behind App Check. */
const RECAPTCHA_SCRIPT_SOURCES: readonly string[] = ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'];
const RECAPTCHA_FRAME_SOURCES: readonly string[] = ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'];

/** Every Google API the admin calls (Cloud REST, tokeninfo, Identity Toolkit, Firestore, Storage) and the callables. */
const GOOGLE_CONNECT_SOURCES: readonly string[] = ['https://*.googleapis.com', 'https://*.cloudfunctions.net', 'https://*.run.app'];

/** M29: the public Landsat catalogue the imagery census of Setup searches, and whose previews it shows (`CENSUS_ORIGIN`). */
const CENSUS_SOURCES: readonly string[] = ['https://planetarycomputer.microsoft.com'];

/** This computer's local worker (`WORKER_PORT`), on its two loopback names. */
const LOCAL_WORKER_CONNECT_SOURCES: readonly string[] = ['http://127.0.0.1:8765', 'http://localhost:8765'];

/** GA4 beacons after consent (the Analytics card's own measurement; the API hosts are under `*.googleapis.com`). */
const ADMIN_ANALYTICS_CONNECT_SOURCES: readonly string[] = [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
];

const ADMIN_IMAGE_SOURCES: readonly string[] = [
    'https://storage.googleapis.com',
    'https://firebasestorage.googleapis.com',
    'https://api.mapbox.com',
    'https://lh3.googleusercontent.com',
    'https://tile.openstreetmap.org',
];

/** The directive the e2e variant drops: it would upgrade the http emulators to https. */
export const UPGRADE_INSECURE_REQUESTS = 'upgrade-insecure-requests';

/** A directive and its sources, in policy order. */
export type CspDirective = readonly [name: string, sources: readonly string[]];

/** The Firebase Hosting domains of `projectId`, where Firebase Auth serves its sign-in handler. */
export function authDomains(projectId: string): string[] {
    return [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`];
}

/** The production policy of the admin of `projectId`, as directives. */
export function adminCspDirectives(projectId: string): readonly CspDirective[] {
    return [
        ['default-src', ["'self'"]],
        // 'wasm-unsafe-eval': Mapbox GL compiles WebAssembly (the georeferencer's map, M3).
        [
            'script-src',
            [
                "'self'",
                "'wasm-unsafe-eval'",
                MAPBOX_GL_CDN,
                ...FIREBASE_AUTH_SCRIPT_SOURCES,
                ...RECAPTCHA_SCRIPT_SOURCES,
                ...ANALYTICS_SCRIPT_SOURCES,
            ],
        ],
        ['style-src', ["'self'", MAPBOX_GL_CDN]],
        [
            'connect-src',
            [
                "'self'",
                ...GOOGLE_CONNECT_SOURCES,
                ...MAPBOX_CONNECT_SOURCES,
                ...ADMIN_ANALYTICS_CONNECT_SOURCES,
                ...LOCAL_WORKER_CONNECT_SOURCES,
                ...CENSUS_SOURCES,
            ],
        ],
        ['img-src', ["'self'", 'data:', 'blob:', ...ADMIN_IMAGE_SOURCES, ...CENSUS_SOURCES, ...ANALYTICS_IMAGE_SOURCES]],
        ['frame-src', ["'self'", ...authDomains(projectId), 'https://accounts.google.com', ...RECAPTCHA_FRAME_SOURCES]],
        ['worker-src', ["'self'", 'blob:']],
        ['font-src', ["'self'"]],
        ['manifest-src', ["'self'"]],
        ['object-src', ["'none'"]],
        ['base-uri', ["'none'"]],
        ['form-action', ["'none'"]],
        ['frame-ancestors', ["'none'"]],
        [UPGRADE_INSECURE_REQUESTS, []],
    ];
}

/** Directives as one header value: `name source …` joined with `; `, each source once. */
export function formatPolicy(directives: readonly CspDirective[]): string {
    return directives.map(([name, sources]) => [name, ...new Set(sources)].join(' ')).join('; ');
}

/** A header value back into directives (blank parts dropped). */
export function parsePolicy(policy: string): CspDirective[] {
    return policy
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter((words): words is [string, ...string[]] => words[0] !== undefined && words[0] !== '')
        .map(([name, ...sources]) => [name, sources]);
}

/** The production policy of the admin of `projectId`, as `firebase.json` must send it. */
export function adminContentSecurityPolicy(projectId: string): string {
    return formatPolicy(adminCspDirectives(projectId));
}

/**
 * The e2e admin server's variant of `policy` (M2b-interfaces §6.2): `upgrade-insecure-requests` dropped and `connect`
 * (the emulators' and the mock APIs' http origins) added to `connect-src`; every other directive unchanged.
 */
export function e2eContentSecurityPolicy(policy: string, connect: readonly string[]): string {
    return formatPolicy(
        parsePolicy(policy)
            .filter(([name]) => name !== UPGRADE_INSECURE_REQUESTS)
            .map(([name, sources]) => (name === 'connect-src' ? [name, [...sources, ...connect]] : [name, sources])),
    );
}
