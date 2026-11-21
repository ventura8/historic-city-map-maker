/**
 * The admin app (`docs/research/M2b-interfaces.md` §1.7): `mount(deps)` wires the injected ports into the state, the
 * auth state machine, the address, the city theme and telemetry, and returns the `AdminApp` the shell element renders
 * (`<hcm-admin-shell>` of `@hcm/ui/admin` reads it through its structural `AdminAppPort`). DOM-free: the entry
 * (`../index.ts`) builds the real ports, the node tests pass fakes.
 */
import type { UiLocale, Logger, ThemeTokens } from '@hcm/shared';
import type { FunnelWindow } from '@hcm/shared/funnels';

import { AuthController } from '../auth/controller.js';
import { GoogleAccessStore } from '../auth/google-access.js';
import type { GoogleAuthPort } from '../auth/google-auth.js';
import { GoogleAccessService } from '../auth/google-service.js';
import type { StatisticsSource } from '../crashes/statistics.js';
import { statisticsSourceOf } from './statistics-wiring.js';
import { checkOwnership, enableService } from '../auth/ownership.js';
import type { ContentStores } from '../content/areas.js';
import { ContentRegistry, type ContentDeps } from '../content/registry.js';
import type { FirebasePorts } from '../firebase/ports.js';
import { unregisterOnSignOut } from '../inbox/push-device.js';
import type { PageRegistry } from '../routing/pages.js';
import { parseAdminRoute, type AdminRoute, type AdminRouteId } from '../routing/routes.js';
import { firstShown } from '../state/ui-language.js';
import { NO_GATE, type AdminState, type NoticeInput, type ShellStateAccess, type ThemeMode, type AccentChoice } from '../state/state.js';
import { storedTheme, themeIntents } from './theme-prefs.js';
import { Store } from '../state/store.js';
import type { AdminRuntime, FirebaseWebConfig } from './config.js';
import { contentServices } from './content-services.js';
import { measuredStore } from './field.js';
import { measureOf, startTelemetry, type TelemetryView } from './telemetry-wiring.js';
import { measuredCallables } from './field-actions.js';
import { chooseCity, cityRefresher, switchTo, type CityChoiceDeps } from './current-city.js';
import { Navigation } from './navigation.js';
import { rememberedSetupReady } from './setup-readiness.js';
import { consentWithRetry } from './consent-retry.js';
import { contributorWelcome, startLocale } from './welcome.js';
import { adminLanguage } from './language.js';
import { shellWatches, type ShellWatchSources } from './shell-watches.js';
import { destinationOf, RETURN_TO_KEY } from '../routing/router.js';
import type { Clock, HashLocation, KeyValueStore, PageVisibility, Unsubscribe } from './ports.js';
import { guardCallables, type AdminProject, type SetupModuleSpec, type ShellServices } from './services.js';
import type { AdminTelemetry, Measure } from './telemetry.js';

export { ACCENT_KEY, THEME_KEY, storedTheme, themeIntents } from './theme-prefs.js';

export type { TelemetryView };

export interface AdminDeps<Setup, SetupIntents> {
    /** §1.4 step 1. */
    readonly config: FirebaseWebConfig;
    /** §1.4 step 2. */
    readonly runtime: AdminRuntime;
    /** `infra/project.json` (§3.7). */
    readonly project: AdminProject;
    /** Auth, callables, Firestore, Storage (adapters in `packages/admin/src/firebase/`). */
    readonly firebase: FirebasePorts;
    /** Google consent (§2.2); the e2e build swaps only this port (§2.6). */
    readonly google: GoogleAuthPort;
    /** The Google REST clients' transport. */
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    /** `sessionStorage` (try/catch inside). */
    readonly session: KeyValueStore;
    /** `localStorage`: the language, the theme, the analytics consent. */
    readonly local: KeyValueStore;
    readonly location: HashLocation;
    readonly log: Logger;
    readonly visibility: PageVisibility;
    /** `navigator.languages`. */
    readonly languages: readonly string[];
    /** The pages besides Setup's (`registerAdminPage`). */
    readonly pages: PageRegistry;
    readonly telemetry: (view: TelemetryView) => AdminTelemetry;
    /** The Setup Assistant (`NO_SETUP` until setup-ui's module is wired). */
    readonly setup: SetupModuleSpec<Setup, SetupIntents>;
    /** The editors' areas (`docs/research/M2c-interfaces.md` §2); without it no area has a store. */
    readonly content?: ContentDeps;
    /** Finding 29 of 2026-10-31: whether Hosting serves a newer admin (`release-watch.ts`); none: nothing is watched. */
    readonly releases?: ShellWatchSources['releases'];
    /** Whether nobody uses the tab, for the self-reload into a newer admin (`activity.ts`); none: never idle. */
    readonly idle?: ShellWatchSources['idle'];
    /** The page's window, where the wizards' funnel signals arrive (`funnels.ts`, §200); none: no funnels. */
    readonly funnelWindow?: FunnelWindow;
}

