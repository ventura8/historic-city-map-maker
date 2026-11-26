/**
 * The installable app's page side (`docs/ENGINE_API.md` → *Installable app*), written into the page's own script (a city
 * site's `tab-icon.js`, the admin's `app.js`) from `startAppPage`'s source text, so the engine carries none of it. It
 *
 * - registers the app's worker (`app-worker.ts`) with the page's folder as scope and `updateViaCache: 'none'`, so the
 *   browser asks for a new worker file on every visit;
 * - keeps the browser's install prompt (`beforeinstallprompt`, whose banner it prevents: nothing pops up on a visit), which
 *   the viewer's Settings and the admin's account menu offer as **Install app** (`packages/ui/src/app-install.ts`).
 *
 * - keeps the installed app up to date (`app-update.ts`: a newer build reloads the page at a safe moment, else
 *   `hcm-update-ready` and the viewer's Reload snackbar).
 *
 * What it found is `window.HistoricCityMapApp`, and each change fires `hcm-install-available` on `window`. The prompt
 * only comes where the browser can install the page (Chrome and Edge, on a computer and on Android; never an installed
 * app's own window), so **Install app** shows only there. The page's `<link rel="manifest">` is in its HTML.
 */

import { appUpdateSource, type AppUpdateOptions, type AppUpdates } from './app-update.js';

/** `window.HistoricCityMapApp`, which the viewer and the admin read; the update watch adds its part (`app-update.ts`). */
export interface HistoricCityMapApp extends AppUpdates {
    /** True while the browser's install prompt waits. */
    installable: boolean;
    /** Shows the browser's install prompt; resolves with the visitor's answer (`dismissed` without a prompt). */
    install(): Promise<'accepted' | 'dismissed'>;
}

/** The event `INSTALL_EVENT` names: a change of `HistoricCityMapApp.installable`. */
export const INSTALL_EVENT = 'hcm-install-available';

/** The part of `BeforeInstallPromptEvent` the page uses. */
export interface InstallPrompt {
    preventDefault(): void;
    prompt(): Promise<unknown>;
    readonly userChoice: Promise<{ readonly outcome: string }>;
}

/** What the page script uses of `window`. */
export interface AppPageScope {
    HistoricCityMapApp?: HistoricCityMapApp;
    readonly isSecureContext: boolean;
    readonly navigator: {
        readonly serviceWorker?: {
            register(url: string, options: { readonly scope: string; readonly updateViaCache: 'none' }): Promise<unknown>;
        };
    };
    addEventListener(type: 'beforeinstallprompt', listener: (event: InstallPrompt) => void): void;
    addEventListener(type: 'appinstalled', listener: () => void): void;
    dispatchEvent(event: Event): boolean;
}

/** Where the page's worker lives. */
export interface AppPageOptions {
    /** The worker file's address, relative to the page. */
    readonly worker: string;
    /** Its scope: the page's folder (`./`). */
    readonly scope: string;
}

/** Starts the page's app: the worker and the install prompt. Self-contained: its source text is part of the page's script. */
export function startAppPage(scope: AppPageScope, options: AppPageOptions): void {
    let waiting: InstallPrompt | null = null;
    const say = (): void => {
        scope.dispatchEvent(new Event('hcm-install-available'));
    };
    const app: HistoricCityMapApp = {
        installable: false,
        install: async () => {
            const event = waiting;
            if (event === null) {
                return 'dismissed';
            }
            waiting = null;
            app.installable = false;
            await event.prompt();
            const { outcome } = await event.userChoice;
            say();
            return outcome === 'accepted' ? 'accepted' : 'dismissed';
        },
    };
    scope.HistoricCityMapApp = app;
    scope.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        waiting = event;
        app.installable = true;
        say();
    });
    scope.addEventListener('appinstalled', () => {
        waiting = null;
        app.installable = false;
        say();
    });
    const workers = scope.isSecureContext ? scope.navigator.serviceWorker : undefined;
    // A refused registration (a private window, storage turned off) leaves the page as it was: it works without one.
    workers?.register(options.worker, { scope: options.scope, updateViaCache: 'none' }).catch(() => undefined);
}

/** The lines of a page's script that start its app and keep it up to date (`update`: the build it was made by, if any). */
export function appPageSource(options: AppPageOptions, update: AppUpdateOptions = {}): string {
    return [
        '// The installable app (docs/ENGINE_API.md → Installable app), from packages/shared/src/kit/app-page.ts and app-update.ts.',
        `(${startAppPage.toString()})(window, ${JSON.stringify(options)});`,
        appUpdateSource(update),
        '',
    ].join('\n');
}
