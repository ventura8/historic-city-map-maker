/**
 * The admin's entry (`docs/research/M2b-interfaces.md` §1.7): builds the real ports (the browser, the Firebase SDK,
 * Google's popup or, in the `e2e` build, the OAuth stand-in), registers the elements of `@hcm/ui/admin`, boots
 * (`app/boot.ts`) and hands the app to the page's `<hcm-admin-shell>`. Importing it in Node (the tests) does nothing:
 * the start needs a document.
 */
import './admin.css';

import { CITY_ID_PATTERN, createLogger, privacySignal, type CityRole, type Logger, type PrivacyNavigator } from '@hcm/shared';
import { installFonts, windowClassFor, type FontFaceConstructor } from '@hcm/ui';
import { SETUP_PAGE_TAGS, defineAdminElements, defineSetupElements, type HcmAdminShell } from '@hcm/ui/admin';

import { bootAdmin, type BootEnvironment } from './app/boot.js';
import { loadColor, themeFromSeed } from './app/color.js';
import { areaServices } from './app/content-wiring.js';
import { documentVisibility, webStorage, windowClock, windowLocation, type LocationWindow } from './app/browser.js';
import type { Clock, HashLocation, KeyValueStore } from './app/ports.js';
import type { AdminRuntime, FirebaseWebConfig } from './app/config.js';
import { errorEndpointFor, installErrorHooks, AdminErrorReporter, routeOfHash } from './app/errors.js';
import type { AdminApp, AdminDeps, TelemetryView } from './app/mount.js';
import { watchActivity } from './app/activity.js';
import { watchRelease, type ReleaseWatch } from './app/release-watch.js';
import type { AdminProject, SetupModuleSpec } from './app/services.js';
import { setupModuleFor } from './app/setup-wiring.js';
import { AdminTelemetry, expireAnalyticsCookies } from './app/telemetry.js';
import { createGoogleAuth, type PopupSignIn } from './auth/google-auth.js';
import { createStandInPopup } from './auth/stand-in.js';
import { CONTENT_AREAS } from './content/areas.js';
import type { ContentDeps } from './content/registry.js';
import { createAnalytics, surfaceOf, type AnalyticsPort, type EventParams } from './firebase/analytics.js';
import { contentStore } from './firebase/content.js';
import { contentSdk } from './firebase/content-sdk.js';
import { credentialSignIn, firebasePopup, firebasePorts } from './firebase/adapters.js';
import type { FirebasePorts } from './firebase/ports.js';
import type { ProjectConfig } from './provision/project-config.js';
import type { SetupModule } from './setup/module.js';
import type { SetupState } from './setup/state.js';
import { initFirebase, loadAnalyticsSdk, loadFieldSdk, type FirebaseHandles } from './firebase/app.js';
import { firebaseSdk } from './firebase/sdk.js';
import { adminReleaseFields, installPlace } from './app/admin-site.js';
import { AREA_CHUNKS, areaPageLoader, type ContentModuleSlots } from './routing/area-pages.js';
import { PageRegistry, type PageLoader } from './routing/pages.js';
import type { AdminRouteId } from './routing/routes.js';

export type { AdminApp, AdminDeps, AdminIntents } from './app/mount.js';
export type { SetupModuleSpec, ShellServices } from './app/services.js';

/** The pages besides Setup's: a later workstream registers its own (`registerAdminPage`). */
const PAGES = new PageRegistry();
PAGES.register('setup', () => {
    defineSetupElements();
    return Promise.resolve(SETUP_PAGE_TAGS.setup);
});
/**
 * The editors' area modules (`docs/research/M2c-interfaces.md` §2.1): each arrives with its area's chunk, which the page
 * registry loads when the area's route first opens (`DECISIONS-for-review.md` §34b); the content registry creates an
 * area's store the first time its page reads it, so a module is always there by then.
 */
const CONTENT: ContentModuleSlots = {};
for (const area of CONTENT_AREAS) {
    PAGES.register(
        area,
        areaPageLoader(area, AREA_CHUNKS[area], CONTENT, () => globalThis.customElements),
    );
}

/** Adds a page to the shell (imported lazily when its route opens). */
export function registerAdminPage(id: AdminRouteId, load: PageLoader): void {
    PAGES.register(id, load);
}

