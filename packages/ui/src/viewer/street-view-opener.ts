/**
 * Opens Google Street View in a side-by-side split window on desktop browsers (Chrome, Firefox, and others that support
 * positioned popup windows), falling back to the anchor's native new-tab navigation when split placement is unavailable
 * (narrow/mobile screens, modified clicks, or a blocked popup). No user credentials or external scripts are used.
 */

/** Minimum available screen width (CSS px) to open Street View side-by-side instead of a normal tab. */
export const MIN_SPLIT_WIDTH = 900;

/** Named target so repeated Street View opens reuse the same side-by-side window. */
export const STREET_VIEW_WINDOW = 'hcm-street-view';

/** Screen geometry used to compute side-by-side placement. */
export interface SplitScreen {
    readonly availWidth: number;
    readonly availHeight: number;
    readonly availLeft?: number;
    readonly availTop?: number;
}

/** Minimal window host needed to open Street View (injectable for unit tests). */
export interface SplitWindowHost {
    readonly screen?: SplitScreen;
    readonly matchMedia?: (query: string) => { readonly matches: boolean };
    readonly open?: (url?: string | URL, target?: string, features?: string) => Window | null;
}

interface ReadySplitHost {
    readonly screen: SplitScreen;
    readonly open: (url?: string | URL, target?: string, features?: string) => Window | null;
}

function hasModifier(event: MouseEvent): boolean {
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** Whether a click event is a plain primary click that should attempt split-window placement. */
export function isPlainPrimaryClick(event: MouseEvent | undefined): boolean {
    return event === undefined || (event.button === 0 && !hasModifier(event));
}

function isCoarsePointer(host: SplitWindowHost): boolean {
    return host.matchMedia?.('(pointer: coarse)').matches === true;
}

/** Whether the host environment has enough room and pointer precision for a side-by-side window. */
export function canOpenSplitView(host: SplitWindowHost = globalThis): host is ReadySplitHost {
    if (typeof host.open !== 'function' || host.screen === undefined) {
        return false;
    }
    return host.screen.availWidth >= MIN_SPLIT_WIDTH && !isCoarsePointer(host);
}

/** Window feature string placing the Street View window on the right half of the available screen. */
export function splitWindowFeatures(screen: SplitScreen): string {
    const width = Math.floor(screen.availWidth / 2);
    const height = Math.floor(screen.availHeight);
    const left = Math.floor((screen.availLeft ?? 0) + width);
    const top = Math.floor(screen.availTop ?? 0);
    return [
        'popup=yes',
        `width=${String(width)}`,
        `height=${String(height)}`,
        `left=${String(left)}`,
        `top=${String(top)}`,
        'resizable=yes',
        'scrollbars=yes',
    ].join(',');
}

function finalizeSplitPopup(popup: Window, event: MouseEvent | undefined): void {
    popup.opener = null;
    popup.focus();
    event?.preventDefault();
}

/**
 * Attempts to open `url` in a side-by-side window. When successful and given a click `event`, prevents the anchor's
 * default new-tab navigation so only the split window opens. Returns `true` if opened in split view, `false` when the
 * caller should fall back to standard new-tab navigation.
 */
export function openStreetView(url: string, event?: MouseEvent, host: SplitWindowHost = globalThis): boolean {
    if (!isPlainPrimaryClick(event) || !canOpenSplitView(host)) {
        return false;
    }
    const popup = host.open(url, STREET_VIEW_WINDOW, splitWindowFeatures(host.screen));
    if (popup === null) {
        return false;
    }
    finalizeSplitPopup(popup, event);
    return true;
}
