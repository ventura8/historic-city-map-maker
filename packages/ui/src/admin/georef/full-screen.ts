/**
 * M22 (`docs/research/M22-help-calibrate.md` §13.2): the georeferencer's full screen. The page covers the window, so everything around
 * it (the navigation, the top bar) is made `inert` while it does, as a modal would: nothing hidden under it can be reached by Tab or a
 * screen reader. What it made inert, and only that, is given back when it ends.
 */

/** Every element beside `start` and beside each of its ancestors, across shadow roots, not already inert. */
export function surroundings(start: Element): Element[] {
    const found: Element[] = [];
    let node: Element | null = start;
    while (node !== null) {
        const parent: ParentNode | null = node.parentNode;
        const here: Element = node;
        found.push(...[...(parent?.children ?? [])].filter((child) => child !== here && !child.hasAttribute('inert')));
        node = parent instanceof ShadowRoot ? parent.host : node.parentElement;
    }
    return found;
}

export class FullScreenInert {
    #made: Element[] = [];

    /** On: everything around `host` inert; off: what was made inert given back. */
    cover(host: Element, on: boolean): void {
        for (const element of this.#made.splice(0)) {
            element.removeAttribute('inert');
        }
        if (on) {
            this.#made = surroundings(host);
            for (const element of this.#made) {
                element.setAttribute('inert', '');
            }
        }
    }
}

/** The Fullscreen API as a browser may have it: the standard names, or Safari's prefixed ones before 16.4, or neither. */
interface ScreenElement {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void>;
}
interface ScreenDocument {
    fullscreenElement?: Element | null;
    webkitFullscreenElement?: Element | null;
    exitFullscreen?: () => Promise<void>;
    webkitExitFullscreen?: () => Promise<void>;
}

/** The element the browser shows on the whole screen (null: none). */
export function screenElement(doc: Document = document): Element | null {
    const api = doc as ScreenDocument;
    return api.fullscreenElement ?? api.webkitFullscreenElement ?? null;
}

/** Runs the first of the two calls the browser has; false when it has neither or the call is refused. */
async function attempt(target: object, call: (() => Promise<void>) | undefined): Promise<boolean> {
    if (call === undefined) {
        return false;
    }
    try {
        await call.call(target);
        return true;
    } catch {
        return false;
    }
}

/**
 * The owner, 2026-11-16: full screen really fills the screen. Asks the browser to show `element` on the whole screen, hiding its own
 * bars; true when it did, false when it refused (no API, a policy, an iframe without permission): the caller keeps the in-page maximise.
 */
export function enterScreen(element: Element): Promise<boolean> {
    const api = element as ScreenElement;
    return attempt(element, api.requestFullscreen ?? api.webkitRequestFullscreen);
}

/** Leaves the browser's full screen when it shows something (already left, as by Esc meanwhile: nothing to do). */
export async function leaveScreen(doc: Document = document): Promise<void> {
    if (screenElement(doc) !== null) {
        const api = doc as ScreenDocument;
        await attempt(doc, api.exitFullscreen ?? api.webkitExitFullscreen);
    }
}
