// The entry's wiring, in Node: the real Firebase SDK is initialized (the emulator and the production settings) but never
// called, and every browser part is a plain object; no request leaves the test.
import { createFakeFetch, E2E_PROJECT_CONFIG, jsonResponse } from '@hcm/test-support/fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_KEY } from '../src/app/telemetry.js';
import { createStandInPopup, STAND_IN_ORIGIN } from '../src/auth/stand-in.js';
import {
    analyticsFor,
    autoStart,
    browserDeps,
    browserParts,
    contentDepsFor,
    E2E_KIT,
    e2eCity,
    e2eMapToken,
    guardUnload,
    loadColourLibrary,
    projectOf,
    registerAdminPage,
    startAdmin,
    telemetryFor,
    type AdminScope,
    type AdminWindow,
} from '../src/index.js';
import { ADMIN_ROUTES, type AdminRouteId } from '../src/routing/routes.js';
import { E2E_WEB_CONFIG, settle, testLog } from './app/fakes.js';

class MemoryStorage implements Storage {
    readonly #values = new Map<string, string>();

    get length(): number {
        return this.#values.size;
    }

    clear(): void {
        this.#values.clear();
    }

    getItem(key: string): string | null {
        return this.#values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.#values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.#values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.#values.set(key, value);
    }
}

function fakeWindow(files: Readonly<Record<string, Response>> = {}) {
    const target = new EventTarget();
    const cookies: string[] = [];
    const fetcher = createFakeFetch((request) => {
        const response = files[request.url.pathname];
        return response === undefined
            ? { operation: 'post', response: new Response(null, { status: 204 }) }
            : { operation: request.url.pathname, response };
    });
    const popup = { closed: false };
    const document = Object.defineProperty(Object.assign(new EventTarget(), { visibilityState: 'visible' }), 'cookie', {
        get: () => 'hcm_admin_ga=GA1.1.1; _ga=GA1.1.2',
        set: (value: string) => {
            cookies.push(value);
        },
    });
    const win = Object.assign(target, {
        document,
        navigator: { languages: ['en-US'] },
        sessionStorage: new MemoryStorage(),
        localStorage: new MemoryStorage(),
        innerWidth: 1440,
        innerHeight: 900,
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetcher.fetch(new URL(input instanceof Request ? input.url : input, 'https://demo-hcm.web.app'), init),
        setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
        clearTimeout: (handle: number) => {
            clearTimeout(handle);
        },
        open: vi.fn(() => popup),
        location: {
            hash: '',
            search: '?test=spec-1',
            origin: 'https://demo-hcm.web.app',
            pathname: '/',
            hostname: 'demo-hcm.web.app',
            reload: vi.fn(),
        },
        history: { pushState: vi.fn(), replaceState: vi.fn() },
    });
    return { win: win as unknown as AdminWindow, target, fetcher, cookies, popup };
}

/** The `e2e` build's kit, as `E2E_KIT` is in that build. */
const E2E = { standInPopup: createStandInPopup, city: e2eCity, mapToken: e2eMapToken };

