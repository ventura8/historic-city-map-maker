/**
 * The installed app keeps itself up to date (`docs/ENGINE_API.md` → *Installable app* → *Updates*; the owner, 2026-11-14:
 * "the installed PWA apps must update/refresh themselves"). Written into the page's own script after `startAppPage`
 * (`app-page.ts`) from `watchAppUpdates`' source text, so the engine carries none of it.
 *
 * - **When it looks:** at start, when the window gets the focus or the page becomes visible again, and every
 *   `UPDATE_LOOK_MS` (15 minutes) while the page is open. Each look asks the browser for a new worker file
 *   (`registration.update()`: a new worker takes over at once, `app-worker.ts`) and, on a city site, reads the build
 *   Hosting serves now (`app-build.json` beside the page, `{"build": "…"}`, read `no-store`) against the build the page
 *   was made by. An unreadable file is no news.
 * - **When it reloads:** a newer build reloads the page by itself at a safe moment: nothing holds it (the viewer holds it
 *   while a dialog, the full-size view or swipe compare is open: `holdReload`), no pointer is pressed (a drag), and the
 *   page is hidden or nobody touched it for `UPDATE_IDLE_MS`. Until then `updateReady` is true, `hcm-update-ready` fires
 *   on `window` (the viewer's "A new version of the map is ready" snackbar with Reload), and it tries again every
 *   `UPDATE_RETRY_MS`.
 * - **Never a loop:** before it reloads it writes the build it reloads for into the tab's `sessionStorage`; a page that
 *   comes back still older (a cache between it and Hosting) never reloads for that build again by itself, it only offers
 *   Reload. Without `sessionStorage` (a private window, blocked site data) it never reloads by itself either.
 *
 * The admin's page script runs it without a build (`registration.update()` only): the admin follows `runtime.json` itself
 * (`packages/admin/src/app/release-watch.ts`, `release-reload.ts`) with the same rules.
 */

/** What the page script knows of its build; none (the admin): only the worker is asked to update. */
export interface AppUpdateOptions {
    /** The build the page was made by (the site build writes it into the page's script). */
    readonly build?: string;
    /** The file beside the page that names the build Hosting serves now (`app-build.json`). */
    readonly version?: string;
}

/** The file a city site's build writes beside its page: `{"build": "<id>"}`. */
export const APP_BUILD_FILE = 'app-build.json';
/** The event fired on `window` when a newer build waits for a safe moment. */
export const UPDATE_EVENT = 'hcm-update-ready';
/** How often an open page looks for a new build. */
export const UPDATE_LOOK_MS = 15 * 60_000;
/** How often a waiting newer build tries the reload again. */
export const UPDATE_RETRY_MS = 15_000;
/** A visible page is idle once nobody pressed, typed or scrolled for this long. */
export const UPDATE_IDLE_MS = 60_000;
/** The `sessionStorage` key of the build this tab last reloaded for. */
export const UPDATE_RELOADED_KEY = 'hcm-app-reloaded-for';

/** What the page app (`window.HistoricCityMapApp`) gains from the watch. */
export interface AppUpdates {
    /** True while a newer build waits for a safe moment. */
    updateReady?: boolean;
    /** Holds the reload while `held()` says so (an open dialog); returns the call that lets go. */
    holdReload?: (held: () => boolean) => () => void;
    /** Reloads into the newer build now (the snackbar's Reload). */
    reload?: () => void;
}

/** The registration's part a look uses. */
interface RegistrationLike {
    update(): Promise<unknown>;
}

/** What the watch uses of `window`. */
export interface AppUpdateScope {
    HistoricCityMapApp?: AppUpdates;
    readonly navigator: { readonly serviceWorker?: { getRegistration(): Promise<RegistrationLike | undefined> } };
    readonly document: {
        readonly visibilityState: string;
        addEventListener(type: 'visibilitychange', listener: () => void): void;
    };
    readonly location: { reload(): void };
    readonly sessionStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
    readonly performance: { now(): number };
    fetch(url: string, init: { readonly cache: 'no-store' }): Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;
    setTimeout(handler: () => void, ms: number): unknown;
    setInterval(handler: () => void, ms: number): unknown;
    addEventListener(type: string, listener: () => void, options?: { readonly capture: boolean; readonly passive: boolean }): void;
    dispatchEvent(event: Event): boolean;
}

/** Records the reload for `build`; false when this tab already reloaded for it or cannot remember it (no loop). */
export function markReload(scope: Pick<AppUpdateScope, 'sessionStorage'>, build: string): boolean {
    try {
        if (scope.sessionStorage.getItem('hcm-app-reloaded-for') === build) {
            return false;
        }
        scope.sessionStorage.setItem('hcm-app-reloaded-for', build);
        return scope.sessionStorage.getItem('hcm-app-reloaded-for') === build;
    } catch {
        return false;
    }
}

