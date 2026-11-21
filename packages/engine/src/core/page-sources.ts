/**
 * What the store reads from the real page (`browserEnvironment` of `mount.ts` wires them): `localStorage`, the address and
 * `prefers-color-scheme`. Tested through `browserEnvironment` with a fake page.
 */
import type { ColorSchemeSource, ViewerLocation } from './deps.js';
import type { PreferenceStorage } from './preferences.js';

const NO_STORAGE: PreferenceStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/** `localStorage`, or nothing when the browser refuses it (sandboxed frames, blocked site data). */
export function storageOf(win: Window): PreferenceStorage {
    try {
        return win.localStorage;
    } catch {
        return NO_STORAGE;
    }
}

/** The page address as the store sees it; the hash is written with `history.replaceState` (no history entries). */
export function locationOf(win: Window): ViewerLocation {
    return {
        get hash() {
            return win.location.hash;
        },
        get href() {
            return win.location.href;
        },
        get search() {
            return win.location.search;
        },
        replaceHash(hash: string): void {
            const url = hash === '' ? `${win.location.pathname}${win.location.search}` : hash;
            win.history.replaceState(win.history.state, '', url);
        },
        subscribe(listener: () => void) {
            win.addEventListener('hashchange', listener);
            return () => {
                win.removeEventListener('hashchange', listener);
            };
        },
    };
}

export function colorSchemeOf(win: Window): ColorSchemeSource {
    const query = win.matchMedia('(prefers-color-scheme: dark)');
    return {
        dark: () => query.matches,
        subscribe: (listener) => {
            query.onchange = (event): void => {
                listener(event.matches);
            };
            return () => {
                query.onchange = null;
            };
        },
    };
}