/** One configuration for every test: Firebase keeps one default app per process. */
const CONFIG = { ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' };

/** Each editor route's page element. */
const PAGE_TAGS: Readonly<Record<Exclude<AdminRouteId, 'setup'>, string>> = {
    home: 'hcm-home-page',
    photos: 'hcm-photos-page',
    pois: 'hcm-pois-page',
    layers: 'hcm-layers-page',
    imagery: 'hcm-imagery-page',
    jobs: 'hcm-jobs-page',
    inbox: 'hcm-inbox-page',
    settings: 'hcm-settings-page',
    admins: 'hcm-admins-page',
    history: 'hcm-history-page',
    crashes: 'hcm-crashes-list-page',
    georef: 'hcm-georef-page',
    cities: 'hcm-new-city-page',
    review: 'hcm-review-page',
    contribute: 'hcm-contribute-page',
    stories: 'hcm-stories-page',
    help: 'hcm-tiles-page',
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the entry', () => {
    it('happyPath_importingItInNodeStartsNothing', () => {
        expect(E2E_KIT).toBeNull();
        expect(projectOf(E2E_WEB_CONFIG)).toEqual({ projectId: 'demo-hcm', cities: ['bucharest'] });
    });

    it('happyPath_everyEditorRouteLoadsItsOwnPage', async () => {
        // Before any test registers a page of its own: the loaders the entry's sections register.
        const deps = browserDeps(browserParts(fakeWindow().win, E2E, testLog().log))(CONFIG, { release: 'e2e' }, null);
        const editors = ADMIN_ROUTES.filter((id) => id !== 'setup');

        // Each area's page is a lazy chunk (DECISIONS-for-review.md §34b): loading it registers its store module and its element.
        await expect(Promise.all(editors.map((id) => deps.pages.load(id)))).resolves.toEqual(editors.map((id) => PAGE_TAGS[id]));
        expect(new Set(Object.keys(deps.content?.modules ?? {}))).toEqual(new Set(editors));
        expect(globalThis.customElements.get('hcm-photos-page')).toBeDefined();
    });

    it('happyPath_leavingThePageWithAnUnsavedEditAsksTheBrowsersQuestion', () => {
        const target = new EventTarget();
        let unsaved = false;
        guardUnload(target as never, { hasUnsavedChanges: () => unsaved });

        const quiet = new Event('beforeunload', { cancelable: true });
        target.dispatchEvent(quiet);
        unsaved = true;
        const asked = new Event('beforeunload', { cancelable: true });
        target.dispatchEvent(asked);

        expect([quiet.defaultPrevented, asked.defaultPrevented]).toEqual([false, true]);
    });

    it('badPath_aColourLibraryThatDoesNotLoadIsLogged', async () => {
        const { log, recording } = testLog();

        await loadColourLibrary(log, () => Promise.reject(new Error('offline')));

        expect(recording.records.at(-1)).toMatchObject({ level: 'error', message: 'the colour library did not load' });
    });

    it('happyPath_theEditorsStoreStampsWithTheSignedInUid', async () => {
        const parts = browserParts(fakeWindow().win, E2E, testLog().log);
        const runtime = { release: '1.0.0+abc1234', releaseTime: 1_761_955_200 };
        const signedOut = contentDepsFor(parts, { firestore: () => ({}), auth: { currentUser: null } } as never, fetch, runtime);
        const signedIn = contentDepsFor(parts, { firestore: () => ({}), auth: { currentUser: { uid: 'owner-uid' } } } as never, fetch, {
            release: 'dev',
        });

        await expect(signedOut.store.batch([])).resolves.toEqual({ ok: false, reason: 'denied' });
        await expect(signedIn.store.batch([])).rejects.toThrow();
        // Finding 39: Home reads the recorded installs against the admin's own release and build time.
        expect([signedOut.areas.adminRelease, signedIn.areas.adminRelease]).toEqual([
            { release: '1.0.0+abc1234', time: 1_761_955_200 },
            { release: 'dev', time: null },
        ]);
    });

    it('happyPath_theE2eBuildEditsTheTestsOwnCity', () => {
        const w = fakeWindow();
        Object.assign(w.win.location, { search: '?test=spec-1&city=e2e-photos-1' });

        const deps = browserDeps(browserParts(w.win, E2E, testLog().log))(CONFIG, { release: 'e2e' }, null);

        expect(deps.content?.cityId).toBe('e2e-photos-1');
        expect([e2eCity('?city=Not_Valid'), e2eCity(''), e2eCity('?city=cluj')]).toEqual([null, null, 'cluj']);
    });

    it('happyPath_theE2eBuildTakesTheMapTokenOfTheTestsCity', () => {
        expect([
            e2eMapToken('?city=cluj&mapToken=pk.e2e-fake-token'),
            e2eMapToken('?mapToken=none'),
            e2eMapToken('?mapToken=sk.secret'),
            e2eMapToken('?mapToken=pk.'),
            e2eMapToken('?city=cluj'),
        ]).toEqual(['pk.e2e-fake-token', null, null, null, undefined]);
    });

    it('happyPath_theE2eBuildWiresTheEmulatorsAndTheOauthStandIn', async () => {
        const w = fakeWindow();
        const parts = browserParts(w.win, E2E, testLog().log);
        registerAdminPage('photos', () => Promise.resolve('hcm-photos-page'));

        const deps = browserDeps(parts)(CONFIG, { release: 'e2e' }, null);
        const consent = deps.google.request('cloudReadOnly', {});
        w.target.dispatchEvent(
            Object.assign(new Event('message'), { origin: STAND_IN_ORIGIN, source: w.popup, data: { cancelled: true } }),
        );

        await expect(consent).rejects.toMatchObject({ failure: 'popupClosed' });
        expect(new URL(String(vi.mocked(w.win.open).mock.calls[0]?.[0])).searchParams.get('test')).toBe('spec-1');
        await expect(deps.pages.load('admins')).resolves.toBe('hcm-admins-page');
        await expect(deps.pages.load('crashes')).resolves.toBe('hcm-crashes-list-page');
        await expect(deps.pages.load('home')).resolves.toBe('hcm-home-page');
        expect(deps.content?.cityId).toBeNull();
        expect(Object.keys(deps.content?.modules ?? {})).toEqual(expect.arrayContaining(['home', 'admins', 'history', 'jobs', 'crashes']));
        expect(deps.content?.store.newId()).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(() => deps.content?.theme('#6750a4')).toThrow('not loaded');
        await expect(deps.fetch('/runtime.json')).resolves.toMatchObject({ status: 204 });
        expect(deps.pages.has('photos')).toBe(true);
        expect(deps.languages).toEqual(['en-US']);
        expect(deps.visibility.visible()).toBe(true);
    });

    it('happyPath_crashesArePostedToTheEmulatorsEndpointAndAWithdrawalExpiresCookies', async () => {
        const w = fakeWindow();
        const deps = browserDeps(browserParts(w.win, E2E, testLog().log))(CONFIG, { release: 'e2e' }, null);

        const telemetry = deps.telemetry({
            locale: () => 'en',
            windowClass: () => 'large',
            serverAnswers: () => true,
            role: () => 'owner',
        });
        w.target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }));
        telemetry.setConsent('granted');
        telemetry.setConsent('denied');
        await settle();

        const post = w.fetcher.calls.find((call) => call.method === 'POST');
        expect(post?.url).toBe('http://127.0.0.1:5001/demo-hcm/us-central1/telemetry-reportError');
        expect(post?.headers['content-type']).toBe('text/plain');
        expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
            message: 'Error: boom',
            release: 'e2e',
            windowClass: 'large',
            locale: 'en',
        });
        expect(w.win.localStorage.getItem(CONSENT_KEY)).toBe('denied');
        expect(w.cookies).toHaveLength(2);
    });

    it('happyPath_aProjectFileBringsTheSetupAssistantAndItsPages', async () => {
        const w = fakeWindow();
        Object.assign(w.win.document, { baseURI: 'https://demo-hcm.web.app/' });
        const project = {
            ...E2E_PROJECT_CONFIG,
            cities: [...E2E_PROJECT_CONFIG.cities],
            viewerOrigins: [...E2E_PROJECT_CONFIG.viewerOrigins],
        };

        const deps = browserDeps(browserParts(w.win, E2E, testLog().log))(CONFIG, { release: 'e2e' }, project);

        expect(deps.project).toBe(project);
        expect(deps.setup.initial).toBeNull();
        await expect(deps.pages.load('setup')).resolves.toBe('hcm-setup-page');
    });
});