export interface AdminIntents<SetupIntents> {
    signIn(): Promise<void>;
    /** Signs out; with an unsaved edit on screen the shell asks first (`leaving`). */
    signOut(): Promise<void>;
    /** The unsaved-changes question: keep editing. */
    stayOnPage(): void;
    /** The unsaved-changes question: discard, then go where the admin asked (or sign out). */
    leavePage(): Promise<void>;
    claim(): Promise<void>;
    join(): Promise<void>;
    /** Try again (`backendDown`). */
    retry(): Promise<void>;
    /** Enables the Google API the sign-in panel names, then checks again. */
    enableApi(): Promise<void>;
    reload(): void;
    navigate(route: AdminRoute): void;
    /**
     * M5 (`docs/research/M5-interfaces.md` §1.5): opens another of the admin's cities, a page load at its Home (or at
     * `route`: the New city flow's done screen); with an unsaved edit on screen the shell asks first (`leaving`).
     */
    switchCity(cityId: string, route?: AdminRoute): void;
    /**
     * M5: the city menu asks the server for the admin's cities again (at most once a minute); `now` asks at once (New city
     * just made one, which the menu lists without waiting out the minute).
     */
    refreshCities(now?: boolean): Promise<void>;
    setLocale(locale: UiLocale): void;
    setTheme(mode: ThemeMode): void;
    setAccent(accent: AccentChoice): void;
    /** Settings' live preview of a seed colour's tokens; null returns to the city's. */
    previewTheme(tokens: ThemeTokens | null): void;
    setConsent(consent: 'granted' | 'denied'): void;
    dismissNotice(): void;
    setWindowClass(windowClass: string): void;
    readonly setup: SetupIntents;
}

export interface AdminApp<Setup, SetupIntents> {
    readonly state: AdminState<Setup>;
    subscribe(listener: (state: AdminState<Setup>) => void): Unsubscribe;
    readonly intents: AdminIntents<SetupIntents>;
    /** The tag of a route's page element, once loaded (null: none); rejects when its chunk does not load (the shell offers Retry). */
    loadPage(id: AdminRouteId): Promise<string | null>;
    /** Crash reporting for the entry's global hooks and the elements' error boundaries. */
    readonly telemetry: AdminTelemetry;
    /** The editors' stores (`AdminAppPort.content`): each created when its page first reads it, all destroyed on sign-out. */
    readonly content: ContentStores;
    /** Whether an area holds an edit that leaving the page would lose (the entry's `beforeunload`). */
    hasUnsavedChanges(): boolean;
    destroy(): void;
}

function initialState<Setup>(deps: AdminDeps<Setup, unknown>): AdminState<Setup> {
    return {
        auth: 'starting',
        mode: null,
        user: null,
        role: null,
        busy: false,
        gate: NO_GATE,
        route: { id: 'setup', params: [] },
        destinations: [destinationOf('setup')],
        // A language beyond the bundled two shows once its texts are here (`shellIntents`, `adminLanguage`); English before.
        locale: firstShown(startLocale(deps.location, deps.local, deps.languages)),
        theme: storedTheme(deps.local),
        consent: 'unknown',
        analytics: false,
        windowClass: 'compact',
        notice: null,
        leaving: null,
        revoked: false,
        newRelease: null,
        people: {},
        unread: null,
        cities: [],
        cityId: null,
        projectOwner: false,
        setupReady: rememberedSetupReady(deps.local, deps.config.projectId),
        projectId: deps.config.projectId,
        authDomain: deps.config.authDomain,
        welcome: contributorWelcome(deps.location, deps.project.cities[0] ?? null),
        setup: deps.setup.initial,
    };
}

