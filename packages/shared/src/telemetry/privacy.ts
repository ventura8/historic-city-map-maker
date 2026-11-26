/**
 * The browser's own privacy signals (`docs/ARCHITECTURE.md` → *Analytics and crashes*, DECISIONS-for-review.md §200): the viewer
 * and the admin read them before asking for consent.
 */
/** What a browser says of tracking: Do Not Track (`navigator.doNotTrack`) and Global Privacy Control. */
export interface PrivacyNavigator {
    readonly doNotTrack?: string | null;
    readonly globalPrivacyControl?: boolean;
}

/**
 * True when the browser asks not to be tracked (Do Not Track `1` or Global Privacy Control on): the viewer and the admin
 * then take it as a refusal until the person accepts in About or the account menu, and show no banner.
 */
export function privacySignal(nav: PrivacyNavigator | undefined): boolean {
    return nav?.doNotTrack === '1' || nav?.globalPrivacyControl === true;
}