describe('the entry: sign-in, telemetry and start', () => {
    it('badPath_anAddressWithoutATestIdGivesTheStandInAnEmptyOne', async () => {
        const w = fakeWindow();
        Object.assign(w.win.location, { search: '' });
        vi.mocked(w.win.open).mockReturnValue(null);
        const deps = browserDeps(browserParts(w.win, E2E, testLog().log))(CONFIG, { release: 'e2e' }, null);

        await expect(deps.google.request(null, {})).rejects.toMatchObject({ failure: 'popupBlocked' });
        expect(new URL(String(vi.mocked(w.win.open).mock.calls[0]?.[0])).searchParams.get('test')).toBe('');
    });

    it('happyPath_productionUsesFirebasesPopup', async () => {
        const w = fakeWindow();
        const deps = browserDeps(browserParts(w.win, null, testLog().log))(CONFIG, { release: 'r1' }, null);

        await expect(deps.google.request(null, {})).rejects.toMatchObject({ failure: 'failed' });
        expect(w.win.open).not.toHaveBeenCalled();
        const telemetry = deps.telemetry({
            locale: () => 'ro',
            windowClass: () => 'compact',
            serverAnswers: () => false,
            role: () => null,
        });
        telemetry.reportError(new Error('before the server'), { fatal: false, source: 'window' });
        expect(w.fetcher.calls.filter((call) => call.method === 'POST')).toEqual([]);
    });

    it('badPath_withoutAMeasurementIdThereIsNoGa4', () => {
        const parts = browserParts(fakeWindow().win, E2E, testLog().log);

        parts.session.set('hcm:admin:returnTo', '#/admins');

        const telemetry = telemetryFor(
            parts,
            { app: {} as never },
            E2E_WEB_CONFIG,
            'e2e',
        )({
            locale: () => 'ro',
            windowClass: () => 'compact',
            serverAnswers: () => true,
            role: () => null,
        });
        telemetry.reportError(new Error('without GA4'), { fatal: false, source: 'window' });

        expect(telemetry.available).toBe(false);
        expect(analyticsFor(undefined, {} as never, parts, { release: '1.2.0' })).toBeNull();
        const ga4 = analyticsFor('G-E2E0000000', {} as never, parts, { release: '1.2.0' });
        expect(ga4).not.toBeNull();
        // Without consent a field measurement goes nowhere (its context is still the window's class and the release).
        ga4?.field('admin_ready', { duration_ms: 1, restored: true });
        expect(browserDeps(parts)(CONFIG, { release: 'e2e' }, null).setup.create({} as never)).toBeNull();
        expect(parts.session.get('hcm:admin:returnTo')).toBe('#/admins');
    });

    it('badPath_startingWithoutAConfigurationShowsItsScreen', async () => {
        const w = fakeWindow();
        const shell: { app: unknown } = { app: null };

        await startAdmin(browserParts(w.win, null, testLog().log), shell as never);

        expect((shell.app as { state: { auth: string } }).state.auth).toBe('configMissing');
    });

    it('happyPath_theConfigurationIsReadFromHosting', async () => {
        const w = fakeWindow({
            '/__/firebase/init.json': new Response('{}', { status: 404 }),
            '/runtime.json': jsonResponse({ release: 'x' }),
        });
        const shell: { app: unknown } = { app: null };

        await startAdmin(browserParts(w.win, E2E, testLog().log), shell as never);

        expect(w.fetcher.calls[0]?.url).toBe('https://demo-hcm.web.app/__/firebase/init.json');
    });
});

