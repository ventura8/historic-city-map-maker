/**
 * Web push on this browser (`docs/research/M4-interfaces.md` §5.4) behind the `PushRegistrar` port: the Notifications
 * API's permission (the browser's own prompt, only from the admin's click) and the FCM registration of the admin's
 * service worker (`firebase-messaging-sw.js` beside the page, written by the admin's site build: it shows a pushed
 * notification as text and opens its admin page). The registration is an FCM registration token (`getToken`, sent as
 * `message.token`): finding 50 of 2026-11-01 (DECISIONS-for-review.md §81d) left the installation id of `register`, which
 * FCM's dry run called unregistered live; firebase 13 marks `getToken` deprecated, which `eslint.config.js` allows in
 * `messaging-sdk.ts` only (the user's approval). The FCM SDK is a chunk of its own,
 * loaded on the first registration. UNVERIFIED (§10): that FCM accepts registrations made with the SDK's default VAPID
 * key, so none is configured here.
 *
 * The `e2e` build's stand-in (`standInPush`) keeps the browser's real permission (Playwright grants or denies it) and
 * hands out a fixed token per test, since no browser test may reach FCM: the server side is the fake FCM.
 *
 * M6 (`docs/research/M6-interfaces.md` §2.3, S-A58-BAD-OLD-SERVICE-WORKER): the admin moved from the Hosting site's root to
 * `/admin/`, so its worker's scope is `/admin/` now. A pre-M6 admin registered it with the scope `/`, which is the public
 * map's since M6: before registering its own, each registrar unregisters a push worker registered at the site's root
 * (`retireRootWorker`; the public map's own app worker there stays), so no admin worker controls the viewer, and the device's new registration is sent to the server
 * as any registration is. The stand-in registers the real worker too where the browser lets it (the e2e projects block
 * service workers unless a spec allows them) and hands out its fixed token either way.
 *
 * Finding 46 of 2026-11-01 (`docs/research/manual-test-2026-10-25.md`): every failure leaves the registrar as a
 * `PushFailure` with its short code (the SDK's `FirebaseError.code`, or `push/...`), which the page shows and the log keeps
 * (`../inbox/push-failure.ts`). Finding 50: `getToken` keeps its token with the push subscription it was made for and
 * makes a new one when the worker's subscription changed (the root's worker retired) or after seven days, so the admin
 * keeps no record of its own (the installation id's record and its clearing of §79e went with `register`); `reset`
 * deletes the token FCM refused (`deleteToken`, which also drops the subscription), so the next `getToken` makes a new one.
 *
 * What `getToken` needs, from `@firebase/messaging` 0.13.3 (read offline): the Notifications permission granted; this
 * worker's registration (passed, so the SDK's own `/firebase-messaging-sw.js` at scope
 * `/firebase-cloud-messaging-push-scope` is never registered); a push subscription of that worker, made with the SDK's
 * default VAPID key when it has none; the installation's auth token from Firebase Installations
 * (`firebaseinstallations.googleapis.com`, with the web API key, so the key's referrer restriction must accept the admin's
 * page); then `CreateRegistration` at `fcmregistrations.googleapis.com`, whose answer is the token; IndexedDB for the
 * SDKs' records. The admin's CSP `connect-src` allows `https://*.googleapis.com`, Provision enables both APIs and lets
 * the key accept `${origin}/*` of the admin's origins.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';

import type { PushPermission, PushRegistrar } from '../inbox/push.js';
import { messageOf, PushFailure, pushFailureOf } from '../inbox/push-failure.js';

/** The service worker's file, next to the admin's page; its scope is the page's folder. */
export const PUSH_SERVICE_WORKER = 'firebase-messaging-sw.js';

/** A service worker as far as the root's retirement reads it. */
interface WorkerScript {
    readonly scriptURL: string;
}

/** A service worker registration as far as the root's retirement reads it. */
interface WorkerRegistration {
    readonly scope: string;
    readonly active?: WorkerScript | null;
    readonly waiting?: WorkerScript | null;
    readonly installing?: WorkerScript | null;
    unregister(): Promise<boolean>;
}

/** Whether a worker of `registration` is the push worker (a pre-M6 admin's), not the public map's own app worker (`sw.js`). */
function isPushWorker(registration: WorkerRegistration): boolean {
    const scripts = [registration.active, registration.waiting, registration.installing];
    return scripts.some((worker) => worker?.scriptURL.endsWith(`/${PUSH_SERVICE_WORKER}`) === true);
}

/** What the registrar needs of the browser (the node tests pass a plain object). */
export interface PushScope {
    readonly Notification?: {
        readonly permission: NotificationPermission;
        requestPermission(): Promise<NotificationPermission>;
    };
    readonly navigator: {
        readonly serviceWorker?: {
            register(url: string, options: { readonly scope: string }): Promise<ServiceWorkerRegistration>;
            getRegistrations?(): Promise<readonly WorkerRegistration[]>;
        };
    };
    readonly PushManager?: unknown;
    /** The page's address (`location`): its origin is the Hosting site's; the stand-in reads its query. */
    readonly location?: { readonly origin: string; readonly search?: string };
}

/**
 * Unregisters the push worker of the site's root scope (`<origin>/`) that a pre-M6 admin registered there, now the public
 * map's scope; the public map's own installable app worker there (`sw.js`, docs/ENGINE_API.md → *Installable app*) stays. Best effort: a browser without the API, or a refusal, leaves things as they are. Returns how
 * many it unregistered.
 */
