import { describe, expect, it, vi } from 'vitest';

import { EMULATOR_PORTS, firebaseOptions, FUNCTIONS_REGION, initFirebase, loadAnalyticsSdk } from '../../src/firebase/app.js';
import { firebaseSdk, type FirebaseSdk } from '../../src/firebase/sdk.js';
import { E2E_WEB_CONFIG } from '../app/fakes.js';

/** The SDK table with every function the app uses recorded. */
function fakeSdk() {
    const calls: string[] = [];
    const record =
        (name: string, result: unknown = { name }) =>
        (...args: unknown[]) => {
            calls.push([name, ...args.slice(1).map((arg) => JSON.stringify(arg))].join(' '));
            return result;
        };
    class Provider {
        readonly key: string;

        constructor(key: string) {
            this.key = key;
            calls.push(`provider ${key}`);
        }
    }
    const sdk = {
        initializeApp: record('initializeApp', { app: true }),
        initializeAppCheck: record('initializeAppCheck'),
        ReCaptchaEnterpriseProvider: Provider,
        initializeAuth: record('initializeAuth', { auth: true }),
        browserSessionPersistence: 'session',
        indexedDBLocalPersistence: 'indexedDB',
        browserLocalPersistence: 'local',
        browserPopupRedirectResolver: 'popup',
        getFunctions: record('getFunctions', { functions: true }),
        getFirestore: record('getFirestore', { firestore: true }),
        getStorage: record('getStorage', { storage: true }),
        connectAuthEmulator: record('connectAuthEmulator'),
        connectFunctionsEmulator: record('connectFunctionsEmulator'),
        connectFirestoreEmulator: record('connectFirestoreEmulator'),
        connectStorageEmulator: record('connectStorageEmulator'),
    };
    return { sdk: sdk as unknown as FirebaseSdk, calls };
}

/** The admin's own site (§210). */
const ADMIN_ORIGIN = 'https://demo-hcm-admin.web.app';

/** Auth in the tab's sessionStorage (finding 1 of the M6 security review). */
const AUTH = 'initializeAuth {"persistence":"session"}';

