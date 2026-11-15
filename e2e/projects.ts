import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions, type Project } from '@playwright/test';

import { ADMIN_ORIGIN } from './admin/world.js';
import { inPart, type ShardRange } from './split.js';
import { FORCE_DARK, GL_ARGS, HOST_RULES } from './support/chromium-args.js';
import type { WorkerOptions } from './support/test.js';

/**
 * The Playwright projects of the e2e tiers (docs/research/design-review-testability.md §4.3), chosen per run with
 * `E2E_TIER` (comma-separated): unset runs the tiers of every push (all but `tour-matrix`), `all` runs every tier.
 * Every project runs Chromium under SwiftShader behind the host-resolver rules (but the admin's Firefox and WebKit ones,
 * behind the firewall alone) and depends on `setup`, which validates the fixture manifest and the servers once.
 *
 * | Tier | Projects | Specs |
 * | --- | --- | --- |
 * | `admin` | `admin-setup`, `admin-harness`, `admin-{c360,m768,l1440}-ro`, `admin-l1440-dark`, `admin-l1440-en`, `admin-steps-l1440-en`, `admin-{firefox,webkit}-l1440-ro` | `admin/{setup,harness,specs,steps}/` (the Setup journey and the imagery publishes at `admin-c360-ro` and `admin-l1440-ro` only, the real pipeline at `admin-l1440-ro`) |
 * | `smoke` | `harness`, `smoke-c360`, `smoke-l1440` | `specs/harness/` (the e2e preconditions), `specs/smoke/` (the viewer boots) |
 * | `a11y` | `a11y-reduced-motion`, `a11y-forced-colors` | `a11y/reduced-motion.spec.ts`, `a11y/forced-colors.spec.ts` |
 * | `nogl` | `nogl` (`--disable-3d-apis`) | `specs/viewer/no-webgl.spec.ts` |
 * | `tour` | the per-push tour: `tour-{x3840,l1440,c915l,c360}-light-ro` (the viewer's and the admin's journeys), `tour-{x3840,l1440,c915l,c360}-dark-ro` and `tour-c360-light-en` (the viewer's) | `tour/*.tour.ts` (layout, axe, ARIA) |
 * | `tour-matrix` | the other 35 `tour-<viewport>-<light|dark>-<ro|en>` of the 11 viewports, the admin's journeys of the five per-push projects above that skip them (`tour-<…>-admin`), the Setup journey at `admin-{m768-ro,l1440-dark,l1440-en}-journey`, the imagery publishes at `admin-{m768-ro,l1440-dark,l1440-en}-imagery` and the window-class-independent functional specs at the other four functional projects (`fn-<…>-matrix`) (`all`, nightly) | `tour/*.tour.ts`, `admin/specs/journey.spec.ts`, `specs/viewer/` |
 * | `fn` | `fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, `fn-l1440-en`, `fn-c360-dark`, `fn-webkit-iphone15` | `specs/viewer/`, `specs/starter-kit/` (the window-class-independent ones at `fn-l1440-ro` only; `viewer/iphone-sheet.spec.ts` at `fn-webkit-iphone15` only, WebKit as an iPhone 15) |
 *
 * Every scenario row runs on every push: what `tour-matrix` adds are repetitions of rows the push already ran at another
 * project (`docs/research/DECISIONS-for-review.md` §29a, §39c, §42g).
 *
 * The run order is the order of this table: Playwright queues the projects in it, and an `E2E_SHARD` slice is a
 * contiguous part of that queue. The admin tier comes first, so its locked chain (see below) runs beside everything
 * else instead of after it; the few long tests follow, the tour's largest viewports first; the many short
 * functional tests come last and fill the workers to the end.
 *
 * The admin projects (docs/research/M2b-interfaces.md §6.2) open the admin server's origin, forward the fake
 * upstreams' hosts (`forwardUpstreams`) and depend on `admin-setup` (the admin build and the emulators answer) instead
 * of `setup`. The emulators' owner, admins and setup records are per Firebase project, so the specs that touch them
 * (the smoke, the journey, the Setup steps, revoke, operations, the harness) never run at the same time: each declares
 * the Playwright lock `ADMIN_LOCK` (e2e/admin/support/test.ts), which the dispatcher honours without holding a worker,
 * and the lease of the mock APIs stays as the guard behind it. The content specs (the editors') take a city and a
 * Google account of their own (e2e/admin/support/content-test.ts), no lock, and run on every worker. A run split
 * between two machines gives each its own part of the admin projects (`E2E_ADMIN_PART`, e2e/split.ts): each machine
 * starts its own emulators, so the two halves of the locked chain run at the same time.
 */

