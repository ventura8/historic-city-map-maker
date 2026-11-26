/**
 * The real browser behind the ports of `ports.ts`, built by the entry (`../index.ts`). Each adapter takes only the parts
 * of `window` or `document` it uses, so the node tests drive it with plain objects.
 */
import type { Logger } from '@hcm/shared';

import type { Clock, HashLocation, KeyValueStore, PageVisibility, Unsubscribe } from './ports.js';

type Listening = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * `localStorage` or `sessionStorage` behind a `KeyValueStore`. Reaching the storage can itself throw (blocked site
 * data), so `open` is called on every use; any failure is logged once per operation and reads as empty.
 */
export function webStorage(open: () => Storage, log: Logger): KeyValueStore {
    const attempt = <T>(operation: string, run: (storage: Storage) => T, fallback: T): T => {
        try {
            return run(open());
        } catch (error) {
            log.warn('web storage unavailable', { operation, error: String(error) });
            return fallback;
        }
    };
    const keysOf = (storage: Storage): readonly string[] =>
        Array.from({ length: storage.length }, (_unused, index) => storage.key(index) ?? '');
    return {
        get: (key) => attempt('get', (storage) => storage.getItem(key), null),
        set: (key, value) => {
            attempt(
                'set',
                (storage) => {
                    storage.setItem(key, value);
                    return true;
                },
                false,
            );
        },
        remove: (key) => {
            attempt(
                'remove',
                (storage) => {
                    storage.removeItem(key);
                    return true;
                },
                false,
            );
        },
        keys: () => attempt('keys', keysOf, []),
    };
}

/** The window's clock (`Date.now`, `setTimeout`). */
export function windowClock(win: Pick<Window, 'setTimeout' | 'clearTimeout'>): Clock {
    return {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
        clearTimeout: (handle) => {
            win.clearTimeout(handle as number);
        },
    };
}

/** `document.visibilityState` and its `visibilitychange` event. */
export function documentVisibility(doc: Pick<Document, 'visibilityState'> & Listening): PageVisibility {
    return {
        visible: () => doc.visibilityState === 'visible',
        onChange: (listener): Unsubscribe => {
            const onEvent = (): void => {
                listener(doc.visibilityState === 'visible');
            };
            doc.addEventListener('visibilitychange', onEvent);
            return () => {
                doc.removeEventListener('visibilitychange', onEvent);
            };
        },
    };
}

/** What `windowLocation` needs of `window`. */
export interface LocationWindow extends Listening {
    readonly location: Pick<Location, 'hash' | 'search' | 'origin' | 'pathname' | 'hostname' | 'reload'>;
    readonly history: Pick<History, 'pushState' | 'replaceState'>;
}

/**
 * The address bar. A navigation pushes a history entry and announces the new hash (`pushState` fires no `hashchange`,
 * so the listeners are called directly); a redirect (`replace`) rewrites the entry silently.
 */
export function windowLocation(win: LocationWindow): HashLocation {
    const listeners = new Set<(hash: string) => void>();
    const announce = (): void => {
        for (const listener of listeners) {
            listener(win.location.hash);
        }
    };
    win.addEventListener('hashchange', announce);
    return {
        hash: () => win.location.hash,
        setHash: (hash, replace) => {
            if (replace) {
                win.history.replaceState(null, '', hash);
                return;
            }
            win.history.pushState(null, '', hash);
            announce();
        },
        onHashChange: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        search: () => win.location.search,
        page: () => `${win.location.origin}${win.location.pathname}`,
        reload: () => {
            win.location.reload();
        },
    };
}
