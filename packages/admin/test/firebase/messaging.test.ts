/**
 * Web push on this browser (`packages/admin/src/firebase/messaging.ts`; `docs/research/M4-interfaces.md` §5.4): the
 * Notifications API's permission, the service worker beside the page and the FCM registration token of it (`getToken`;
 * finding 50 of 2026-11-01), deleted on `reset`; the `e2e` build's stand-in with a fixed token; the lazily loaded messaging module. No
 * browser, no FCM: a scripted scope.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { describe, expect, it } from 'vitest';

import {
    PUSH_SERVICE_WORKER,
    firebasePush,
    loadMessagingSdk,
    retireRootWorker,
    standInPush,
    standInToken,
    type MessagingSdk,
    type PushScope,
} from '../../src/firebase/messaging.js';

const APP = { name: 'e2e' } as unknown as FirebaseApp;
const REGISTRATION = { scope: 'https://demo-hcm.web.app/' } as unknown as ServiceWorkerRegistration;

function scope(options: { permission?: NotificationPermission; answer?: NotificationPermission; worker?: boolean; push?: boolean } = {}) {
    const registered: { readonly url: string; readonly scope: string }[] = [];
    const browser: PushScope = {
        Notification: {
            permission: options.permission ?? 'default',
            requestPermission: () => Promise.resolve(options.answer ?? 'granted'),
        },
        navigator:
            options.worker === false
                ? {}
                : {
                      serviceWorker: {
                          register: (url, registration) => {
                              registered.push({ url, scope: registration.scope });
                              return Promise.resolve(REGISTRATION);
                          },
                      },
                  },
        ...(options.push === false ? {} : { PushManager: {} }),
    };
    return { browser, registered };
}

/** The SDK's seam: `getToken` answers `token`; `deleteToken` is counted. */
function sdk(token = 'fcm-registration-token-of-this-browser'): MessagingSdk & { readonly asked: unknown[]; deleted: number } {
    const asked: unknown[] = [];
    const fake = {
        asked,
        deleted: 0,
        getMessaging: (app: FirebaseApp): Messaging => ({ app }),
        getToken: (messaging: Messaging, options: { readonly serviceWorkerRegistration: ServiceWorkerRegistration }) => {
            asked.push({ messaging, registration: options.serviceWorkerRegistration });
            return Promise.resolve(token);
        },
        deleteToken: () => {
            fake.deleted += 1;
            return Promise.resolve(true);
        },
    };
    return fake;
}

