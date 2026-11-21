/**
 * The browser abilities the viewer uses besides the store: sharing the page, the clipboard, the visitor's position,
 * the page address and media queries. `<hcm-map-viewer>` takes them as one injectable `services` object, so tests
 * drive every outcome (granted, denied, outside the city, no Web Share API) without a real browser permission.
 *
 * The visitor's position never leaves the page: it moves the camera once, draws the blue dot, and is neither stored nor
 * logged.
 */
import type { MessageKey } from '@hcm/shared';

import type { MyLocationFix } from './store-port.js';

export interface ViewerServices {
    /** The Web Share API, when the browser has it. */
    readonly share: ((data: { readonly title: string; readonly url: string }) => Promise<void>) | null;
    /** Writes text to the clipboard. */
    readonly copyText: (text: string) => Promise<void>;
    /**
     * Watches the visitor's position: `onFix` with each one, `onError` with what failed (an object whose `code` is 1 when
     * permission was denied); the returned call stops watching.
     */
    readonly watchPosition: (onFix: (fix: MyLocationFix) => void, onError: (error: unknown) => void) => () => void;
    /** The page address to share (the URL hash carries the viewer state). */
    readonly pageUrl: () => string;
    readonly matchMedia: (query: string) => MediaQueryList;
    /** M13: opens a page of its own (the Contribute page), with nothing of this page passed on. */
    readonly openPage: (url: string) => void;
    /**
     * Side-loads `<hcm-lightbox>` (`extras-loader.ts`): the engine sets it; without it the element must be defined already
     * (the kit's own tests).
     */
    readonly loadExtras?: () => Promise<void>;
}

/** How long the browser may look for a position, and how old a cached one may be; the dot wants the device's best. */
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 };

/** The device's direction of travel; none standing still (NaN) or without one (null). */
function headingOf(coords: GeolocationCoordinates): number | null {
    const heading = coords.heading;
    return Number.isFinite(heading) ? heading : null;
}

function watchWith(
    geolocation: Geolocation | undefined,
    onFix: (fix: MyLocationFix) => void,
    onError: (error: unknown) => void,
): () => void {
    if (geolocation === undefined) {
        queueMicrotask(() => {
            onError(new Error());
        });
        return () => undefined;
    }
    const id = geolocation.watchPosition(
        ({ coords }) => {
            onFix({ center: [coords.longitude, coords.latitude], accuracy: coords.accuracy, heading: headingOf(coords) });
        },
        onError,
        POSITION_OPTIONS,
    );
    return () => {
        geolocation.clearWatch(id);
    };
}

/** The real browser services of `win`. */
export function browserServices(win: Window): ViewerServices {
    const navigator = win.navigator as Partial<Navigator>;
    const share = navigator.share === undefined ? null : (data: ShareData) => win.navigator.share(data);
    return {
        share,
        copyText: (text) => win.navigator.clipboard.writeText(text),
        watchPosition: (onFix, onError) => watchWith(navigator.geolocation, onFix, onError),
        pageUrl: () => win.location.href,
        matchMedia: (query) => win.matchMedia(query),
        openPage: (url) => {
            win.open(url, '_blank', 'noopener');
        },
    };
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

async function copyLink(services: ViewerServices, url: string): Promise<ShareOutcome> {
    try {
        await services.copyText(url);
        return 'copied';
    } catch {
        return 'failed';
    }
}

/**
 * Shares the page: the Web Share API when there is one (closing its sheet is "cancelled", not an error), else, or
 * when it fails, the clipboard.
 */
export async function sharePage(services: ViewerServices, title: string): Promise<ShareOutcome> {
    const url = services.pageUrl();
    if (services.share === null) {
        return copyLink(services, url);
    }
    try {
        await services.share({ title, url });
        return 'shared';
    } catch (error: unknown) {
        return isAbort(error) ? 'cancelled' : copyLink(services, url);
    }
}

/** The message a share outcome shows; a completed or cancelled share needs none. */
export function shareMessage(outcome: ShareOutcome): MessageKey | null {
    if (outcome === 'copied') {
        return 'share.copied';
    }
    return outcome === 'failed' ? 'share.failed' : null;
}

/** Whether a position error is the visitor's refusal (`PERMISSION_DENIED`). */
export function isDenied(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 1;
}

/**
 * The absolute address of a photo image: manifest image URLs are https or relative to the manifest, and an inline
 * manifest's are relative to the page. Null when the address cannot be resolved.
 */
export function resolveAssetUrl(path: string, manifestUrl: string, baseUri: string): string | null {
    try {
        return new URL(path, new URL(manifestUrl, baseUri)).href;
    } catch {
        return null;
    }
}