describe('autoStart', () => {
    function scope(readyState: DocumentReadyState, existing: boolean) {
        const w = fakeWindow();
        const shell = { app: null as unknown };
        const appended: unknown[] = [];
        const faces: unknown[] = [];
        const document = Object.assign(new EventTarget(), {
            readyState,
            baseURI: 'https://demo-hcm.web.app/',
            fonts: { add: (face: unknown) => faces.push(face) },
            querySelector: () => (existing ? shell : null),
            createElement: () => shell,
            body: {
                appendChild: (node: unknown) => {
                    appended.push(node);
                    return node;
                },
            },
        });
        const defined: string[] = [];
        const registry = { get: () => undefined, define: (tag: string) => defined.push(tag) };
        class Face {
            readonly family: string;

            constructor(family: string) {
                this.family = family;
            }
        }
        const adminScope = { document, customElements: registry, FontFace: Face } as unknown as AdminScope;
        return { w, shell, appended, faces, defined, document, adminScope };
    }

    it('happyPath_aParsedPageStartsInItsShell', async () => {
        const s = scope('complete', true);

        autoStart(s.adminScope, s.w.win, null, testLog().log);
        await settle(40);

        expect(s.defined).toContain('hcm-admin-shell');
        expect(s.faces.length).toBeGreaterThan(0);
        expect(s.appended).toEqual([]);
        expect((s.shell.app as { state: { auth: string } } | null)?.state.auth).toBe('configMissing');
    });

    it('happyPath_aPageStillLoadingStartsOnceParsedAndGetsAShellWhenItHasNone', async () => {
        const s = scope('loading', false);

        autoStart(s.adminScope, s.w.win, null, testLog().log);
        expect(s.shell.app).toBeNull();
        s.document.dispatchEvent(new Event('DOMContentLoaded'));
        await settle(40);

        expect(s.appended).toEqual([s.shell]);
        expect(s.shell.app).not.toBeNull();
    });

    it('badPath_withoutADocumentNothingHappens', () => {
        const s = scope('complete', true);

        autoStart({}, s.w.win, null, testLog().log);

        expect(s.defined).toEqual([]);
    });
});
