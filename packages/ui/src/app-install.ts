/**
 * **Install app** (`docs/ENGINE_API.md` → *Installable app*): what the page's own script found (`startAppPage` of
 * `@hcm/shared/app`, in a city site's `tab-icon.js` and the admin's `app.js`) is `window.HistoricCityMapApp`, and each
 * change fires `hcm-install-available` on `window`. The viewer's Settings and the admin's account menu read it here and
 * show **Install app** only while the browser's install prompt waits (Chrome and Edge, on a computer and on Android); a page
 * without that script (the starter kit, an export, a test) has no app, so nothing shows.
 *
 * Installing is also how a Chrome or Edge computer gives the device's accent colour (lesson 711: only an installed app's
 * window gets it, `theme/device-accent.ts`): `installGivesAccent` says when the Device accent note offers it.
 */

/** What `appInstall` reads of `window`. */
export interface AppWindow {
    readonly HistoricCityMapApp?: unknown;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

/** The event the page script fires on each change. */
const INSTALL_EVENT = 'hcm-install-available';

interface PageApp {
    readonly installable?: unknown;
    readonly install?: unknown;
}

declare global {
    interface Window {
        /** The installable app's page script (`startAppPage` of `@hcm/shared/app`), when the page has one. */
        HistoricCityMapApp?: unknown;
    }
}

function pageApp(win: Pick<AppWindow, 'HistoricCityMapApp'>): PageApp {
    const app = win.HistoricCityMapApp;
    return typeof app === 'object' && app !== null ? app : {};
}

/** True while the browser's install prompt waits. */
export function canInstall(win: Pick<AppWindow, 'HistoricCityMapApp'>): boolean {
    return pageApp(win).installable === true;
}

/** Calls `listener` with `canInstall` at once and on each change; returns the function that stops it. */
export function watchInstall(win: AppWindow, listener: (installable: boolean) => void): () => void {
    const changed = (): void => {
        listener(canInstall(win));
    };
    win.addEventListener(INSTALL_EVENT, changed);
    changed();
    return () => {
        win.removeEventListener(INSTALL_EVENT, changed);
    };
}

/** Shows the browser's install prompt; resolves with the answer (`dismissed` on a page without one). */
export async function installApp(win: Pick<AppWindow, 'HistoricCityMapApp'>): Promise<'accepted' | 'dismissed'> {
    const app = pageApp(win);
    if (typeof app.install !== 'function') {
        return 'dismissed';
    }
    const outcome: unknown = await (app.install as () => Promise<unknown>).call(app);
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
}

/** What `installGivesAccent` reads of the browser (`navigator.userAgentData`, Chromium's only). */
interface AccentNavigator {
    readonly userAgentData?: { readonly mobile?: boolean };
}

/**
 * Whether installing the page would give it the device's accent: Chrome or Edge on a computer (Chromium's
 * `userAgentData`, not mobile). Android's dynamic colour never reaches a web page, installed or not (lesson 711).
 */
export function installGivesAccent(nav: object): boolean {
    const data = (nav as AccentNavigator).userAgentData;
    return data !== undefined && data.mobile !== true;
}