/** Every tier, in run order (the table above). */
const TIERS = ['admin', 'smoke', 'a11y', 'nogl', 'tour', 'tour-matrix', 'fn'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * The tiers of every push (`E2E_TIER` unset): every scenario row of the registry. `tour-matrix` repeats the tour's rows
 * at the remaining viewport, theme and language combinations; it runs in `all` (before a push to `master` or a tag,
 * stage `tour-matrix`) and nightly (docs/research/DECISIONS-for-review.md §29).
 */
const PUSH_TIERS: readonly Tier[] = TIERS.filter((tier) => tier !== 'tour-matrix');

/** No WebGL at all (scenario V02's bad path): the viewer must fall back to the photo list. */
const NO_GL_ARGS = ['--disable-3d-apis', HOST_RULES];

interface Viewport {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly isMobile?: boolean;
    readonly hasTouch?: boolean;
    readonly deviceScaleFactor?: number;
}

const phone = (width: number, height: number): Viewport => ({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
});

/** M3 window classes: compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large < 1600 ≤ extra-large; c915l is compact height. */
const VIEWPORTS = {
    c320: phone(320, 568),
    c360: phone(360, 800),
    c412: phone(412, 915),
    c915l: phone(915, 412),
    m768: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    e1024: { viewport: { width: 1024, height: 768 }, hasTouch: true },
    l1280: { viewport: { width: 1280, height: 800 } },
    l1440: { viewport: { width: 1440, height: 900 } },
    x1920: { viewport: { width: 1920, height: 1080 } },
    x2560: { viewport: { width: 2560, height: 1440 } },
    x3840: { viewport: { width: 3840, height: 2160 } },
} as const satisfies Record<string, Viewport>;

type ViewportName = keyof typeof VIEWPORTS;
type E2eProject = Project<PlaywrightTestOptions, PlaywrightWorkerOptions & WorkerOptions>;
type Use = NonNullable<E2eProject['use']>;

const LOCALES = { ro: 'ro-RO', en: 'en-US' } as const;

function chromium(viewport: ViewportName, lang: 'ro' | 'en' = 'ro', args: readonly string[] = GL_ARGS): Use {
    return { browserName: 'chromium', ...VIEWPORTS[viewport], launchOptions: { args: [...args] }, locale: LOCALES[lang], lang };
}

/**
 * Firefox or WebKit at a viewport (both in the quality image): the forms of the admin's editors, whose inputs, dates,
 * selects and focus differ most between engines. The firewall is Playwright's routing, the same in every browser.
 */
function otherBrowser(browserName: 'firefox' | 'webkit', viewport: ViewportName, lang: 'ro' | 'en' = 'ro'): Use {
    return { browserName, ...VIEWPORTS[viewport], locale: LOCALES[lang], lang };
}

function project(tier: Tier, name: string, testMatch: string | string[], use: Use, extra: Partial<E2eProject> = {}): E2eProject {
    return { name, testMatch, use, dependencies: ['setup'], metadata: { tier }, ...extra };
}

/** Globs relative to the project's test folder (`specs` unless the project says otherwise). */
const SPECS = ['viewer/**/*.spec.ts', 'starter-kit/**/*.spec.ts'];
const NO_WEBGL_SPEC = 'viewer/no-webgl.spec.ts';
/** The owner's iPhone (2026-11-15): Safari's taps on the menu's and the Layers panel's X, in WebKit only. */
const IPHONE_SPEC = 'viewer/iphone-sheet.spec.ts';

/**
 * The functional specs whose behaviour does not depend on the window class (DECISIONS-for-review.md §39c, §42g): the
 * boot and its errors, deep links, the analytics consent, the crash reports, the field measurements, the embed API, geolocation, language and
 * theme, About, the page's policy, no JavaScript, swipe compare (each of its tests sets its own window), the manifest of
 * the public bucket, the starter kit.
 * Each push runs them at `fn-l1440-ro`; the other four functional projects run them in `tour-matrix`. The specs whose
 * panels, sheets or keys change with the window (Layers and the opacities, photos, places, the timeline, the keyboard,
 * the responsive layouts) run at all five on every push.
 */
const ONE_PROJECT_SPECS = [
    'viewer/about.spec.ts',
    'viewer/boot.spec.ts',
    'viewer/consent.spec.ts',
    'viewer/content-security-policy.spec.ts',
    'viewer/crash-reporting.spec.ts',
    'viewer/deep-links.spec.ts',
    'viewer/field-measurements.spec.ts',
    'viewer/embed-api.spec.ts',
    // The IIFE's extras on demand (V63, DECISIONS-for-review.md §186): their tests set their own window.
    'viewer/extras.spec.ts',
    'viewer/geolocate.spec.ts',
    'viewer/language-theme.spec.ts',
    // Chrome's dark theme for sites (P2 of the Pixel 9 Pro review): the spec starts its own browser with it.
    'viewer/dark-theme-for-sites.spec.ts',
    'viewer/no-javascript.spec.ts',
    // Swipe compare sets the window each test needs (a second map from 600 px wide, a toggle below: M4, V06).
    'viewer/compare.spec.ts',
    // Games consoles and the 10-foot view (V65, V66): the TV's 1920 x 1080 window with a coarse pointer is set by the spec.
    'viewer/consoles.spec.ts',
    // V68's peek (DECISIONS-for-review.md §195i): a mouse at 1440 and 1024 wide, a finger at 360 and 768, set by the spec.
    'viewer/timeline-peek.spec.ts',
    'viewer/public-manifest.spec.ts',
    // M6 (docs/research/M6-interfaces.md §2): the public map on the e2e Hosting site; its pages are the viewer's own.
    'viewer/hosting.spec.ts',
    'starter-kit/**/*.spec.ts',
];

function smokeProjects(): E2eProject[] {
    return [
        project('smoke', 'harness', 'harness/**/*.spec.ts', chromium('l1440')),
        project('smoke', 'smoke-c360', 'smoke/**/*.spec.ts', chromium('c360')),
        project('smoke', 'smoke-l1440', 'smoke/**/*.spec.ts', chromium('l1440')),
    ];
}

/**
 * A functional or a11y scenario walks several states of a SwiftShader map (open a panel, move a slider, probe, close):
 * 60 s each, as eight such pages in parallel take more than Playwright's default 30 s on a loaded machine.
 */
const SCENARIO_TIMEOUT_MS = 60_000;

/** The functional projects; the one that runs the window-class-independent specs on every push is `fn-l1440-ro`. */
const FUNCTIONAL_VARIANTS: readonly { readonly name: string; readonly use: Use; readonly everySpec: boolean }[] = [
    { name: 'fn-c360-ro', use: chromium('c360'), everySpec: false },
    { name: 'fn-m768-ro', use: chromium('m768'), everySpec: false },
    { name: 'fn-l1440-ro', use: chromium('l1440'), everySpec: true },
    { name: 'fn-l1440-en', use: chromium('l1440', 'en'), everySpec: false },
    { name: 'fn-c360-dark', use: { ...chromium('c360'), colorScheme: 'dark' }, everySpec: false },
];

function functionalProjects(): E2eProject[] {
    return FUNCTIONAL_VARIANTS.map(({ name, use, everySpec }) =>
        project('fn', name, SPECS, use, {
            testIgnore: everySpec ? [NO_WEBGL_SPEC, IPHONE_SPEC] : [NO_WEBGL_SPEC, IPHONE_SPEC, ...ONE_PROJECT_SPECS],
            timeout: SCENARIO_TIMEOUT_MS,
        }),
    ).concat(
        // WebKit as an iPhone 15 (touch, 393 x 659, Safari's user agent): the menu's and the Layers panel's X on every push.
        project(
            'fn',
            'fn-webkit-iphone15',
            IPHONE_SPEC,
            { ...devices['iPhone 15'], browserName: 'webkit', locale: LOCALES.ro, lang: 'ro' },
            { timeout: SCENARIO_TIMEOUT_MS },
        ),
    );
}

/** The window-class-independent specs at the four functional projects that skip them on a push (`tour-matrix`). */
function functionalMatrixProjects(): E2eProject[] {
    return FUNCTIONAL_VARIANTS.filter((variant) => !variant.everySpec).map(({ name, use }) =>
        project('tour-matrix', `${name}-matrix`, ONE_PROJECT_SPECS, use, { timeout: SCENARIO_TIMEOUT_MS }),
    );
}

interface TourVariant {
    readonly viewport: ViewportName;
    readonly scheme: 'light' | 'dark';
    readonly lang: 'ro' | 'en';
}

/** What SwiftShader paints per frame: CSS pixels times the device pixel ratio squared. */
function devicePixels(name: ViewportName): number {
    const entry: Viewport = VIEWPORTS[name];
    return entry.viewport.width * entry.viewport.height * (entry.deviceScaleFactor ?? 1) ** 2;
}

/** Every viewport, scheme and language of the tour (44), the largest frames first. */
function tourVariants(): TourVariant[] {
    const largestFirst = (Object.keys(VIEWPORTS) as ViewportName[]).sort((a, b) => devicePixels(b) - devicePixels(a));
    return largestFirst.flatMap((viewport) =>
        (['light', 'dark'] as const).flatMap((scheme) => (['ro', 'en'] as const).map((lang) => ({ viewport, scheme, lang }))),
    );
}

/**
 * The per-push tour (tier `tour`): a phone, a phone held landscape (compact height), a laptop and a 4K screen, light and
 * dark, in Romanian, plus the phone in English. Every tour test, and so every tour scenario row, runs on every push;
 * the other 35 combinations are the `tour-matrix` tier. The admin's journeys run on a push in light, in Romanian, at the
 * four viewports; at the dark and English projects of the push they are `tour-matrix`'s (DECISIONS-for-review.md §39c,
 * §42g: their states, the fifty categories among them, are the same rows again in another scheme or language).
 */
const PUSH_TOUR_VIEWPORTS: readonly ViewportName[] = ['c360', 'c915l', 'l1440', 'x3840'];
const PUSH_TOUR_ENGLISH: TourVariant = { viewport: 'c360', scheme: 'light', lang: 'en' };

const VIEWER_TOUR = 'viewer.tour.ts';
const ADMIN_TOURS = 'admin-*.tour.ts';

function isPushTour(variant: TourVariant): boolean {
    const english = variant.viewport === PUSH_TOUR_ENGLISH.viewport && variant.scheme === PUSH_TOUR_ENGLISH.scheme;
    return variant.lang === 'ro' ? PUSH_TOUR_VIEWPORTS.includes(variant.viewport) : english;
}

/** A per-push tour project that runs the admin's journeys too: light, in Romanian. */
function runsAdminTourOnPush(variant: TourVariant): boolean {
    return variant.scheme === 'light' && variant.lang === 'ro';
}

function tourProject(
    tier: 'tour' | 'tour-matrix',
    variant: TourVariant,
    files: { readonly suffix: string; readonly match: string },
): E2eProject {
    const { viewport, scheme, lang } = variant;
    return project(
        tier,
        `tour-${viewport}-${scheme}-${lang}${files.suffix}`,
        files.match,
        // A dark system on Android turns on Chrome's dark theme for sites: the dark tours run with it (P2 of the Pixel review).
        { ...chromium(viewport, lang, scheme === 'dark' ? [...GL_ARGS, FORCE_DARK] : GL_ARGS), colorScheme: scheme },
        // Up to seven states per test, each through both generic checkers (axe, a full Tab round, the text-spacing and
        // reflow variants): a 3840 px frame under SwiftShader took 90 s on a loaded laptop (2026-10-17), so 240 s.
        { testDir: 'tour', timeout: 240_000 },
    );
}

const EVERY_TOUR = { suffix: '', match: '**/*.tour.ts' } as const;

function tourProjects(): E2eProject[] {
    return tourVariants()
        .filter((variant) => isPushTour(variant))
        .map((variant) => tourProject('tour', variant, runsAdminTourOnPush(variant) ? EVERY_TOUR : { suffix: '', match: VIEWER_TOUR }));
}

function tourMatrixProjects(): E2eProject[] {
    const others = tourVariants()
        .filter((variant) => !isPushTour(variant))
        .map((variant) => tourProject('tour-matrix', variant, EVERY_TOUR));
    const adminOfPush = tourVariants()
        .filter((variant) => isPushTour(variant) && !runsAdminTourOnPush(variant))
        .map((variant) => tourProject('tour-matrix', variant, { suffix: '-admin', match: ADMIN_TOURS }));
    return [...adminJourneyMatrixProjects(), ...adminOfPush, ...others, ...functionalMatrixProjects()];
}

/** Each special runs only its own spec (selected by file, never by skip): the emulation is what the spec checks. */
function a11yProjects(): E2eProject[] {
    return [
        project(
            'a11y',
            'a11y-reduced-motion',
            'reduced-motion.spec.ts',
            { ...chromium('l1440'), reducedMotion: 'reduce' },
            { testDir: 'a11y', timeout: SCENARIO_TIMEOUT_MS },
        ),
        project(
            'a11y',
            'a11y-forced-colors',
            'forced-colors.spec.ts',
            { ...chromium('l1440'), forcedColors: 'active' },
            { testDir: 'a11y', timeout: SCENARIO_TIMEOUT_MS },
        ),
    ];
}

function noWebGlProjects(): E2eProject[] {
    return [project('nogl', 'nogl', NO_WEBGL_SPEC, chromium('l1440', 'ro', NO_GL_ARGS))];
}

/**
 * An admin flow waits for the emulators (callables, the Auth and Firestore emulators) besides the page, and its states'
 * checkers share the machine with the tour's admin journeys: a test of five states took 90 s on the loaded laptop
 * (2026-10-18), so 150 s.
 */
const ADMIN_TIMEOUT_MS = 150_000;

function adminProject(name: string, testMatch: string | string[], use: Use, extra: Partial<E2eProject> = {}): E2eProject {
    return {
        name,
        testDir: 'admin',
        testMatch,
        use: { ...use, baseURL: ADMIN_ORIGIN, forwardUpstreams: true },
        dependencies: ['admin-setup'],
        timeout: ADMIN_TIMEOUT_MS,
        metadata: { tier: 'admin' },
        ...extra,
    };
}

/** The admin tier's own setup: the admin build and the emulators answer. */
function adminSetupProject(): E2eProject {
    return { name: 'admin-setup', testDir: 'admin/setup', testMatch: '**/*.setup.ts', use: chromium('l1440'), metadata: { tier: 'admin' } };
}

/**
 * The owner's whole Setup journey (about two minutes behind the admin tier's lock) runs on a push at a phone and a laptop
 * (`admin-c360-ro`, `admin-l1440-ro`); at the tablet, in the dark scheme and in English it is a repetition of the same
 * rows, run by `tour-matrix` (DECISIONS-for-review.md §39c, §42g).
 */
const JOURNEY_SPEC = 'specs/journey.spec.ts';
const JOURNEY_MATRIX: readonly { readonly name: string; readonly use: Use }[] = [
    { name: 'admin-m768-ro', use: chromium('m768') },
    { name: 'admin-l1440-dark', use: { ...chromium('l1440'), colorScheme: 'dark' } },
    { name: 'admin-l1440-en', use: chromium('l1440', 'en') },
];

/**
 * The imagery specs whose publishes wait for the fake MTS and the manifest build (two to six minutes a test behind the
 * admin lock: the imports that reach the public map, crop, replace and re-georeference) run on a push at a phone and a
 * laptop, like the Setup journey; at the tablet, in the dark scheme and in English they repeat the same rows in
 * `tour-matrix` (DECISIONS-for-review.md §48b, §49k). The real pipeline's run does not depend on the window class: on a
 * push at the laptop only, the Cloud Run run's and the local worker's (M7) alike.
 */
const IMAGERY_PUBLISH_SPECS = [
    'specs/imagery/published.spec.ts',
    'specs/imagery/layer-geometry.spec.ts',
    // M4's automation from a bought scan to the viewer's compare (two publishes in its happy path).
    'specs/imagery/automation.spec.ts',
    // M8's join, from a date's row to the published layer.
    'specs/imagery/join.spec.ts',
    // M25: Landsat from Find to the published layer, and the tick's own import.
    'specs/imagery/landsat.spec.ts',
];
const PIPELINE_SPECS = ['specs/imagery/pipeline.spec.ts', 'specs/imagery/worker-run.spec.ts', 'specs/imagery/join-pipeline.spec.ts'];

function adminJourneyMatrixProjects(): E2eProject[] {
    const matrix = { metadata: { tier: 'tour-matrix' } };
    return [
        adminSetupProject(),
        ...JOURNEY_MATRIX.map(({ name, use }) => adminProject(`${name}-journey`, JOURNEY_SPEC, use, matrix)),
        ...JOURNEY_MATRIX.map(({ name, use }) => adminProject(`${name}-imagery`, IMAGERY_PUBLISH_SPECS, use, matrix)),
    ];
}

/**
 * The admin tier: its setup, the harness of its e2e world, the functional specs at three window classes, in the dark
 * scheme and in English, the Setup Assistant's steps, and the editors' forms in Firefox and WebKit. With `part`
 * (`E2E_ADMIN_PART`), only those parts of the test projects, dealt round robin in the order below: of three, part 1 is
 * `admin-c360-ro`, `admin-l1440-dark` and `admin-steps-l1440-en`, part 2 `admin-m768-ro`, `admin-l1440-en` and
 * `admin-firefox-l1440-ro`, part 3 `admin-l1440-ro`, `admin-harness` and `admin-webkit-l1440-ro`
 * (scripts/ci/e2e-split.sh gives the NUC, about twice as fast, parts 1-2 and this machine part 3).
 */
function adminProjects(part: ShardRange | null): E2eProject[] {
    const SPECS_GLOB = 'specs/**/*.spec.ts';
    const FORMS_GLOB = 'specs/editing/**/*.spec.ts';
    // At the tablet, in the dark scheme and in English the journey and the slow imagery specs run in `tour-matrix`.
    const noJourney = { testIgnore: [JOURNEY_SPEC, ...IMAGERY_PUBLISH_SPECS, ...PIPELINE_SPECS] };
    const tests = [
        adminProject('admin-c360-ro', SPECS_GLOB, chromium('c360'), { testIgnore: PIPELINE_SPECS }),
        adminProject('admin-m768-ro', SPECS_GLOB, chromium('m768'), noJourney),
        adminProject('admin-l1440-ro', SPECS_GLOB, chromium('l1440')),
        // The dark scheme: colours, rings and contrast are the scheme's (the visual audit of 2026-10-17 found the admin
        // checked only in light); dealt to part 1 with admin-c360-ro.
        adminProject('admin-l1440-dark', SPECS_GLOB, { ...chromium('l1440'), colorScheme: 'dark' }, noJourney),
        adminProject('admin-l1440-en', SPECS_GLOB, chromium('l1440', 'en'), noJourney),
        adminProject('admin-harness', 'harness/**/*.spec.ts', chromium('l1440')),
        // The Setup Assistant's steps one by one (their bad paths, each from a seeded state): what they check is the
        // server's answers and the card's words, not the layout, which the journey and the tour check at every window
        // class; one project, in English (the journey runs in Romanian at three window classes).
        adminProject('admin-steps-l1440-en', 'steps/**/*.spec.ts', chromium('l1440', 'en')),
        // The editors' forms (drafts, saving, remembered fields: no map) in Firefox and WebKit.
        adminProject('admin-firefox-l1440-ro', FORMS_GLOB, otherBrowser('firefox', 'l1440')),
        adminProject('admin-webkit-l1440-ro', FORMS_GLOB, otherBrowser('webkit', 'l1440')),
    ];
    return [adminSetupProject(), ...tests.filter((_, position) => inPart(position, part))];
}

const BY_TIER: Readonly<Record<Tier, (adminPart: ShardRange | null) => E2eProject[]>> = {
    admin: adminProjects,
    smoke: smokeProjects,
    a11y: a11yProjects,
    nogl: noWebGlProjects,
    tour: tourProjects,
    'tour-matrix': tourMatrixProjects,
    fn: functionalProjects,
};

function isTier(value: string): value is Tier {
    return (TIERS as readonly string[]).includes(value);
}

/**
 * `E2E_TIER` as tiers, in run order: unset or empty is the tiers of every push, `all` (alone or in the list) every
 * tier; anything unknown throws, naming the valid ones.
 */
export function tiersFrom(value: string | undefined): readonly Tier[] {
    const names = (value ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
    const unknown = names.filter((name) => name !== 'all' && !isTier(name));
    if (unknown.length > 0) {
        throw new Error(`E2E_TIER must be "all" or a comma-separated list of ${TIERS.join(', ')}; unknown: ${unknown.join(', ')}`);
    }
    if (names.includes('all')) {
        return TIERS;
    }
    return names.length === 0 ? PUSH_TIERS : TIERS.filter((tier) => names.includes(tier));
}

/**
 * The tiers that open the admin: its own, and the tour's, whose admin journeys run in cities of their own
 * (e2e/tour/admin-*.tour.ts, DECISIONS-for-review.md §34c): such a run starts the admin server and the emulators and
 * builds the admin's Hosting folder.
 */
const ADMIN_TIERS: readonly Tier[] = ['admin', 'tour', 'tour-matrix'];

/** Whether a run of `tiers` needs the admin server and the emulators. */
export function needsAdmin(tiers: readonly Tier[]): boolean {
    return tiers.some((tier) => ADMIN_TIERS.includes(tier));
}

/**
 * `setup`, then the projects of `tiers` (of the admin tier, those of `adminPart` when given); a project two tiers share
 * (`admin-setup`, which the admin tier and `tour-matrix`'s journeys both need) once.
 */
export function e2eProjects(tiers: readonly Tier[], adminPart: ShardRange | null = null): E2eProject[] {
    const setup: E2eProject = {
        name: 'setup',
        testDir: 'setup',
        testMatch: '**/*.setup.ts',
        use: chromium('l1440'),
        metadata: { tier: 'setup' },
    };
    const projects = [setup, ...tiers.flatMap((tier) => BY_TIER[tier](adminPart))];
    return projects.filter((candidate, position) => projects.findIndex((other) => other.name === candidate.name) === position);
}