describe('firebasePush', () => {
    it('happyPath_thePromptThenTheServiceWorkerThenItsRegistrationToken', async () => {
        const { browser, registered } = scope();
        const messaging = sdk();
        const push = firebasePush({ scope: browser, app: APP, load: () => Promise.resolve(messaging) });

        await expect(push.requestPermission()).resolves.toBe('granted');
        await expect(push.token()).resolves.toBe('fcm-registration-token-of-this-browser');

        expect(push.kind).toBe('token');
        expect([push.supported(), push.permission()]).toEqual([true, 'default']);
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
        expect(messaging.asked).toEqual([{ messaging: { app: APP }, registration: REGISTRATION }]);
    });

    it.each([
        ['no service worker', { worker: false }],
        ['no Push API', { push: false }],
    ])('badPath_aBrowserWith_%s_cannotPush', (_name, options) => {
        expect(firebasePush({ scope: scope(options).browser, app: APP, load: () => Promise.resolve(sdk()) }).supported()).toBe(false);
    });

    it('badPath_noServiceWorkerMeansNoToken', async () => {
        const push = firebasePush({ scope: scope({ worker: false }).browser, app: APP, load: () => Promise.resolve(sdk()) });
        await expect(push.token()).rejects.toMatchObject({ code: 'push/no-service-worker' });
    });

    // Finding 46 of 2026-11-01: the SDK's own code reaches the page and the log, its text without ids.
    it('badPath_anSdkFailureKeepsItsCode_andARefusedWorkerHasTheRegistrarsOwn', async () => {
        const failing = sdk();
        const sdkError = Object.assign(new Error('Messaging: registration failed (messaging/token-subscribe-failed).'), {
            code: 'messaging/token-subscribe-failed',
            customData: { errorInfo: 'PERMISSION_DENIED for installation cXg2c2RkZGRkZGRkZGRk' },
        });
        const push = firebasePush({
            scope: scope().browser,
            app: APP,
            load: () => Promise.resolve({ ...failing, getToken: () => Promise.reject(sdkError) }),
        });
        await expect(push.token()).rejects.toMatchObject({
            code: 'messaging/token-subscribe-failed',
            info: 'PERMISSION_DENIED for installation [id]',
        });

        const refusedWith = (reason: Error) =>
            firebasePush({
                scope: { ...scope().browser, navigator: { serviceWorker: { register: () => Promise.reject(reason) } } },
                app: APP,
                load: () => Promise.resolve(sdk()),
            });
        await expect(refusedWith(new TypeError('A bad HTTP response code (404)')).token()).rejects.toMatchObject({
            code: 'push/worker-registration-failed',
            info: 'A bad HTTP response code (404)',
        });
    });

    it('happyPath_resetDeletesThisPagesToken', async () => {
        const messaging = sdk();
        const push = firebasePush({ scope: scope().browser, app: APP, load: () => Promise.resolve(messaging) });

        // Before any registration of this page there is no token to delete.
        await push.reset();
        expect(messaging.deleted).toBe(0);
        await push.token();
        await push.reset();
        expect(messaging.deleted).toBe(1);
        // A refused delete (the token was gone already) is no failure.
        const refusing = { ...sdk(), deleteToken: () => Promise.reject(new Error('messaging/token-unsubscribe-failed')) };
        const quiet = firebasePush({ scope: scope().browser, app: APP, load: () => Promise.resolve(refusing) });
        await quiet.token();
        await expect(quiet.reset()).resolves.toBeUndefined();
    });

    it('badPath_noNotificationsApiIsAPermissionDenied', async () => {
        const push = firebasePush({ scope: { navigator: {} }, app: APP, load: () => Promise.resolve(sdk()) });

        await expect(push.requestPermission()).resolves.toBe('denied');
        expect([push.supported(), push.permission()]).toEqual([false, 'denied']);
    });
});

describe('the e2e stand-in', () => {
    it('happyPath_theBrowsersOwnPermissionAndAFixedTokenPerTest', async () => {
        const { browser, registered } = scope({ permission: 'granted' });
        const push = standInPush(browser, 'S-A47 happy/1');

        await expect(push.token()).resolves.toBe('e2e-fcm-token:S-A47happy1-browser-0001');
        expect([push.permission(), push.kind]).toEqual(['granted', 'token']);
        expect(standInToken('')).toBe('e2e-fcm-token:local-browser-0001');
        // The admin's own worker, as in production, beside its page.
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
    });

    it('happyPath_resetMakesTheNextRegistrationANewOne', async () => {
        const push = standInPush(scope({ permission: 'granted' }).browser, 'S-A47-HAPPY-RENEWED');

        await expect(push.token()).resolves.toBe('e2e-fcm-token:S-A47-HAPPY-RENEWED-browser-0001');
        await push.reset();
        await expect(push.token()).resolves.toBe('e2e-fcm-token:S-A47-HAPPY-RENEWED-browser-0002');
    });

    it('badPath_theSdkFailureASpecAsksForIsThrownAsTheSdkWould', async () => {
        const browser: PushScope = {
            ...scope({ permission: 'granted' }).browser,
            location: { origin: 'https://demo-hcm.web.app', search: '?test=x&pushFail=messaging/fid-registration-failed' },
        };

        await expect(standInPush(browser, 'x').token()).rejects.toMatchObject({ code: 'messaging/fid-registration-failed' });
    });

    it('badPath_aBrowserThatRefusesServiceWorkersStillGetsItsToken', async () => {
        // The e2e projects block service workers unless a spec allows them.
        const refusing: PushScope = {
            navigator: { serviceWorker: { register: () => Promise.reject(new Error('blocked')) } },
            Notification: { permission: 'granted', requestPermission: () => Promise.resolve('granted') },
        };

        await expect(standInPush(refusing, 'x').token()).resolves.toBe('e2e-fcm-token:x-browser-0001');
        await expect(standInPush({ navigator: {} }, 'x').token()).resolves.toBe('e2e-fcm-token:x-browser-0001');
    });
});

