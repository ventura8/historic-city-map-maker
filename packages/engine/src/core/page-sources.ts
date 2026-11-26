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

/** The hash parameters a link may also carry in its query (`?layer=…#15/…`, the owner, 2026-11-22), by query name. */
const QUERY_TO_HASH: Readonly<Record<string, string>> = {
    layer: 'layers',
    layers: 'layers',
    photo: 'photo',
    story: 'story',
    cmp: 'cmp',
    sw: 'sw',
    labels: 'labels',
    near: 'near',
    pv: 'pv',
    op: 'op',
    opacity: 'opacity',
};

/**
 * A link's query parameters that the hash reads (`?layer=x#15/44.4/26.1` is `#15/44.4/26.1&layers=x`), moved into the hash;
 * the hash wins over the query for a parameter it has. Null when the query has none (nothing to rewrite).
 */
export function adoptQueryLink(search: string, hash: string): { readonly search: string; readonly hash: string } | null {
    const query = new URLSearchParams(search);
    const [view = '', ...parts] = hash.replace(/^#/, '').split('&');
    const present = new Set(parts.map((part) => part.split('=')[0]));
    const moved = [...query.entries()].filter(([name]) => QUERY_TO_HASH[name] !== undefined);
    if (moved.length === 0) {
        return null;
    }
    for (const [name] of moved) {
        query.delete(name);
    }
    const added = moved
        .map(([name, value]) => [QUERY_TO_HASH[name] ?? name, value] as const)
        .filter(([name]) => !present.has(name))
        .map(([name, value]) => `${name}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`);
    const rest = query.toString();
    return { search: rest === '' ? '' : `?${rest}`, hash: `#${[view, ...parts, ...added].join('&')}` };
}

/** Moves a link's query parameters into its hash once, at mount, so the store reads one address (`adoptQueryLink`). */
function adoptQuery(win: Window): void {
    const adopted = adoptQueryLink(win.location.search, win.location.hash);
    if (adopted !== null) {
        win.history.replaceState(win.history.state, '', `${win.location.pathname}${adopted.search}${adopted.hash}`);
    }
}

/** The page address as the store sees it; the hash is written with `history.replaceState` (no history entries). */
export function locationOf(win: Window): ViewerLocation {
    adoptQuery(win);
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