/** What the entry needs of `window` (the node tests pass a plain object). */
export interface AdminWindow extends LocationWindow {
    readonly document: Document;
    readonly navigator: Pick<Navigator, 'languages'> & PrivacyNavigator;
    readonly sessionStorage: Storage;
    readonly localStorage: Storage;
    readonly innerWidth: number;
    readonly innerHeight: number;
    fetch: typeof fetch;
    setTimeout: Window['setTimeout'];
    clearTimeout: Window['clearTimeout'];
    open: Window['open'];
}

/** The `?test=` of the address: the e2e test's partition for the OAuth stand-in (§2.6). */
function testIdOf(win: AdminWindow): string {
    return new URLSearchParams(win.location.search).get('test') ?? '';
}

/** Google's popup through Firebase, or the e2e stand-in's page. */
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

/**
 * The kit of the `e2e` build, null in production: the mode is a constant for the bundler, so the production bundle
 * carries no stand-in, no city override and no map token.
 */
export const E2E_KIT: E2eKit | null =
    import.meta.env.MODE === 'e2e' ? { standInPopup: createStandInPopup, city: e2eCity, mapToken: e2eMapToken } : null;

function popupFor(win: AdminWindow, handles: FirebaseHandles, e2e: E2eKit | null, clock: Clock): PopupSignIn {
    if (e2e === null) {
        return firebasePopup(firebaseSdk, handles);
    }
    return e2e.standInPopup({
        open: (url) => win.open(url, 'hcm-oauth', 'popup,width=480,height=640'),
        onMessage: (listener) => {
            const onEvent = (event: MessageEvent): void => {
                listener({ origin: event.origin, source: event.source, data: event.data as unknown });
            };
            win.addEventListener('message', onEvent);
            return () => {
                win.removeEventListener('message', onEvent);
            };
        },
        clock,
        testId: testIdOf(win),
        signInWithCredential: credentialSignIn(firebaseSdk, handles),
    });
}

/**
 * GA4 of the admin's own Firebase app, when the web configuration names a measurement id (else none, and no banner); its
 * field measurements carry the window class of the moment and the admin's release (§76).
 */
export function analyticsFor(
    measurementId: string | undefined,
    app: FirebaseHandles['app'],
    parts: BrowserParts,
    context: { readonly release: string; readonly role?: () => CityRole | null },
): AnalyticsPort | null {
    const { release, role = () => null } = context;
    const location = parts.location;
    const fieldContext = (): EventParams => ({ app: 'admin', window_class: windowClassFor(parts.win.innerWidth), release });
    return measurementId === undefined
        ? null
        : createAnalytics({
              app,
              load: loadAnalyticsSdk,
              loadField: loadFieldSdk,
              fieldContext,
              surface: () => surfaceOf(role()),
              log: parts.log,
              pageLocation: location.page.bind(location),
          });
}

/** The admin's telemetry: crash reports to the project's endpoint once the server answers, GA4 behind consent. */
export function telemetryFor(
    parts: BrowserParts,
    handles: Pick<FirebaseHandles, 'app'>,
    config: FirebaseWebConfig,
    release: string,
): AdminDeps<null, null>['telemetry'] {
    const { win, log, location, local } = parts;
    let current: TelemetryView | null = null;
    const analytics = analyticsFor(config.measurementId, handles.app, parts, { release, role: () => current?.role() ?? null });
    return (view: TelemetryView): AdminTelemetry => {
        current = view;
        const endpoint = errorEndpointFor(config.projectId, parts.e2e !== null);
        const errors = new AdminErrorReporter({
            release,
            log,
            now: () => Date.now(),
            endpoint: () => (view.serverAnswers() ? endpoint : null),
            page: () => location.page(),
            viewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
            context: () => ({ locale: view.locale(), windowClass: view.windowClass(), route: routeOfHash(win.location.hash) }),
            post: (url, body) =>
                win.fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' }),
            exception: (description, fatal) => {
                analytics?.log('exception', { description, fatal });
            },
        });
        const clearCookies = (): void => {
            log.info('analytics cookies expired', { count: expireAnalyticsCookies(win.document, win.location.hostname).length });
        };
        const telemetry = new AdminTelemetry({ local, analytics, errors, clearCookies, log, privacySignal: privacySignal(win.navigator) });
        installErrorHooks(win, errors);
        return telemetry;
    };
}