describe('retireRootWorker (M6: the admin moved to /admin/)', () => {
    /** Registrations of a browser at the Hosting origin, each recording whether it was unregistered. */
    function withRegistrations(scopes: readonly string[], refuse = false) {
        const unregistered: string[] = [];
        const registrations = scopes.map((registrationScope) => ({
            scope: registrationScope,
            active: { scriptURL: `${registrationScope}${PUSH_SERVICE_WORKER}` },
            unregister: () => {
                unregistered.push(registrationScope);
                return refuse ? Promise.reject(new Error('refused')) : Promise.resolve(true);
            },
        }));
        const { browser, registered } = scope();
        const worker = browser.navigator.serviceWorker;
        const withRoot: PushScope = {
            ...browser,
            navigator: {
                serviceWorker: {
                    register: (url, options) => worker?.register(url, options) ?? Promise.resolve(REGISTRATION),
                    getRegistrations: () => Promise.resolve(registrations),
                },
            },
            location: { origin: 'https://demo-hcm.web.app' },
        };
        return { browser: withRoot, unregistered, registered };
    }

    it('happyPath_theRootScopesWorkerIsUnregisteredBeforeTheAdminRegistersItsOwn', async () => {
        const { browser, unregistered, registered } = withRegistrations(['https://demo-hcm.web.app/', 'https://demo-hcm.web.app/admin/']);
        const messaging = sdk();
        const push = firebasePush({ scope: browser, app: APP, load: () => Promise.resolve(messaging) });

        await push.token();

        expect(unregistered).toEqual(['https://demo-hcm.web.app/']);
        expect(registered).toEqual([{ url: PUSH_SERVICE_WORKER, scope: './' }]);
        // The token is asked for the admin's own worker, whose subscription `getToken` checks against its record.
        expect(messaging.asked).toEqual([{ messaging: { app: APP }, registration: REGISTRATION }]);
    });

    it('badPath_aRefusalOrABrowserWithoutTheApiLeavesThingsAsTheyAre', async () => {
        const refusing = withRegistrations(['https://demo-hcm.web.app/'], true);

        await expect(retireRootWorker(refusing.browser)).resolves.toBe(0);
        await expect(retireRootWorker(scope().browser)).resolves.toBe(0);
        await expect(retireRootWorker({ navigator: {} })).resolves.toBe(0);
        const failing: PushScope = {
            navigator: {
                serviceWorker: { register: () => Promise.resolve(REGISTRATION), getRegistrations: () => Promise.reject(new Error('x')) },
            },
            location: { origin: 'https://demo-hcm.web.app' },
        };
        await expect(retireRootWorker(failing)).resolves.toBe(0);
        await expect(retireRootWorker(withRegistrations(['https://demo-hcm.web.app/admin/']).browser)).resolves.toBe(0);
    });

    it('badPath_thePublicMapsOwnAppWorkerAtTheRootStays', async () => {
        const unregistered: string[] = [];
        const appWorker = {
            scope: 'https://demo-hcm.web.app/',
            active: { scriptURL: 'https://demo-hcm.web.app/sw.js' },
            waiting: null,
            unregister: () => {
                unregistered.push('sw.js');
                return Promise.resolve(true);
            },
        };
        const browser: PushScope = {
            navigator: {
                serviceWorker: { register: () => Promise.resolve(REGISTRATION), getRegistrations: () => Promise.resolve([appWorker]) },
            },
            location: { origin: 'https://demo-hcm.web.app' },
        };

        await expect(retireRootWorker(browser)).resolves.toBe(0);
        expect(unregistered).toEqual([]);
    });
});

describe('loadMessagingSdk', () => {
    it('happyPath_theLazyModuleHoldsTheSdksFunctions', async () => {
        const messaging = await loadMessagingSdk();

        expect([typeof messaging.getMessaging, typeof messaging.getToken, typeof messaging.deleteToken]).toEqual([
            'function',
            'function',
            'function',
        ]);
    });
});
