/**
 * The installable app's page script (`packages/shared/src/kit/app-page.ts`), on a window made of plain objects: the worker
 * registered for the page's folder, the browser's install prompt kept (its banner prevented) and offered, its answer,
 * and a page that cannot have a worker.
 */
import { describe, expect, it } from 'vitest';

import { appPageSource, startAppPage, type AppPageScope, type InstallPrompt } from '../../src/kit/app-page.js';

function page(options: { secure?: boolean; workers?: boolean; refuse?: boolean } = {}) {
    const listeners = new Map<string, (event: never) => void>();
    const said: string[] = [];
    const registered: unknown[] = [];
    const scope: AppPageScope = {
        isSecureContext: options.secure ?? true,
        navigator:
            options.workers === false
                ? {}
                : {
                      serviceWorker: {
                          register: (url, registration) => {
                              registered.push({ url, ...registration });
                              return options.refuse === true ? Promise.reject(new Error('refused')) : Promise.resolve({});
                          },
                      },
                  },
        addEventListener: (type: string, listener: (event: never) => void) => {
            listeners.set(type, listener);
        },
        dispatchEvent: (event) => {
            said.push(event.type);
            return true;
        },
    };
    return { scope, listeners, said, registered };
}

function prompt(outcome: string) {
    const calls: string[] = [];
    const event: InstallPrompt = {
        preventDefault: () => calls.push('preventDefault'),
        prompt: () => {
            calls.push('prompt');
            return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome }),
    };
    return { event, calls };
}

const OPTIONS = { worker: 'sw.js', scope: './' };

describe('startAppPage', () => {
    it('happyPath_theWorkerIsRegisteredForThePagesFolder', () => {
        const p = page();
        startAppPage(p.scope, OPTIONS);

        expect(p.registered).toEqual([{ url: 'sw.js', scope: './', updateViaCache: 'none' }]);
        expect(p.scope.HistoricCityMapApp?.installable).toBe(false);
    });

    it('happyPath_theInstallPromptIsKeptOfferedAndAnswered', async () => {
        const p = page();
        startAppPage(p.scope, OPTIONS);
        const offer = prompt('accepted');

        p.listeners.get('beforeinstallprompt')?.(offer.event as never);
        expect(p.scope.HistoricCityMapApp?.installable).toBe(true);
        expect(p.said).toEqual(['hcm-install-available']);

        await expect(p.scope.HistoricCityMapApp?.install()).resolves.toBe('accepted');
        expect(offer.calls).toEqual(['preventDefault', 'prompt']);
        expect(p.scope.HistoricCityMapApp?.installable).toBe(false);
        expect(p.said).toEqual(['hcm-install-available', 'hcm-install-available']);
    });

    it('badPath_aDismissedPromptOrNoPromptInstallsNothing', async () => {
        const p = page();
        startAppPage(p.scope, OPTIONS);

        await expect(p.scope.HistoricCityMapApp?.install()).resolves.toBe('dismissed');
        p.listeners.get('beforeinstallprompt')?.(prompt('dismissed').event as never);
        await expect(p.scope.HistoricCityMapApp?.install()).resolves.toBe('dismissed');
    });

    it('happyPath_anInstalledAppIsNoLongerOffered', () => {
        const p = page();
        startAppPage(p.scope, OPTIONS);
        p.listeners.get('beforeinstallprompt')?.(prompt('accepted').event as never);

        p.listeners.get('appinstalled')?.(undefined as never);

        expect(p.scope.HistoricCityMapApp?.installable).toBe(false);
        expect(p.said).toHaveLength(2);
    });

    it.each([
        ['a page over http', { secure: false }],
        ['a browser without service workers', { workers: false }],
    ])('badPath_%s_registersNoWorkerAndStillWorks', (_name, options) => {
        const p = page(options);
        startAppPage(p.scope, OPTIONS);

        expect(p.registered).toEqual([]);
        expect(p.scope.HistoricCityMapApp?.installable).toBe(false);
    });

    it('badPath_aRefusedRegistrationLeavesThePageAsItWas', async () => {
        const p = page({ refuse: true });
        startAppPage(p.scope, OPTIONS);
        await Promise.resolve();

        expect(p.registered).toHaveLength(1);
        expect(p.scope.HistoricCityMapApp?.installable).toBe(false);
    });
});

describe('appPageSource', () => {
    it('happyPath_theScriptStartsTheAppOnTheWindow', () => {
        expect(appPageSource(OPTIONS)).toContain(')(window, {"worker":"sw.js","scope":"./"});');
    });
});