describe('initFirebase', () => {
    it('happyPath_productionWithAnAppCheckKeyAndLazyFirestoreAndStorage', () => {
        const { sdk, calls } = fakeSdk();

        const handles = initFirebase(
            sdk,
            { ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' },
            { release: 'r', appCheckSiteKey: '6Le2e-key-001' },
            { emulators: false, origin: ADMIN_ORIGIN },
        );

        expect(calls).toEqual([
            'initializeApp',
            'provider 6Le2e-key-001',
            'initializeAppCheck {"provider":{"key":"6Le2e-key-001"},"isTokenAutoRefreshEnabled":true}',
            AUTH,
            `getFunctions "${FUNCTIONS_REGION}"`,
        ]);
        expect(handles.firestore()).toBe(handles.firestore());
        expect(handles.storage()).toEqual({ storage: true });
        expect(calls.slice(5)).toEqual(['getFirestore', 'getStorage']);
    });

    it('happyPath_theE2eBuildUsesTheEmulatorsAndNoAppCheck', () => {
        const { sdk, calls } = fakeSdk();

        const handles = initFirebase(
            sdk,
            E2E_WEB_CONFIG,
            { release: 'e2e', appCheckSiteKey: '6Le2e-key-001' },
            { emulators: true, origin: ADMIN_ORIGIN },
        );
        handles.firestore();
        handles.storage();

        expect(calls).toEqual([
            'initializeApp',
            AUTH,
            `getFunctions "${FUNCTIONS_REGION}"`,
            `connectAuthEmulator "http://127.0.0.1:${String(EMULATOR_PORTS.auth)}" {"disableWarnings":true}`,
            `connectFunctionsEmulator "127.0.0.1" ${String(EMULATOR_PORTS.functions)}`,
            'getFirestore',
            `connectFirestoreEmulator "127.0.0.1" ${String(EMULATOR_PORTS.firestore)}`,
            'getStorage',
            `connectStorageEmulator "127.0.0.1" ${String(EMULATOR_PORTS.storage)}`,
        ]);
    });

    it('badPath_theSignInIsNeverKeptWhereTheWholeOriginReadsIt', () => {
        const { sdk, calls } = fakeSdk();

        initFirebase(sdk, E2E_WEB_CONFIG, { release: 'r' }, { emulators: false, origin: ADMIN_ORIGIN });

        // Not getAuth: its default persistence is the origin's IndexedDB, which the public map's pages share since M6.
        expect(calls.filter((call) => call.startsWith('initializeAuth') || call.startsWith('getAuth'))).toEqual([AUTH]);
    });

    it('happyPath_onTheAdminsOwnSiteTheSignInIsTheOriginsForEveryTab', () => {
        const { sdk, calls } = fakeSdk();

        initFirebase(sdk, E2E_WEB_CONFIG, { release: 'r', adminOrigin: ADMIN_ORIGIN }, { emulators: false, origin: ADMIN_ORIGIN });

        // §210: no public map page shares this origin, so every tab finds the sign-in in its IndexedDB (localStorage without it).
        expect(calls.filter((call) => call.startsWith('initializeAuth'))).toEqual(['initializeAuth {"persistence":["indexedDB","local"]}']);
    });

    it('badPath_aRuntimeNamingAnotherOriginKeepsTheSignInInTheTab', () => {
        const { sdk, calls } = fakeSdk();

        // The public map's `/admin/` (or a copy of the admin's files anywhere else) is not the admin's own site.
        initFirebase(
            sdk,
            E2E_WEB_CONFIG,
            { release: 'r', adminOrigin: ADMIN_ORIGIN },
            { emulators: false, origin: 'https://demo-hcm.web.app' },
        );

        expect(calls.filter((call) => call.startsWith('initializeAuth'))).toEqual([AUTH]);
    });

    it('badPath_withoutASiteKeyThereIsNoAppCheck', () => {
        const { sdk, calls } = fakeSdk();

        initFirebase(sdk, E2E_WEB_CONFIG, { release: 'r' }, { emulators: false, origin: ADMIN_ORIGIN });

        expect(calls).not.toContain('initializeAppCheck');
    });
});

describe('firebaseOptions', () => {
    it('happyPath_absentKeysAreLeftOut', () => {
        const { storageBucket, ...noBucket } = E2E_WEB_CONFIG;
        expect(storageBucket).toBe('demo-hcm.firebasestorage.app');

        expect(firebaseOptions(noBucket)).toEqual(noBucket);
        expect(firebaseOptions({ ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' })).toEqual({
            ...E2E_WEB_CONFIG,
            measurementId: 'G-E2E0000000',
        });
        expect(Object.keys(firebaseOptions(noBucket))).not.toContain('storageBucket');
    });
});

describe('the SDK modules', () => {
    it('happyPath_theRealTablesHoldTheSdksFunctions', async () => {
        const analytics = await loadAnalyticsSdk();

        // Auth's persistence and popup resolver are SDK values, not calls (Node's build of firebase/auth stubs the resolver).
        const { browserPopupRedirectResolver, ...calls } = firebaseSdk;
        expect(Object.values(calls).every((value) => typeof value === 'function')).toBe(true);
        expect(browserPopupRedirectResolver).toBeDefined();
        expect(Object.keys(analytics).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
            'initializeAnalytics',
            'isSupported',
            'logEvent',
            'setAnalyticsCollectionEnabled',
            'setConsent',
        ]);
        await expect(analytics.isSupported()).resolves.toBe(false);
        expect(vi.isMockFunction(analytics.logEvent)).toBe(false);
    });

    it('happyPath_theTestsAndTheE2eBuildConnectToTheEmulators_badPath_theProductionBuildCarriesNoConnector', async () => {
        // DECISIONS-for-review.md §81e: production's table holds a refusal instead, so the bundler drops the connectors.
        const { connectAuthEmulator } = await import('firebase/auth');
        expect(firebaseSdk.connectAuthEmulator).toBe(connectAuthEmulator);
        vi.stubEnv('MODE', 'production');
        vi.resetModules();
        try {
            const production = (await import('../../src/firebase/sdk.js')).firebaseSdk;
            const connectors = [
                production.connectAuthEmulator,
                production.connectFunctionsEmulator,
                production.connectFirestoreEmulator,
                production.connectStorageEmulator,
            ];
            expect(connectors.every((connect) => connect !== connectAuthEmulator)).toBe(true);
            expect(() => {
                production.connectStorageEmulator({} as never, '127.0.0.1', 9199);
            }).toThrow('connects to no emulator');
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
});