/** The browser parts made once per page: the boot and `mount` share them. */
export interface BrowserParts {
    readonly win: AdminWindow;
    /** The `e2e` build's kit (the emulators and the OAuth stand-in), or null. */
    readonly e2e: E2eKit | null;
    readonly log: Logger;
    readonly location: HashLocation;
    readonly local: KeyValueStore;
    readonly session: KeyValueStore;
    readonly clock: Clock;
}

export function browserParts(win: AdminWindow, e2e: E2eKit | null, log: Logger): BrowserParts {
    return {
        win,
        e2e,
        log,
        location: windowLocation(win),
        local: webStorage(() => win.localStorage, log),
        session: webStorage(() => win.sessionStorage, log),
        clock: windowClock(win),
    };
}

/** The project the shell reads when the page serves no `project.json`: the web configuration's, and this repository's city. */
export function projectOf(config: FirebaseWebConfig): AdminProject {
    return { projectId: config.projectId, cities: ['bucharest'] };
}

/** The Setup Assistant's state and intents as the entry mounts them (none without a project file). */
type EntrySetup = SetupState | null;
type EntryIntents = ReturnType<SetupModule['create']> | null;

/** No Setup Assistant: the page says Setup is not available. */
const NO_ASSISTANT: SetupModuleSpec<EntrySetup, EntryIntents> = { initial: null, create: () => null };

interface SetupParts {
    readonly parts: BrowserParts;
    readonly config: FirebaseWebConfig;
    readonly firebase: FirebasePorts;
    readonly fetch: typeof fetch;
    /** The admin's `runtime.json`: its release and build time (M6: what the install cards install), its own site (§210). */
    readonly runtime: AdminRuntime;
    /** Finding 29 of 2026-10-31: whether Hosting still serves this release (read before an install build). */
    readonly releases: Pick<ReleaseWatch, 'check'>;
}

/** The Setup Assistant over the project file (CR-M2b-15), or none without one. */
function setupFor(setup: SetupParts, project: ProjectConfig | null): SetupModuleSpec<EntrySetup, EntryIntents> {
    if (project === null) {
        setup.parts.log.warn('no project.json: the Setup Assistant is not available');
        return NO_ASSISTANT;
    }
    return setupModuleFor({
        ...{ config: setup.config, project, firebase: setup.firebase, fetch: setup.fetch, clock: setup.parts.clock, log: setup.parts.log },
        baseUrl: setup.parts.win.document.baseURI,
        nonce: globalThis.crypto.randomUUID.bind(globalThis.crypto),
        ...adminReleaseFields(setup.runtime),
        newerAdmin: () => setup.releases.check(),
        ...installPlace(setup.config.projectId, setup.runtime, setup.parts.win.location.origin, setup.parts.e2e === null),
    });
}

/** Loads the colour library `services.theme` uses (in the browser only: Node cannot load it, `app/color.ts`). */
export function loadColourLibrary(
    log: Logger,
    load: Parameters<typeof loadColor>[0] = () => import('@hcm/ui/dynamic-color'),
): Promise<void> {
    return loadColor(load).catch((error: unknown) => {
        log.error('the colour library did not load', { error: String(error) });
    });
}

/** `runtime.json`'s release and build time, as Home reads the recorded installs against them (finding 39 of 2026-11-01). */
function adminReleaseOf(runtime: Pick<AdminRuntime, 'release' | 'releaseTime'>): {
    readonly release: string;
    readonly time: number | null;
} {
    return { release: runtime.release, time: runtime.releaseTime ?? null };
}

