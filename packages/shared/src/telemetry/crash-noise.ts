/**
 * What a crash report is not (`docs/ARCHITECTURE.md` → *Analytics and crashes*): errors the page did not cause, dropped
 * where they happen (the viewer's and the admin's reporters) and again by `telemetry.reportError`, each with its reason
 * code in the log, never hidden in the Crashes list. And the browser of a report, reduced to what a crash needs.
 *
 * - `injected`: a script the browser itself injects into every page (Firefox for iOS's reader mode `__firefox__`,
 *   Chrome for iOS's `__gCrWeb`, in-app browsers' bridges); its stack is the page's own address at line 1, which no
 *   file of ours is (the HTML has no inline script). The Crashes groups of 2026-11-11 ("Can't find variable:
 *   __firefox__", "window.__firefox__.reader").
 * - `extension`: a frame of a browser extension (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`).
 * - `aborted`: an `AbortError`, a fetch the page itself cancelled (a panel closed, a newer request).
 */

/** Why an error is no crash of ours. */
export type CrashNoise = 'injected' | 'extension' | 'aborted';

const INJECTED_GLOBALS = /__firefox__|__gCrWeb|webkit\.messageHandlers|_AutofillCallbackHandler|__isAndroid|ucbrowser/i;
const EXTENSION_FRAME = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
/** A frame at line 1 of an HTML page (`…/:1:12`, `…/index.html:1:3`): an injected script, our code lives in `.js` files. */
const PAGE_FRAME = /https?:\/\/[^\s()]*?(?:\/|\.html?):1:\d+\)?$/;
const FRAME = /(?:^\s*at\s|@)/;

/** A field of an error-like value as text: a string error is its own message; anything else gives ''. */
function fieldOf(error: unknown, key: 'name' | 'message' | 'stack'): string {
    if (typeof error === 'string') {
        return key === 'message' ? error : '';
    }
    const value = recordOf(error)[key];
    return typeof value === 'string' ? value : '';
}

/** An object's fields, or none. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The stack's frame lines (V8's `at …` and Gecko/WebKit's `fn@url`). */
function framesOf(stack: string): readonly string[] {
    return stack
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => FRAME.test(line));
}

function injected(message: string, frames: readonly string[]): boolean {
    return INJECTED_GLOBALS.test(message) || (frames.length > 0 && frames.every((frame) => PAGE_FRAME.test(frame)));
}

/** The reason `error` is no crash of the page's, or null when it is one. */
export function crashNoiseOf(error: unknown): CrashNoise | null {
    if (fieldOf(error, 'name') === 'AbortError') {
        return 'aborted';
    }
    const stack = fieldOf(error, 'stack');
    const frames = framesOf(stack);
    if (frames.some((frame) => EXTENSION_FRAME.test(frame))) {
        return 'extension';
    }
    return injected(fieldOf(error, 'message'), frames) ? 'injected' : null;
}

/** The device class of a User-Agent: what a crash needs to know about the screen, nothing more. */
type DeviceClass = 'mobile' | 'tablet' | 'desktop';

const BROWSERS: readonly (readonly [string, RegExp])[] = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Opera', /(?:OPR|OPT)\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    // After Chrome: Android's web view says Version/4.0 beside Chrome/.
    ['Safari', /Version\/(\d+)/],
];

function deviceOf(userAgent: string): DeviceClass {
    // An Android tablet's User-Agent says Android without Mobile.
    if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) {
        return 'tablet';
    }
    return /Mobi|iPhone|Android/i.test(userAgent) ? 'mobile' : 'desktop';
}

/**
 * `Firefox 145 mobile`: the browser family, its major version and the device class of a User-Agent, never the string
 * itself (no build numbers, no OS version, no device model). `Other` for a browser not listed.
 */
export function clientLabel(userAgent: string): string {
    const found = BROWSERS.map(([name, pattern]) => [name, pattern.exec(userAgent)?.[1]] as const).find(([, major]) => major !== undefined);
    const browser = found === undefined ? 'Other' : `${found[0]} ${String(found[1])}`;
    return `${browser} ${deviceOf(userAgent)}`;
}
