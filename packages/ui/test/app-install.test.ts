/**
 * **Install app** (`packages/ui/src/app-install.ts`): what the page script left on `window`, watched and stopped, the
 * install's answer, a page without the script, and where installing brings the device's accent.
 */
import { describe, expect, it } from 'vitest';

import { canInstall, installApp, installGivesAccent, watchInstall, type AppWindow } from '../src/app-install.js';

function fakeWindow(app: unknown) {
    const listeners = new Set<() => void>();
    const win: AppWindow & { HistoricCityMapApp?: unknown } = {
        HistoricCityMapApp: app,
        addEventListener: (_type, listener) => {
            listeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
            listeners.delete(listener);
        },
    };
    return {
        win,
        fire: () => {
            listeners.forEach((listener) => {
                listener();
            });
        },
        listeners,
    };
}

describe('watchInstall', () => {
    it('happyPath_theListenerHearsNowAndOnEachChangeUntilStopped', () => {
        const page = fakeWindow({ installable: false });
        const heard: boolean[] = [];
        const stop = watchInstall(page.win, (installable) => {
            heard.push(installable);
        });

        page.win.HistoricCityMapApp = { installable: true };
        page.fire();
        stop();

        expect(heard).toEqual([false, true]);
        expect(page.listeners.size).toBe(0);
    });

    it.each([
        ['no page script', undefined],
        ['a value that is no app', 'x'],
        ['a flag that is not true', { installable: 'yes' }],
    ])('badPath_%s_isNothingToInstall', (_name, app) => {
        expect(canInstall(fakeWindow(app).win)).toBe(false);
    });
});

describe('installApp', () => {
    it('happyPath_thePromptsAnswerComesBack', async () => {
        await expect(installApp(fakeWindow({ install: () => Promise.resolve('accepted') }).win)).resolves.toBe('accepted');
        await expect(installApp(fakeWindow({ install: () => Promise.resolve('dismissed') }).win)).resolves.toBe('dismissed');
    });

    it('badPath_aPageWithoutTheScriptInstallsNothing', async () => {
        await expect(installApp(fakeWindow(null).win)).resolves.toBe('dismissed');
    });
});

describe('installGivesAccent', () => {
    it.each([
        ['Chrome or Edge on a computer', { userAgentData: { mobile: false } }, true],
        ['Chrome on Android', { userAgentData: { mobile: true } }, false],
        ['Firefox or Safari', {}, false],
    ])('happyPath_%s', (_name, nav, expected) => {
        expect(installGivesAccent(nav)).toBe(expected);
    });
});