/** The build Hosting serves now (`version`, read `no-store`), or null when the file names none. */
export async function servedBuild(scope: Pick<AppUpdateScope, 'fetch'>, version: string): Promise<string | null> {
    const response = await scope.fetch(version, { cache: 'no-store' });
    const body = (response.ok ? await response.json() : null) as { readonly build?: unknown } | null;
    const build = body?.build;
    return typeof build === 'string' && build !== '' ? build : null;
}

/** Whether the person leaves the page alone: no pointer pressed (a drag), and the page hidden or idle for a minute. */
export function watchInput(scope: Pick<AppUpdateScope, 'addEventListener' | 'document' | 'performance'>): () => boolean {
    const at = { pressed: false, input: scope.performance.now() };
    const touched = (pressed: boolean) => (): void => {
        at.pressed = pressed;
        at.input = scope.performance.now();
    };
    const passive = { capture: true, passive: true };
    scope.addEventListener('pointerdown', touched(true), passive);
    for (const type of ['pointerup', 'pointercancel', 'keydown', 'wheel']) {
        scope.addEventListener(type, touched(false), passive);
    }
    return () => !at.pressed && (scope.document.visibilityState === 'hidden' || scope.performance.now() - at.input >= 60_000);
}

/** When to look (at start, on focus, on a return, every 15 minutes) and to try a waiting reload (hidden, every 15 s). */
export function lookOn(
    scope: Pick<AppUpdateScope, 'addEventListener' | 'document' | 'setInterval'>,
    look: () => void,
    settle: () => void,
): void {
    scope.addEventListener('focus', look);
    scope.document.addEventListener('visibilitychange', () => {
        if (scope.document.visibilityState === 'hidden') {
            settle();
        } else {
            look();
        }
    });
    scope.setInterval(look, 15 * 60_000);
    scope.setInterval(settle, 15_000);
    look();
}

/** The watch's parts, each self-contained: the page script passes their source text in. */
export interface AppUpdateParts {
    readonly mark: typeof markReload;
    readonly served: typeof servedBuild;
    readonly input: typeof watchInput;
    readonly triggers: typeof lookOn;
}

/** The parts as this module has them (the unit tests; the page script writes the same functions' text). */
export const APP_UPDATE_PARTS: AppUpdateParts = { mark: markReload, served: servedBuild, input: watchInput, triggers: lookOn };

/** Starts the watch on `scope`'s app. Self-contained (its parts come in `parts`): its source text is part of the page's script. */
export function watchAppUpdates(scope: AppUpdateScope, options: AppUpdateOptions, parts: AppUpdateParts): void {
    const app = scope.HistoricCityMapApp;
    if (app === undefined) {
        return;
    }
    const holds = new Set<() => boolean>();
    const left = parts.input(scope);
    const at = { newer: null as string | null, looking: false };
    const free = (): boolean => left() && ![...holds].some((held) => held());
    const settle = (): void => {
        const newer = at.newer;
        if (newer === null) {
            return;
        }
        if (free() && parts.mark(scope, newer)) {
            scope.location.reload();
        } else if (app.updateReady !== true) {
            app.updateReady = true;
            scope.dispatchEvent(new Event('hcm-update-ready'));
        }
    };
    const look = (): void => {
        if (at.looking) {
            return;
        }
        at.looking = true;
        // A refused update (offline, a private window) and an unreadable build file are no news.
        void Promise.resolve()
            .then(() => scope.navigator.serviceWorker?.getRegistration())
            .then((registration) => registration?.update())
            .catch(() => undefined);
        const version = options.version;
        void (version === undefined ? Promise.resolve(null) : parts.served(scope, version))
            .then((build) => {
                if (build !== null && build !== options.build) {
                    at.newer = build;
                    settle();
                }
            })
            .catch(() => undefined)
            .finally(() => {
                at.looking = false;
            });
    };
    app.updateReady = false;
    app.holdReload = (held) => {
        holds.add(held);
        return () => {
            holds.delete(held);
        };
    };
    app.reload = () => {
        if (at.newer !== null) {
            parts.mark(scope, at.newer);
        }
        scope.location.reload();
    };
    parts.triggers(scope, look, settle);
}

/** The page script's lines that start the watch: `watchAppUpdates` with its parts, as source text, on `window`. */
export function appUpdateSource(options: AppUpdateOptions): string {
    const parts = `{ mark: ${markReload.toString()}, served: ${servedBuild.toString()}, input: ${watchInput.toString()}, triggers: ${lookOn.toString()} }`;
    return `(${watchAppUpdates.toString()})(window, ${JSON.stringify(options)}, ${parts});`;
}