function shellAccess<Setup>(store: Store<AdminState<Setup>>): ShellStateAccess {
    let notices = 0;
    return {
        get: () => store.state,
        update: (patch) => {
            store.update(patch);
        },
        notice: (input) => {
            notices += 1;
            return { ...input, id: notices };
        },
    };
}

interface Parts<Setup> {
    readonly store: Store<AdminState<Setup>>;
    readonly shell: ShellStateAccess;
    readonly controller: AuthController;
    readonly google: GoogleAccessService;
    readonly navigation: Navigation;
    readonly telemetry: AdminTelemetry;
    readonly firebase: FirebasePorts;
    /** Whether an editor area holds an edit leaving would lose. */
    readonly unsaved: () => boolean;
    /** M5: opens another city (a page load). */
    readonly openCity: (cityId: string, route?: AdminRoute) => void;
    /** M5: the admin's cities asked again (`now`: whatever the last time was). */
    readonly refreshCities: (now?: boolean) => Promise<void>;
}

function servicesFor<Setup>(deps: AdminDeps<Setup, unknown>, parts: Parts<Setup>): ShellServices<Setup> {
    const notify = (notice: NoticeInput): void => {
        parts.store.update({ notice: parts.shell.notice(notice) });
    };
    return {
        ...{ config: deps.config, runtime: deps.runtime, project: deps.project, fetch: deps.fetch, clock: deps.clock },
        ...{ session: deps.session, visibility: deps.visibility, log: deps.log, firebase: parts.firebase },
        google: {
            // M18 item 2: a blocked window's notice carries a Try again whose own click opens it.
            request: consentWithRetry((scope) => parts.google.request(scope), notify),
            live: (scope, minRemainingMs) => parts.google.live(scope, minRemainingMs),
            drop: () => {
                parts.google.drop();
            },
        },
        getState: () => parts.store.state,
        subscribe: (listener) => parts.store.subscribe(listener),
        setSetup: (setup) => {
            parts.store.update({ setup });
        },
        notify,
        track: (event) => {
            parts.telemetry.track(event);
        },
        serverReady: () => parts.controller.serverReady(),
    };
}

/** M5: another of the admin's cities (an unsaved edit is asked about first), and the cities read again. */
function cityIntents<Setup>(
    parts: Parts<Setup>,
    update: (patch: Partial<AdminState<Setup>>) => void,
): Pick<AdminIntents<never>, 'switchCity' | 'refreshCities'> {
    return {
        switchCity: (cityId, route) => {
            if (parts.unsaved()) {
                update({ leaving: { kind: 'city', cityId } });
                return;
            }
            parts.openCity(cityId, route);
        },
        refreshCities: (now) => parts.refreshCities(now),
    };
}

function shellIntents<Setup>(deps: AdminDeps<Setup, unknown>, parts: Parts<Setup>): Omit<AdminIntents<never>, 'setup'> {
    const { controller, store } = parts;
    const update = (patch: Partial<AdminState<Setup>>): void => {
        store.update(patch);
    };
    // The first language beyond the bundled two is fetched now; the account menu's choice later (`adminLanguage`).
    const language = adminLanguage({ fetch: deps.fetch, local: deps.local, shell: parts.shell });
    void language.start(startLocale(deps.location, deps.local, deps.languages));
    return {
        signIn: () => controller.signIn(),
        signOut: () => {
            if (parts.unsaved()) {
                update({ leaving: { kind: 'signOut' } });
                return Promise.resolve();
            }
            return controller.signOut();
        },
        stayOnPage: () => {
            parts.navigation.stay();
        },
        leavePage: () => {
            const leaving = store.state.leaving;
            parts.navigation.leave();
            if (leaving?.kind === 'city') {
                parts.openCity(leaving.cityId);
            }
            return leaving?.kind === 'signOut' ? controller.signOut() : Promise.resolve();
        },
        claim: () => controller.claim(),
        join: () => controller.join(),
        retry: () => controller.retry(),
        enableApi: () => controller.enableApi(),
        reload: () => {
            deps.location.reload();
        },
        navigate: (route) => {
            parts.navigation.navigate(route);
        },
        ...cityIntents(parts, update),
        setLocale: (locale) => {
            void language.choose(locale);
        },
        ...themeIntents(deps.local, () => store.state.theme, update),
        previewTheme: (preview) => {
            update({ theme: { ...store.state.theme, preview } });
        },
        setConsent: (consent) => {
            parts.telemetry.setConsent(consent);
            update({ consent });
        },
        dismissNotice: () => {
            update({ notice: null });
        },
        setWindowClass: (windowClass) => {
            update({ windowClass });
        },
    };
}

