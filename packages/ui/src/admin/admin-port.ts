/**
 * What the admin's elements need from the admin app (`docs/research/M2b-interfaces.md` §1.7).
 *
 * `@hcm/ui` sits below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so the elements cannot import its types. This
 * file mirrors them structurally, as `store-port.ts` does for the viewer: `mount` of `@hcm/admin` returns an `AdminApp`
 * assignable to `AdminAppPort`, which `packages/admin/test/app/admin-port.test.ts` checks at compile time. The elements
 * render `state` and call the intents; they never touch Firebase, Google or the address themselves.
 */
import type { CityRole, UiLocale, ThemeTokens } from '@hcm/shared';

import type { ThemeMode } from '../theme/apply.js';
import type { AccentChoice } from '../theme/device-accent.js';
import type { ContentPort } from './content-port.js';
import type { AdminNoticeInputPort } from './notice-port.js';
import type { SetupIntentsPort, SetupViewState } from './setup/setup-port.js';

export type AdminAuthStatePort =
    | 'starting'
    | 'configMissing'
    | 'signedOut'
    | 'signingIn'
    | 'probing'
    | 'bootstrap'
    | 'notOwner'
    | 'backendDown'
    | 'claimPending'
    | 'claiming'
    | 'joinPending'
    | 'notAdmin'
    | 'admin'
    | 'visitor'
    | 'contributeClosed';

export type AdminRouteIdPort =
    | 'home'
    | 'setup'
    | 'photos'
    | 'pois'
    | 'stories'
    | 'layers'
    | 'imagery'
    | 'jobs'
    | 'inbox'
    | 'settings'
    | 'admins'
    | 'history'
    | 'crashes'
    | 'georef'
    | 'help'
    | 'cities'
    | 'review'
    | 'contribute';

export interface AdminRoutePort {
    readonly id: AdminRouteIdPort;
    readonly params: readonly string[];
}

/** One destination of the navigation: its route, its icon, and whether the compact bar shows it (else "More"). */
export interface AdminDestinationPort {
    readonly id: AdminRouteIdPort;
    readonly icon: string;
    readonly compact: boolean;
}

export type { AdminNoticeInputPort, AdminNoticeKey, AdminOutcomePort } from './notice-port.js';

export interface AdminNoticePort extends AdminNoticeInputPort {
    readonly id: number;
}

/** M5 (`docs/research/M5-interfaces.md` §1.5): one of the signed-in admin's cities. */
export interface AdminCityPort {
    readonly id: string;
    readonly role: CityRole;
    readonly name: { readonly ro: string; readonly en?: string | undefined };
}

/** M13 §3: what the map's link said of the city a visitor came to contribute to, and the way back to that map. */
export interface AdminWelcomePort {
    readonly cityId: string | null;
    readonly cityName: string | null;
    readonly mapUrl: string;
}

export interface AdminStatePort {
    readonly auth: AdminAuthStatePort;
    readonly mode: 'bootstrap' | 'normal' | null;
    readonly user: { readonly uid: string; readonly email: string | null; readonly displayName: string | null } | null;
    readonly role: 'owner' | 'admin' | null;
    readonly busy: boolean;
    readonly gate: { readonly reconsent: boolean; readonly issue: AdminNoticePort | null; readonly enableApi: string | null };
    readonly route: AdminRoutePort;
    readonly destinations: readonly AdminDestinationPort[];
    readonly locale: UiLocale;
    readonly theme: {
        readonly mode: ThemeMode;
        /** The colours: the device's accent (the default, also when absent) or the city's own. */
        readonly accent?: AccentChoice;
        readonly city: ThemeTokens | null;
        readonly preview: ThemeTokens | null;
    };
    readonly consent: 'unknown' | 'granted' | 'denied';
    readonly analytics: boolean;
    readonly windowClass: string;
    readonly notice: AdminNoticePort | null;
    /** The unsaved-changes question while the shell asks it (`docs/research/M2c-interfaces.md` §2.4; M5: another city). */
    readonly leaving?:
        | { readonly kind: 'route'; readonly route: AdminRoutePort }
        | { readonly kind: 'signOut' }
        | { readonly kind: 'city'; readonly cityId: string }
        | null;
    /** The access was removed while an editor held changes: the page stays read-only under a banner until sign-out (§35e). */
    readonly revoked?: boolean;
    /** Finding 29 of 2026-10-31: the admin release Hosting serves instead of this tab's (the shell offers Reload), or null. */
    readonly newRelease?: string | null;
    /** The admins' names by uid, once a conflict asked for them (who saved a change). */
    readonly people?: Readonly<Record<string, string>>;
    /** M4: the signed-in admin's unread notifications (up to `INBOX_BADGE_MAX` + 1), null while unknown. */
    readonly unread?: number | null;
    /** M5: the admin's cities, by name; the current one; whether the admin owns the project. */
    readonly cities?: readonly AdminCityPort[];
    readonly cityId?: string | null;
    readonly projectOwner?: boolean;
    readonly projectId: string;
    readonly authDomain: string;
    /** M13 §3: the Contribute page's welcome while its address is open (signed out it replaces the admin's sign-in). */
    readonly welcome?: AdminWelcomePort | null;
    /** The Setup Assistant's state (setup-ui's `SetupViewState`), null before its controller exists or without one. */
    readonly setup: SetupViewState | null;
}

export interface AdminIntentsPort {
    signIn(): Promise<void>;
    signOut(): Promise<void>;
    /** The unsaved-changes question: keep editing. */
    stayOnPage(): void;
    /** The unsaved-changes question: discard and leave. */
    leavePage(): Promise<void>;
    claim(): Promise<void>;
    join(): Promise<void>;
    retry(): Promise<void>;
    enableApi(): Promise<void>;
    reload(): void;
    navigate(route: AdminRoutePort): void;
    /** M5: opens another of the admin's cities (a page load; an unsaved edit is asked about first). */
    switchCity?(cityId: string, route?: AdminRoutePort): void;
    /** M5: asks the server for the admin's cities again (the city menu opening: at most once a minute; `now`: at once). */
    refreshCities?(now?: boolean): Promise<void>;
    setLocale(locale: UiLocale): void;
    setTheme(mode: ThemeMode): void;
    /** The colours of the admin: the device's accent or the city's own, remembered on this browser. */
    setAccent(accent: AccentChoice): void;
    setConsent(consent: 'granted' | 'denied'): void;
    dismissNotice(): void;
    setWindowClass(windowClass: string): void;
    /** The Setup Assistant's intents (setup-ui's `SetupIntentsPort`), null without one. */
    readonly setup: SetupIntentsPort | null;
}

export interface AdminAppPort {
    readonly state: AdminStatePort;
    subscribe(listener: (state: AdminStatePort) => void): () => void;
    readonly intents: AdminIntentsPort;
    /** The tag of a route's page element, once its module is loaded (null: no page); rejects when the module does not load. */
    loadPage(id: AdminRouteIdPort): Promise<string | null>;
    /** The editors' area stores (`docs/research/M2c-interfaces.md` §2.3). */
    readonly content: ContentPort;
}

/**
 * A page element (`registerAdminPage`): the shell creates it with the tag its loader names and sets `app` and `state`
 * on every change. Setup-ui's `<hcm-setup-page>` and M2c's pages implement this.
 */
export interface AdminPageElement extends HTMLElement {
    app: AdminAppPort | null;
    state: AdminStatePort | null;
}
