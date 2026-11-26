/**
 * The admin's Firebase app (`docs/research/M2b-interfaces.md` §1.4 step 3): `initializeApp` with the web configuration,
 * App Check (reCAPTCHA Enterprise) only when `runtime.json` names a site key (never in start-up mode, the e2e build or
 * the first deploys), and in the `e2e` build Auth, Firestore, Storage and Functions on the emulators. Firestore and
 * Storage are created on first use, so start-up mode touches neither.
 *
 * Where Auth keeps the signed-in owner depends on the origin (`DECISIONS-for-review.md` §73a, §210):
 * - on the admin's own site (`https://<project>-admin.web.app/admin/`, `runtime.json`'s `adminOrigin` naming the page's
 *   origin: `../app/admin-site.ts`), no public map page shares the origin, so the sign-in lives in its IndexedDB: one
 *   sign-in for every tab, kept when the browser closes (`localStorage` where IndexedDB is not available; a sign-in found
 *   there moves to IndexedDB);
 * - under the public map's `/admin/` (a project without that site), the tab's `sessionStorage` only (M6, finding 1 of
 *   the security review): IndexedDB and `localStorage` are the whole origin's, so a script on any viewer page could read
 *   the owner's refresh token there; `sessionStorage` belongs to the one tab, at the price of one sign-in per tab.
 */
import type { FieldChunk } from '@hcm/shared';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth, Persistence } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { FirebaseStorage } from 'firebase/storage';

import { onOwnSite } from '../app/admin-site.js';
import type { AdminRuntime, FirebaseWebConfig } from '../app/config.js';
import type { AnalyticsSdk } from './analytics.js';
import type { FirebaseSdk } from './sdk.js';

/** The emulators of `firebase.json` (project `demo-hcm`). */
const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 } as const;

/** The functions' region (`functions/src/global-options.ts`). */
export const FUNCTIONS_REGION = 'us-central1';

export interface FirebaseHandles {
    readonly app: FirebaseApp;
    readonly auth: Auth;
    readonly functions: Functions;
    readonly firestore: () => Firestore;
    readonly storage: () => FirebaseStorage;
}

function once<T>(create: () => T): () => T {
    let value: { readonly made: T } | null = null;
    return () => {
        value ??= { made: create() };
        return value.made;
    };
}

/** `initializeApp`'s options: the web configuration without its absent keys. */
export function firebaseOptions(config: FirebaseWebConfig): FirebaseOptions {
    const { storageBucket, measurementId, ...required } = config;
    return {
        ...required,
        ...(storageBucket === undefined ? {} : { storageBucket }),
        ...(measurementId === undefined ? {} : { measurementId }),
    };
}

/** Where Auth keeps the owner: the origin's IndexedDB (or `localStorage`) on the admin's own site, else the tab's `sessionStorage` (§210). */
function persistenceFor(sdk: FirebaseSdk, runtime: AdminRuntime, origin: string): Persistence | Persistence[] {
    return onOwnSite(runtime, origin) ? [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence] : sdk.browserSessionPersistence;
}

/** Where the app runs: `emulators` is the `e2e` build mode, `origin` the page's. */
export interface FirebasePage {
    readonly emulators: boolean;
    readonly origin: string;
}

/** The app and its services. */
export function initFirebase(sdk: FirebaseSdk, config: FirebaseWebConfig, runtime: AdminRuntime, page: FirebasePage): FirebaseHandles {
    const { emulators, origin } = page;
    const app = sdk.initializeApp(firebaseOptions(config));
    const siteKey = runtime.appCheckSiteKey;
    if (siteKey !== undefined && !emulators) {
        sdk.initializeAppCheck(app, { provider: new sdk.ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    }
    // The popup's resolver goes with each popup (`adapters.ts` `firebasePopup`).
    const auth = sdk.initializeAuth(app, { persistence: persistenceFor(sdk, runtime, origin) });
    const functions = sdk.getFunctions(app, FUNCTIONS_REGION);
    if (emulators) {
        sdk.connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${String(EMULATOR_PORTS.auth)}`, { disableWarnings: true });
        sdk.connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
    }
    const firestore = once(() => {
        const created = sdk.getFirestore(app);
        if (emulators) {
            sdk.connectFirestoreEmulator(created, EMULATOR_HOST, EMULATOR_PORTS.firestore);
        }
        return created;
    });
    const storage = once(() => {
        const created = sdk.getStorage(app);
        if (emulators) {
            sdk.connectStorageEmulator(created, EMULATOR_HOST, EMULATOR_PORTS.storage);
        }
        return created;
    });
    return { app, auth, functions, firestore, storage };
}

/** The lazily imported field chunk (§76: web-vitals and the event guard), fetched with the analytics module. */
export async function loadFieldSdk(): Promise<FieldChunk> {
    const module = await import('./field-sdk.js');
    return module.fieldSdk;
}

/** The lazily imported analytics module. */
export async function loadAnalyticsSdk(): Promise<AnalyticsSdk<FirebaseApp>> {
    const module = await import('./analytics-sdk.js');
    return module.analyticsSdk as unknown as AnalyticsSdk<FirebaseApp>;
}
