/**
 * The browser seams of the admin (`docs/research/M2b-interfaces.md` §1.7): time, page visibility, web storage and the
 * address. `browser.ts` adapts the real `window`; the node tests pass fakes, so every decision of the admin is tested
 * without a DOM.
 */

/** Stops a subscription; calling it twice is harmless. */
export type Unsubscribe = () => void;

/** Polls, countdowns and token lifetimes run on this clock, so tests advance a fake one. */
export interface Clock {
    /** Epoch milliseconds. */
    now(): number;
    /** Runs `callback` once after `delayMs`; the returned handle cancels it. */
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** Whether the tab is visible: every poll pauses while it is hidden (§1.5). */
export interface PageVisibility {
    visible(): boolean;
    onChange(listener: (visible: boolean) => void): Unsubscribe;
}

/**
 * `sessionStorage` or `localStorage`. A storage that throws (a private window, blocked site data) behaves as an empty
 * one that forgets every write: the admin works without it.
 */
export interface KeyValueStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
    /** Every stored key (the sign-out removes the admin's own). */
    keys(): readonly string[];
}

/** The page's address: the hash routes (§1.1), the `?lang=` and `?test=` query, and a reload. */
export interface HashLocation {
    /** `#/photos/abc`, or `''`. */
    hash(): string;
    /** Navigates (a history entry) or, with `replace`, rewrites the address without one. */
    setHash(hash: string, replace: boolean): void;
    onHashChange(listener: (hash: string) => void): Unsubscribe;
    /** `?lang=en`, or `''`. */
    search(): string;
    /** `location.origin + location.pathname`: what analytics and crash reports may know of the page. */
    page(): string;
    reload(): void;
}
