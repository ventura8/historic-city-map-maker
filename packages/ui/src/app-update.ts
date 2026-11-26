/**
 * The viewer's side of the app's updates (`docs/ENGINE_API.md` → *Installable app* → *Updates*): the page's own script
 * (`watchAppUpdates` of `@hcm/shared/app`, in a city site's `tab-icon.js`) reloads the page into a newer build at a safe
 * moment. The viewer tells it what is not safe (`holdReload`: a dialog, the full-size view, swipe compare, the map's menu)
 * and, while a newer build waits (`updateReady`, `hcm-update-ready` on `window`), shows "A new version of the map is
 * ready" with Reload (`reloadApp`). A page without that script (the starter kit, an export, a test) has nothing to watch.
 */

/** What `watchUpdate` reads of `window`. */
export interface UpdateWindow {
    readonly HistoricCityMapApp?: unknown;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

/** The event the page script fires when a newer build waits. */
const UPDATE_EVENT = 'hcm-update-ready';

interface PageUpdates {
    readonly updateReady?: unknown;
    readonly holdReload?: unknown;
    readonly reload?: unknown;
}

function pageUpdates(win: Pick<UpdateWindow, 'HistoricCityMapApp'>): PageUpdates {
    const app = win.HistoricCityMapApp;
    return typeof app === 'object' && app !== null ? app : {};
}

/**
 * Holds the page's reload while `held()` says so, and calls `listener` with whether a newer build waits, at once and on
 * each change; returns the function that stops both.
 */
export function watchUpdate(win: UpdateWindow, held: () => boolean, listener: (ready: boolean) => void): () => void {
    const app = pageUpdates(win);
    const hold: unknown =
        typeof app.holdReload === 'function' ? (app.holdReload as (held: () => boolean) => unknown).call(app, held) : null;
    const changed = (): void => {
        listener(pageUpdates(win).updateReady === true);
    };
    win.addEventListener(UPDATE_EVENT, changed);
    changed();
    return () => {
        win.removeEventListener(UPDATE_EVENT, changed);
        if (typeof hold === 'function') {
            (hold as () => void)();
        }
    };
}

/** Reloads into the newer build now (the page script remembers it, so it never loops). */
export function reloadApp(win: Pick<UpdateWindow, 'HistoricCityMapApp'> & { readonly location: { reload(): void } }): void {
    const app = pageUpdates(win);
    if (typeof app.reload === 'function') {
        (app.reload as () => void).call(app);
    } else {
        win.location.reload();
    }
}