/** `localStorage`'s note that this browser has had an answer from the project's server (a start-up deploy then probes). */
export const SERVER_SEEN_KEY = 'hcm:admin:serverSeen';

/** The note of `SERVER_SEEN_KEY` for `projectId`. */
export function serverMemory(local: KeyValueStore, projectId: string): { known(): boolean; remember(): void } {
    return {
        known: () => local.get(SERVER_SEEN_KEY) === projectId,
        remember: () => {
            local.set(SERVER_SEEN_KEY, projectId);
        },
    };
}

/** The auth controller of `mount` over the deploy's start-up flag and this browser's memory of the server. */
function authControllerOf<Setup, SetupIntents>(
    deps: AdminDeps<Setup, SetupIntents>,
    parts: { readonly google: GoogleAccessService; readonly shell: ShellStateAccess; readonly unsaved: () => boolean },
): AuthController {
    const projectId = deps.config.projectId;
    return new AuthController({
        ...{ auth: deps.firebase.auth, callables: deps.firebase.callables, session: deps.session, log: deps.log, ...parts },
        ownership: (token) => checkOwnership(deps.fetch, projectId, token),
        enableApi: (token, api) => enableService(deps.fetch, projectId, token, api),
        startUp: deps.runtime.startUp === true,
        serverSeen: serverMemory(deps.local, projectId),
        leaving: (uid) => unregisterOnSignOut({ local: deps.local, callables: deps.firebase.callables, uid }),
        cities: (session) => chooseCity(session, cityChoiceDeps(deps, parts.shell)),
        // M13 §3: the address, or the deep link kept while signed out, is the Contribute page.
        contributing: () => parseAdminRoute(deps.session.get(RETURN_TO_KEY) ?? deps.location.hash())?.id === 'contribute',
    });
}

/** What the city choice reads: the address, the kept deep link, this browser's memory, the `e2e` build's own city. */
function cityChoiceDeps<Setup>(deps: AdminDeps<Setup, unknown>, shell: ShellStateAccess): CityChoiceDeps {
    return {
        ...{ location: deps.location, session: deps.session, local: deps.local, preferred: deps.content?.cityId ?? null },
        uid: () => deps.firebase.auth.currentUser()?.uid ?? null,
        locale: () => shell.get().locale,
    };
}

interface CityOpener {
    readonly open: (cityId: string, route?: AdminRoute) => void;
    /** Another city is opening: the page reloads, and an edit the admin chose to discard asks nothing more. */
    readonly opening: () => boolean;
}

/** M5: opens another city once (a page load: the address changes, then the page reloads). */
function cityOpener<Setup>(deps: AdminDeps<Setup, unknown>): CityOpener {
    let opening = false;
    return {
        open: (cityId, route) => {
            if (opening) {
                return;
            }
            opening = true;
            switchTo(deps.location, deps.local, { uid: deps.firebase.auth.currentUser()?.uid ?? null, cityId, route });
        },
        opening: () => opening,
    };
}

