/**
 * The viewer's side of the app's updates (`packages/ui/src/app-update.ts`): the hold handed to the page script and let go,
 * a newer build heard now and on each change, Reload through the page script, and a page without that script.
 */
import { describe, expect, it } from 'vitest';

import { reloadApp, watchUpdate, type UpdateWindow } from '../src/app-update.js';

function fakeWindow(app: unknown) {
    const listeners = new Set<() => void>();
    const record = { reloads: 0 };
    const win: UpdateWindow & { HistoricCityMapApp?: unknown; location: { reload(): void } } = {
        HistoricCityMapApp: app,
        addEventListener: (_type, listener) => {
            listeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
            listeners.delete(listener);
        },
        location: {
            reload: () => {
                record.reloads += 1;
            },
        },
    };
    const fire = (): void => {
        listeners.forEach((listener) => {
            listener();
        });
    };
    return { win, fire, listeners, record };
}

describe('watchUpdate', () => {
    it('happyPath_theHoldIsHandedOverAndTheListenerHearsEachChangeUntilStopped', () => {
        const holds: (() => boolean)[] = [];
        let released = 0;
        const app = {
            updateReady: false,
            holdReload: (held: () => boolean) => {
                holds.push(held);
                return () => {
                    released += 1;
                };
            },
        };
        const page = fakeWindow(app);
        const heard: boolean[] = [];
        const stop = watchUpdate(
            page.win,
            () => true,
            (ready) => {
                heard.push(ready);
            },
        );
        expect(holds.map((held) => held())).toEqual([true]);

        app.updateReady = true;
        page.fire();
        stop();
        page.fire();

        expect(heard).toEqual([false, true]);
        expect(page.listeners.size).toBe(0);
        expect(released).toBe(1);
    });

    it.each([
        ['no page script', undefined],
        ['a page script without updates', { installable: false }],
    ])('badPath_%s_neverSaysReady', (_name, app) => {
        const page = fakeWindow(app);
        const heard: boolean[] = [];
        const stop = watchUpdate(
            page.win,
            () => false,
            (ready) => {
                heard.push(ready);
            },
        );
        page.fire();
        stop();

        expect(heard).toEqual([false, false]);
    });
});

describe('reloadApp', () => {
    it('happyPath_thePageScriptReloads', () => {
        let reloads = 0;
        const page = fakeWindow({
            reload: () => {
                reloads += 1;
            },
        });
        reloadApp(page.win);

        expect(reloads).toBe(1);
        expect(page.record.reloads).toBe(0);
    });

    it('badPath_withoutThePageScriptThePageReloadsItself', () => {
        const page = fakeWindow(null);
        reloadApp(page.win);

        expect(page.record.reloads).toBe(1);
    });
});
