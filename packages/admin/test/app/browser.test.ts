import { describe, expect, it, vi } from 'vitest';

import { documentVisibility, webStorage, windowClock, windowLocation, type LocationWindow } from '../../src/app/browser.js';
import { testLog } from './fakes.js';

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

describe('webStorage', () => {
    it('happyPath_readsWritesListsAndRemoves', () => {
        const storage = new MemoryStorage();
        const store = webStorage(() => storage, testLog().log);

        store.set('hcm:admin:lang', 'en');
        store.set('other', '1');
        store.remove('other');

        expect(store.get('hcm:admin:lang')).toBe('en');
        expect(store.get('missing')).toBeNull();
        expect(store.keys()).toEqual(['hcm:admin:lang']);
    });

    it('badPath_aBlockedStorageReadsAsEmptyAndIsLogged', () => {
        const { log, recording } = testLog();
        const store = webStorage(() => {
            throw new DOMException('blocked', 'SecurityError');
        }, log);

        store.set('a', 'b');
        store.remove('a');

        expect(store.get('a')).toBeNull();
        expect(store.keys()).toEqual([]);
        expect(recording.records.map((record) => record.data?.['operation'])).toEqual(['set', 'remove', 'get', 'keys']);
    });

    it('badPath_aKeyThatVanishedReadsAsEmpty', () => {
        const storage = new MemoryStorage();
        storage.setItem('a', '1');
        vi.spyOn(storage, 'key').mockReturnValue(null);

        expect(webStorage(() => storage, testLog().log).keys()).toEqual(['']);
    });
});

describe('windowClock', () => {
    it('happyPath_usesTheWindowsTimers', () => {
        const win = { setTimeout: vi.fn(() => 7), clearTimeout: vi.fn() };
        const clock = windowClock(win);
        const callback = vi.fn();

        expect(clock.setTimeout(callback, 100)).toBe(7);
        clock.clearTimeout(7);

        expect(win.setTimeout).toHaveBeenCalledWith(callback, 100);
        expect(win.clearTimeout).toHaveBeenCalledWith(7);
        expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
    });
});

describe('documentVisibility', () => {
    it('happyPath_reportsTheStateAndItsChanges', () => {
        const target = new EventTarget();
        const doc: EventTarget & { visibilityState: DocumentVisibilityState } = Object.assign(target, {
            visibilityState: 'visible' as const,
        });
        const visibility = documentVisibility(doc);
        const seen: boolean[] = [];

        const stop = visibility.onChange((visible) => {
            seen.push(visible);
        });
        doc.visibilityState = 'hidden';
        target.dispatchEvent(new Event('visibilitychange'));
        stop();
        target.dispatchEvent(new Event('visibilitychange'));

        expect(visibility.visible()).toBe(false);
        expect(seen).toEqual([false]);
    });
});

function fakeWindow() {
    const target = new EventTarget();
    const location = {
        hash: '#/setup',
        search: '?lang=en',
        origin: 'https://demo-hcm.web.app',
        pathname: '/',
        hostname: 'demo-hcm.web.app',
        reload: vi.fn(),
    };
    const history = {
        pushState: vi.fn((_state: unknown, _title: string, url: string) => {
            location.hash = url;
        }),
        replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
            location.hash = url;
        }),
    };
    const win = Object.assign(target, { location, history });
    return { win: win as unknown as LocationWindow & EventTarget, location, history, target };
}

describe('windowLocation', () => {
    it('happyPath_aNavigationPushesAnEntryAndIsAnnounced', () => {
        const { win, history } = fakeWindow();
        const location = windowLocation(win);
        const seen: string[] = [];
        const stop = location.onHashChange((hash) => {
            seen.push(hash);
        });

        location.setHash('#/admins', false);
        location.setHash('#/setup', true);
        stop();
        location.setHash('#/photos', false);

        expect(history.pushState).toHaveBeenCalledWith(null, '', '#/admins');
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '#/setup');
        expect(seen).toEqual(['#/admins']);
    });

    it('happyPath_theBrowsersOwnHashChangesAreAnnounced', () => {
        const { win, location: raw, target } = fakeWindow();
        const location = windowLocation(win);
        const seen: string[] = [];
        location.onHashChange((hash) => {
            seen.push(hash);
        });

        raw.hash = '#/jobs';
        target.dispatchEvent(new Event('hashchange'));

        expect(seen).toEqual(['#/jobs']);
        expect(location.hash()).toBe('#/jobs');
    });

    it('happyPath_readsTheQueryThePageAndReloads', () => {
        const { win, location: raw } = fakeWindow();
        const location = windowLocation(win);

        location.reload();

        expect(location.search()).toBe('?lang=en');
        expect(location.page()).toBe('https://demo-hcm.web.app/');
        expect(raw.reload).toHaveBeenCalledTimes(1);
    });
});