/** Builds the app and starts it (the probe unless a start-up deploy, then Firebase Auth's user); returns at once. */
export function mount<Setup, SetupIntents>(deps: AdminDeps<Setup, SetupIntents>): AdminApp<Setup, SetupIntents> {
    const store = new Store<AdminState<Setup>>(initialState(deps), deps.log);
    const shell = shellAccess(store);
    const { telemetry, stop: stopTelemetry } = startTelemetry(deps, store);
    const google = new GoogleAccessService({
        port: deps.google,
        store: new GoogleAccessStore(() => deps.clock.now()),
        currentUser: () => deps.firebase.auth.currentUser(),
        locale: () => store.state.locale,
    });
    // The editors' registry is made below (it needs the controller); the controller asks it only once the app runs.
    const controller = authControllerOf(deps, { google, shell, unsaved: () => content.hasUnsavedChanges() });
    const denied = (): void => {
        void controller.accessDenied();
    };
    const firebase: FirebasePorts = { ...deps.firebase, callables: guardCallables(deps.firebase.callables, denied) };
    const track = telemetry.track.bind(telemetry);
    const content = contentRegistry(deps, { shell, callables: firebase.callables, denied, measure: measureOf(telemetry), google });
    const { open: openCity, opening } = cityOpener(deps);
    // Once another city opens (its address set, the page reloading), an edit the admin chose to discard holds nothing back.
    const unsaved = (): boolean => !opening() && content.hasUnsavedChanges();
    const navigation = new Navigation({
        ...{ shell, location: deps.location, session: deps.session, pages: deps.pages },
        ...{ track, unsaved, switchCity: openCity },
    });
    // M18 item 1: the self-reload also waits for an upload still being sent, which the unsaved guard does not ask about.
    const held = (): boolean => unsaved() || content.busy();
    const sources = { ...deps, store: deps.content?.store ?? null, states: store, stores: content.stores, unsaved: held };
    const watches = shellWatches(sources, shell, denied);
    const stopWatching = store.subscribe((state) => {
        watches.stateChanged(state);
        navigation.stateChanged(state);
        if (state.auth !== 'admin' && state.auth !== 'visitor') {
            content.destroyAll();
        }
    });
    const refreshCities = cityRefresher({ callables: firebase.callables, shell, clock: deps.clock, log: deps.log });
    const parts: Parts<Setup> = { store, shell, controller, google, navigation, telemetry, firebase, unsaved, openCity, refreshCities };
    const intents: AdminIntents<SetupIntents> = { ...shellIntents(deps, parts), setup: deps.setup.create(servicesFor(deps, parts)) };
    controller.start().catch((error: unknown) => {
        deps.log.error('admin start failed', { error: String(error) });
    });
    return {
        get state() {
            return store.state;
        },
        subscribe: (listener) => store.subscribe(listener),
        intents,
        loadPage: (id) => deps.pages.load(id),
        telemetry,
        content: content.stores,
        hasUnsavedChanges: unsaved,
        destroy: () => {
            stopWatching();
            stopTelemetry();
            controller.stop();
            navigation.stop();
            watches.stop();
            content.destroyAll();
        },
    };
}

/** The editors' stores over the entry's `ContentDeps` and the shell's services (none without `deps.content`). */
function contentRegistry<Setup>(
    deps: AdminDeps<Setup, unknown>,
    parts: {
        readonly shell: ShellStateAccess;
        readonly callables: FirebasePorts['callables'];
        readonly denied: () => void;
        /** §76: the editors' writes and the jobs' ends are measured (`field.ts`). */
        readonly measure: Measure;
        /** §203: the shell's Google consent, for the Statistics view's numbers. */
        readonly google: GoogleAccessService;
    },
): ContentRegistry {
    const content = deps.content;
    if (content === undefined) {
        return new ContentRegistry({}, () => {
            throw new Error('no content services');
        });
    }
    const { measure, google, ...shellParts } = parts;
    const statistics = (cityId: () => string): StatisticsSource =>
        statisticsSourceOf({
            ...{ google, callables: parts.callables, cityId, measure },
            ...{ fetch: deps.fetch, clock: deps.clock, log: deps.log },
        });
    const store = measuredStore(content.store, { measure, now: () => globalThis.performance.now(), epoch: () => deps.clock.now() });
    const callables = measuredCallables(shellParts.callables, measure, () => globalThis.performance.now());
    const services = contentServices({
        ...shellParts,
        callables,
        statistics,
        content: { ...content, store },
        ...{ cities: deps.project.cities, firstCity: deps.project.firstCity },
        ...{ clock: deps.clock, local: deps.local, log: deps.log },
    });
    return new ContentRegistry(content.modules, () => services);
}