export async function retireRootWorker(scope: PushScope): Promise<number> {
    const worker = scope.navigator.serviceWorker;
    const origin = scope.location?.origin;
    if (worker?.getRegistrations === undefined || origin === undefined) {
        return 0;
    }
    const root = `${origin}/`;
    const registrations = await worker.getRegistrations().catch(() => []);
    const retired = await Promise.all(
        registrations
            .filter((registration) => registration.scope === root && isPushWorker(registration))
            .map((registration) => registration.unregister().catch(() => false)),
    );
    return retired.filter(Boolean).length;
}

/** What the registration needs of `firebase/messaging` (finding 50: an FCM registration token). */
export interface MessagingSdk {
    getMessaging(app: FirebaseApp): Messaging;
    getToken(messaging: Messaging, options: { readonly serviceWorkerRegistration: ServiceWorkerRegistration }): Promise<string>;
    deleteToken(messaging: Messaging): Promise<boolean>;
}

/** The lazily imported messaging module. */
export async function loadMessagingSdk(): Promise<MessagingSdk> {
    const module = await import('./messaging-sdk.js');
    return module.messagingSdk;
}

function permissionOf(scope: PushScope): PushPermission {
    return scope.Notification?.permission ?? 'denied';
}

/** The browser's permission part, shared by the real registrar and the stand-in. */
function browserPermission(scope: PushScope): Pick<PushRegistrar, 'supported' | 'permission' | 'requestPermission'> {
    return {
        supported: () => scope.Notification !== undefined && scope.navigator.serviceWorker !== undefined && scope.PushManager !== undefined,
        permission: () => permissionOf(scope),
        requestPermission: async () => (await scope.Notification?.requestPermission()) ?? 'denied',
    };
}

export interface FirebasePushDeps {
    readonly scope: PushScope;
    readonly app: FirebaseApp;
    readonly load: () => Promise<MessagingSdk>;
}

type ServiceWorkerApi = NonNullable<PushScope['navigator']['serviceWorker']>;

/** The admin's worker in its folder; a refusal (a missing or broken worker file) is the registrar's own code. */
async function registerWorker(worker: ServiceWorkerApi): Promise<ServiceWorkerRegistration> {
    try {
        return await worker.register(PUSH_SERVICE_WORKER, { scope: './' });
    } catch (error) {
        throw new PushFailure('push/worker-registration-failed', messageOf(error));
    }
}

/** The messaging instance a registration of this page used: `reset` deletes its token (FCM refused it). */
interface Registered {
    readonly sdk: MessagingSdk;
    readonly messaging: Messaging;
}

async function firebaseToken(deps: FirebasePushDeps, registered: { last: Registered | null }): Promise<string> {
    const worker = deps.scope.navigator.serviceWorker;
    if (worker === undefined) {
        throw new PushFailure('push/no-service-worker');
    }
    await retireRootWorker(deps.scope);
    const [sdk, registration] = await Promise.all([deps.load(), registerWorker(worker)]);
    const messaging = sdk.getMessaging(deps.app);
    registered.last = { sdk, messaging };
    return sdk.getToken(messaging, { serviceWorkerRegistration: registration });
}

/**
 * Push through FCM: the service worker registered, then this browser's FCM registration token (`getToken`; finding 50 of
 * 2026-11-01). `reset` deletes the token this page registered (and its push subscription), so the next is a new one.
 */
export function firebasePush(deps: FirebasePushDeps): PushRegistrar {
    const registered: { last: Registered | null } = { last: null };
    return {
        ...browserPermission(deps.scope),
        kind: 'token',
        token: async () => {
            try {
                return await firebaseToken(deps, registered);
            } catch (error) {
                throw pushFailureOf(error);
            }
        },
        reset: async () => {
            await registered.last?.sdk.deleteToken(registered.last.messaging).catch(() => false);
        },
    };
}

/**
 * The `e2e` build's token of the test `testId` (the address's `?test=`): what the fake FCM takes as a registration token.
 * `generation` counts the registrations made again after `reset` (the first is 1).
 */
export function standInToken(testId: string, generation = 1): string {
    const name = testId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    return `e2e-fcm-token:${name === '' ? 'local' : name}-browser-${String(generation).padStart(4, '0')}`;
}

/**
 * The SDK failure a spec asks the stand-in for with the address's `?pushFail=` (an SDK code such as
 * `messaging/fid-registration-failed`), shaped as the SDK throws it; null without one.
 */
function standInFailure(scope: PushScope): PushFailure | null {
    const code = new URLSearchParams(scope.location?.search ?? '').get('pushFail');
    return code === null ? null : pushFailureOf({ code, customData: { errorInfo: 'the e2e stand-in failed as the spec asked' } });
}

/**
 * The `e2e` build's registrar: the browser's real permission, the root's worker retired and the admin's own registered as
 * in production (where the browser lets it), a fixed token per registration, no FCM. `reset` makes the next registration
 * a new one, as forgetting the SDK's record does.
 */
export function standInPush(scope: PushScope, testId: string): PushRegistrar {
    let generation = 1;
    return {
        ...browserPermission(scope),
        kind: 'token',
        token: async () => {
            await retireRootWorker(scope);
            await scope.navigator.serviceWorker?.register(PUSH_SERVICE_WORKER, { scope: './' }).catch(() => undefined);
            const failure = standInFailure(scope);
            if (failure !== null) {
                throw failure;
            }
            return standInToken(testId, generation);
        },
        reset: () => {
            generation += 1;
            return Promise.resolve();
        },
    };
}