/** The editors' dependencies over the real Firestore (`docs/research/M2c-interfaces.md` §2.2). */
export function contentDepsFor(
    parts: BrowserParts,
    handles: FirebaseHandles,
    fetcher: typeof fetch,
    runtime: Pick<AdminRuntime, 'release' | 'releaseTime'>,
): ContentDeps {
    return {
        modules: CONTENT,
        store: contentStore({
            ...{ sdk: contentSdk, firestore: handles.firestore, uid: () => handles.auth.currentUser?.uid ?? null },
            log: createLogger('admin-store'),
        }),
        theme: themeFromSeed,
        areas: areaServices({
            ...{ handles, fetch: fetcher, mapToken: parts.e2e?.mapToken(parts.win.location.search) },
            pushTest: parts.e2e === null ? undefined : testIdOf(parts.win),
            adminRelease: adminReleaseOf(runtime),
        }),
        cityId: parts.e2e?.city(parts.win.location.search) ?? null,
    };
}

/** Every dependency of `mount` but the configuration, from the real browser and Firebase. */
export function browserDeps(parts: BrowserParts): BootEnvironment<EntrySetup, EntryIntents>['build'] {
    const { win, e2e, log, clock } = parts;
    return (config: FirebaseWebConfig, runtime: AdminRuntime, project: ProjectConfig | null) => {
        const handles = initFirebase(firebaseSdk, config, runtime, { emulators: e2e !== null, origin: win.location.origin });
        const fetcher: typeof fetch = (input, init) => win.fetch(input, init);
        const firebase = firebasePorts(firebaseSdk, handles);
        const visibility = documentVisibility(win.document);
        const releases = watchRelease({ fetch: fetcher, clock, visibility, release: runtime.release, log: log.child('release') });
        return {
            ...{ project: project ?? projectOf(config), firebase, fetch: fetcher, clock, log, releases },
            idle: watchActivity(win, clock),
            google: createGoogleAuth(popupFor(win, handles, e2e, clock), { fetch: fetcher, clock, log }),
            ...{ session: parts.session, local: parts.local, location: parts.location, visibility },
            languages: win.navigator.languages,
            pages: PAGES,
            telemetry: telemetryFor(parts, handles, config, runtime.release),
            setup: setupFor({ parts, config, firebase, fetch: fetcher, runtime, releases }, project),
            content: contentDepsFor(parts, handles, fetcher, runtime),
            funnelWindow: win,
        };
    };
}

/** Boots the admin into `shell` (`<hcm-admin-shell>`). */
export async function startAdmin(parts: BrowserParts, shell: Pick<HcmAdminShell, 'app'>): Promise<void> {
    const app = await bootAdmin({
        fetch: (input, init) => parts.win.fetch(input, init),
        location: parts.location,
        local: parts.local,
        languages: parts.win.navigator.languages,
        log: parts.log,
        build: browserDeps(parts),
    });
    shell.app = app;
    guardUnload(parts.win, app);
}

/**
 * Reloading or closing the tab with an edit that is not saved: the browser's own question (`docs/research/M2c-interfaces.md`
 * §2.4). The listener asks the app each time; it prevents nothing while no area holds an unsaved edit.
 */
export function guardUnload(win: Pick<AdminWindow, 'addEventListener'>, app: Pick<AdminApp<unknown, unknown>, 'hasUnsavedChanges'>): void {
    win.addEventListener('beforeunload', (event: Event) => {
        if (app.hasUnsavedChanges()) {
            event.preventDefault();
        }
    });
}

/** What the auto-start needs of the global scope (absent in Node). */
export interface AdminScope {
    readonly document?: Document;
    readonly customElements?: CustomElementRegistry;
    readonly FontFace?: FontFaceConstructor;
}

/**
 * Registers the elements, installs the kit's fonts (from `fonts/` next to the page) and, once the page is parsed, starts
 * the admin in its `<hcm-admin-shell>` (one is added to the body when the page has none).
 */
export function autoStart(scope: AdminScope, win: AdminWindow, e2e: E2eKit | null, log: Logger): void {
    const { document: doc, customElements: registry, FontFace: Face } = scope;
    if (doc === undefined || registry === undefined || Face === undefined) {
        return;
    }
    defineAdminElements(registry);
    installFonts(doc, 'fonts/', Face);
    void loadColourLibrary(log);
    const start = (): void => {
        const shell = doc.querySelector('hcm-admin-shell') ?? doc.body.appendChild(doc.createElement('hcm-admin-shell'));
        void startAdmin(browserParts(win, e2e, log), shell);
    };
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}

autoStart(globalThis, globalThis, E2E_KIT, createLogger('admin'));
