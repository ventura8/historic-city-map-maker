/**
 * `<hcm-admin-shell>`: the admin's root element (`docs/research/M2b-interfaces.md` §1.2, §1.3). It renders the app it is
 * given (`app`, an `AdminAppPort`), one screen per auth state: a loading indicator, the sign-in, claim or join panel, a
 * blocked panel, or the shell itself: the navigation for the window class (bar on compact, collapsed rail from medium
 * and on a landscape phone, expanded rail from large), the top app bar with the page title and the account button, the
 * start-up banner, the page, the analytics consent banner. Messages show in the snackbar. Every screen's content is in
 * a landmark: a panel, the loading indicator, the start-up banner, the page and the snackbar are in `<main>`, beside the
 * navigation and the top app bar (`banner`); only the page scrolls, and the snackbar takes its own place below it
 * (shell-styles.ts). It applies the city's theme (or a live preview, or the kit's baseline) to itself and keeps
 * `<html lang>` on the admin's language. An editor page asks for its full-screen editor on a compact window or a
 * landscape phone (`hcm-chrome` `{chrome: 'editor'}`, `docs/research/M2c-interfaces.md` §1.3): the navigation bar (or
 * the landscape rail) hides while it shows, for that page only. A notice with an action (an editor's Undo) shows it in
 * the snackbar.
 */
import { DEFAULT_LOCALE, directionOf, translate, type AdminShellKey, type UiLocale, type ThemeTokens } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import type { ConsentDecision } from '../../components/consent-banner.js';
import { WindowClassController, type WindowSize } from '../../layout/window-class.js';
import { applyTheme, type ThemeMode } from '../../theme/apply.js';
import { BASELINE_THEME } from '../../theme/baseline.js';
import { accentTokens, type AccentChoice } from '../../theme/device-accent.js';
import type { WindowClass } from '../../theme/tokens.js';
import type { AdminAppPort, AdminAuthStatePort, AdminRouteIdPort, AdminStatePort } from '../admin-port.js';
import { welcomeName, welcomeOf } from '../auth/hcm-sign-in.js';
import type { PageChrome } from '../editing/hcm-list-detail.js';
import { EMPTY } from './empty.js';
import type { HcmAccountMenu } from './hcm-account-menu.js';
import { cityTitle } from './hcm-city-menu.js';
import { contentText, noticeOf, noticeText, pageLanguage, shellLanguage, shellText } from './text.js';
import type { AdminNavVariant } from './hcm-admin-nav.js';
import { paintRoot, unpaintRoot } from './root-surface.js';
import { releaseBanner, revokedBanner } from './shell-banners.js';
import { shellStyles } from './shell-styles.js';

export const HCM_ADMIN_SHELL_TAG = 'hcm-admin-shell';

/** How the shell lays out a window: its navigation, and whether it has a top app bar. */
export interface ShellLayout {
    readonly nav: AdminNavVariant;
    readonly topBar: boolean;
}

const NAV_BY_WIDTH: Readonly<Record<WindowClass, AdminNavVariant>> = {
    compact: 'bar',
    medium: 'rail',
    expanded: 'rail',
    large: 'expanded',
    'extra-large': 'expanded',
};

/** §1.2: a landscape phone (compact height) gets the rail and no top bar; otherwise the width decides. */
export function shellLayout(size: Pick<WindowSize, 'widthClass' | 'heightClass'>): ShellLayout {
    return size.heightClass === 'compact' ? { nav: 'rail', topBar: false } : { nav: NAV_BY_WIDTH[size.widthClass], topBar: true };
}

type Screen = 'loading' | 'signIn' | 'claim' | 'join' | 'blocked' | 'visitor' | 'shell';

const SCREENS: Readonly<Record<AdminAuthStatePort, Screen>> = {
    starting: 'loading',
    probing: 'loading',
    signingIn: 'loading',
    claiming: 'loading',
    signedOut: 'signIn',
    claimPending: 'claim',
    joinPending: 'join',
    configMissing: 'blocked',
    notOwner: 'blocked',
    notAdmin: 'blocked',
    backendDown: 'blocked',
    contributeClosed: 'blocked',
    bootstrap: 'shell',
    admin: 'shell',
    visitor: 'visitor',
};

/** What the loading indicator says the admin waits for (anything else: "Loading"). */
const LOADING_TEXTS: Readonly<Partial<Record<AdminAuthStatePort, AdminShellKey>>> = {
    signingIn: 'adminShell.auth.signingIn',
    claiming: 'adminShell.auth.claiming',
};

/** M13 §3: what a contributor waits for on the Contribute page: never the owner's check with Google. */
const CONTRIBUTOR_LOADING_TEXTS: Readonly<Partial<Record<AdminAuthStatePort, AdminShellKey>>> = {
    signingIn: 'adminShell.auth.signingIn',
};

function loadingText(state: AdminStatePort): string {
    const texts = welcomeOf(state) === null ? LOADING_TEXTS : CONTRIBUTOR_LOADING_TEXTS;
    return shellText(state.locale, texts[state.auth] ?? 'adminShell.loading');
}

/** The theme shown: Settings' live preview, else the city's, else the kit's baseline. */
export function themeTokensOf(state: AdminStatePort): ThemeTokens {
    return state.theme.preview ?? state.theme.city ?? BASELINE_THEME;
}

/**
 * The tokens the shell wears: `themeTokensOf` in the device's accent unless the admin chose the map's colours
 * (`theme/device-accent.ts`, the viewer's rule); Settings' live preview always shows the seed's own colours.
 */
export function shownTokens(state: AdminStatePort, doc: Document): ThemeTokens {
    const tokens = themeTokensOf(state);
    return state.theme.preview === null ? accentTokens(tokens, state.theme.accent ?? 'device', doc) : tokens;
}

/** The open page's name: its navigation label (the top bar's title, or the hidden heading without a top bar). */
function pageName(state: AdminStatePort): TemplateResult {
    const key: AdminShellKey = `adminShell.nav.${state.route.id}`;
    return html`<span lang=${shellLanguage(state.locale, key)}>${shellText(state.locale, key)}</span>`;
}

export class HcmAdminShell extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { state: true },
    };

    static override readonly styles = shellStyles;

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    readonly #size = new WindowClassController(this, {
        onChange: (size) => {
            this.app?.intents.setWindowClass(size.widthClass);
        },
    });
    #subscribed: { readonly app: AdminAppPort; readonly stop: () => void } | null = null;
    #theme: { readonly source: ThemeTokens; readonly accent: AccentChoice | undefined; readonly mode: ThemeMode } | null = null;
    /** The chrome the current page asked for, and for which route (a page that is gone cannot ask back). */
    #chrome: { readonly chrome: PageChrome; readonly route: AdminRouteIdPort } | null = null;
    /**
     * The account menu was open or held the focus before this update. A phone's rotation moves the menu between the top
     * bar and the rail's foot: the old one goes with its dialog, and the focus would fall to the page's body, so the new
     * one's button takes it (the hardening review's follow-up; S-A29-BAD-ROTATE-MENU-OPEN).
     */
    #accountWasActive = false;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.addEventListener('hcm-chrome', (event) => {
            this.#setChrome((event as CustomEvent<{ readonly chrome: PageChrome }>).detail.chrome);
        });
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#follow();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#stop();
        unpaintRoot(this.ownerDocument);
        this.#theme = null;
    }

    protected override willUpdate(): void {
        this.#follow();
        this.#accountWasActive = this.#accountMenu()?.active ?? false;
    }

    protected override updated(): void {
        const state = this.state;
        if (state !== null) {
            this.#applyTheme(state);
            // The page's language, its direction (Arabic, Persian, Urdu: right to left) and its tab's title follow the
            // admin's (the static page is Romanian).
            this.ownerDocument.documentElement.lang = state.locale;
            this.ownerDocument.documentElement.dir = directionOf(state.locale);
            const welcome = welcomeName(state, SCREENS[state.auth] === 'shell');
            this.ownerDocument.title =
                welcome === null ? `${shellText(state.locale, 'adminShell.appName')}${cityTitle(state)}` : `${welcome.app}${welcome.city}`;
        }
        this.#keepAccountFocus();
        // The framed screens are an app shell: the page under them never scrolls (packages/admin/src/admin.css).
        this.toggleAttribute('data-frame', this.renderRoot.querySelector('.frame') !== null);
    }

    #accountMenu(): HcmAccountMenu | null {
        return this.renderRoot.querySelector('hcm-account-menu');
    }

    /** The account menu moved (a rotation) while it was in use: its new button takes the focus. */
    #keepAccountFocus(): void {
        const menu = this.#accountMenu();
        if (this.#accountWasActive && menu !== null && !menu.active) {
            void menu.focusButton();
        }
        this.#accountWasActive = false;
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return html`<main class="screen">${this.#loading(shellText(DEFAULT_LOCALE, 'adminShell.loading'))}</main>`;
        }
        const screen = SCREENS[state.auth];
        if (screen === 'shell') {
            return this.#frame(state);
        }
        return screen === 'visitor'
            ? this.#visitor(state)
            : html`<main class="screen">${this.#panel(screen, state)} ${this.#snackbar(state)}</main>`;
    }

    /** Subscribes to the current app (once per app, while connected). */
    #follow(): void {
        const app = this.app;
        if (app === null || !this.isConnected || this.#subscribed?.app === app) {
            return;
        }
        this.#stop();
        const stop = app.subscribe((state) => {
            this.state = state;
        });
        this.#subscribed = { app, stop };
        this.state = app.state;
        app.intents.setWindowClass(this.#size.size.widthClass);
    }

    #stop(): void {
        this.#subscribed?.stop();
        this.#subscribed = null;
    }

    #setChrome(chrome: PageChrome): void {
        const route = this.state?.route.id;
        if (route !== undefined) {
            this.#chrome = { chrome, route };
            this.requestUpdate();
        }
    }

    /** The full-screen editor hides the compact bar, or the landscape phone's rail. */
    #hidesNav(state: AdminStatePort, layout: ShellLayout): boolean {
        const editor = this.#chrome?.chrome === 'editor' && this.#chrome.route === state.route.id;
        return editor && (layout.nav === 'bar' || !layout.topBar);
    }

    #applyTheme(state: AdminStatePort): void {
        const theme = { source: themeTokensOf(state), accent: state.theme.accent, mode: state.theme.mode };
        const last = this.#theme;
        if (last?.source !== theme.source || last.accent !== theme.accent || last.mode !== theme.mode) {
            this.#theme = theme;
            const tokens = shownTokens(state, this.ownerDocument);
            applyTheme(this, tokens, theme.mode, false);
            // M6 (finding 22): the page's root under the shell has the same surface, so no band of another colour shows.
            paintRoot(this.ownerDocument, tokens, theme.mode);
        }
    }

    /** The loading screen; its page heading is the app's name, for screen readers (M6: the tour's `shell.loading`). */
    #loading(text: string): TemplateResult {
        return html`<h1 class="visually-hidden">${this.#appName()}</h1>
            <div class="loading" role="status">
                <hcm-loading-indicator .label=${text}></hcm-loading-indicator>
                <p>${text}</p>
            </div>`;
    }

    /** The app's name before the shell shows: Contribute on the Contribute page's address (M13 §3), else the administration. */
    #appName(): string {
        const state = this.state;
        if (state === null) {
            return shellText(DEFAULT_LOCALE, 'adminShell.appName');
        }
        return welcomeName(state, false)?.app ?? shellText(state.locale, 'adminShell.appName');
    }

    /** M13 §3: the Contribute page of an account of no role: the page and the account menu, no navigation. */
    #visitor(state: AdminStatePort): TemplateResult {
        return html`<div class="frame" data-nav="none">
            <div class="column">
                <header class="top-bar">
                    <h1>${pageName(state)}</h1>
                    <hcm-account-menu .app=${this.app} .state=${state}></hcm-account-menu>
                </header>
                <main class="content">
                    <div class="scroller" lang=${pageLanguage(state.locale, state.route.id)}>
                        <hcm-page-outlet .app=${this.app} .state=${state}></hcm-page-outlet>
                    </div>
                    ${this.#snackbar(state)}
                </main>
            </div>
        </div>`;
    }

    #panel(screen: Exclude<Screen, 'shell' | 'visitor'>, state: AdminStatePort): TemplateResult {
        const app = this.app;
        const panels: Readonly<Record<Exclude<Screen, 'shell' | 'visitor'>, () => TemplateResult>> = {
            loading: () => this.#loading(loadingText(state)),
            signIn: () => html`<hcm-sign-in .app=${app} .state=${state}></hcm-sign-in>`,
            claim: () => html`<hcm-claim-panel .app=${app} .state=${state}></hcm-claim-panel>`,
            join: () => html`<hcm-join-panel .app=${app} .state=${state}></hcm-join-panel>`,
            blocked: () => html`<hcm-blocked-panel .app=${app} .state=${state}></hcm-blocked-panel>`,
        };
        return panels[screen]();
    }

    /** The navigation for the layout, or nothing while a compact full-screen editor shows. */
    #nav(state: AdminStatePort, layout: ShellLayout): TemplateResult {
        if (this.#hidesNav(state, layout)) {
            return EMPTY;
        }
        return html`<hcm-admin-nav
            .destinations=${state.destinations}
            .current=${state.route.id}
            .variant=${layout.nav}
            .locale=${state.locale}
            .unread=${state.unread ?? null}
            data-layout-check="nav"
        >
            ${layout.topBar ? EMPTY : html`<hcm-account-menu slot="foot" .app=${this.app} .state=${state} cities></hcm-account-menu>`}
        </hcm-admin-nav>`;
    }

    #frame(state: AdminStatePort): TemplateResult {
        const layout = shellLayout(this.#size.size);
        const shown = this.#nav(state, layout);
        return html`<div class="frame" data-nav=${this.#hidesNav(state, layout) ? 'none' : layout.nav}>
                ${layout.nav === 'bar' ? EMPTY : shown}
                <div class="column">
                    ${layout.topBar ? this.#topBar(state, layout) : EMPTY}
                    <main class="content">
                        ${this.#pageTitle(state, layout)}
                        <div class="scroller" lang=${pageLanguage(state.locale, state.route.id)}>
                            ${this.#banners(state)}<hcm-page-outlet .app=${this.app} .state=${state}></hcm-page-outlet>
                        </div>
                        ${this.#snackbar(state)}
                    </main>
                    ${this.#consent(state)}
                </div>
                ${layout.nav === 'bar' ? shown : EMPTY}
            </div>
            ${this.#leaving(state)}`;
    }

    /**
     * M5: from the medium window class the top bar names the open city (its menu switches); compact puts the menu in the
     * account menu and the city's name in the title.
     */
    #topBar(state: AdminStatePort, layout: ShellLayout): TemplateResult {
        const compact = layout.nav === 'bar';
        return html`<header class="top-bar">
            <h1>${pageName(state)}${compact ? cityTitle(state) : ''}</h1>
            ${compact ? EMPTY : html`<hcm-city-menu .app=${this.app} .state=${state}></hcm-city-menu>`}
            <hcm-account-menu .app=${this.app} .state=${state} ?cities=${compact}></hcm-account-menu>
        </header>`;
    }

    /**
     * A phone held sideways has no top bar (its height goes to the page): the page's title stays its one level-one heading
     * for assistive technology, out of sight, in `<main>` (axe's `page-has-heading-one` and `region`).
     */
    #pageTitle(state: AdminStatePort, layout: ShellLayout): TemplateResult {
        return layout.topBar ? EMPTY : html`<h1 class="visually-hidden">${pageName(state)}${cityTitle(state)}</h1>`;
    }

    /** Above the page: a revoked access (§35e), a newer admin to reload (finding 29 of 2026-10-31), the start-up mode. */
    #banners(state: AdminStatePort): TemplateResult {
        const signOut = (): void => {
            void this.app?.intents.signOut();
        };
        const reload = (): void => {
            this.app?.intents.reload();
        };
        return html`${revokedBanner(state, signOut)}${releaseBanner(state, reload)}${this.#banner(state)}`;
    }

    #banner(state: AdminStatePort): TemplateResult {
        return state.auth === 'bootstrap'
            ? html`<p class="banner" role="note">${shellText(state.locale, 'adminShell.bootstrap.banner')}</p>`
            : EMPTY;
    }

    /** "Discard your changes?" before leaving an edit that is not saved (Keep editing has the focus). */
    #leaving(state: AdminStatePort): TemplateResult {
        const keep = (): void => {
            this.app?.intents.stayOnPage();
        };
        const leave = (): void => {
            void this.app?.intents.leavePage();
        };
        return html`<hcm-confirm-dialog
            destructive
            .open=${(state.leaving ?? null) !== null}
            .headline=${contentText(state.locale, 'adminContent.common.unsavedTitle')}
            .body=${contentText(state.locale, 'adminContent.common.unsavedBody')}
            .confirmLabel=${contentText(state.locale, 'adminContent.common.discard')}
            .cancelLabel=${contentText(state.locale, 'adminContent.common.keepEditing')}
            .closeLabel=${contentText(state.locale, 'adminContent.common.close')}
            @hcm-confirm=${leave}
            @hcm-cancel=${keep}
        ></hcm-confirm-dialog>`;
    }

    /** The analytics consent banner, while GA4 is configured and the admin has not answered. */
    #consent(state: AdminStatePort): TemplateResult {
        if (!state.analytics || state.consent !== 'unknown') {
            return EMPTY;
        }
        const locale: UiLocale = state.locale;
        const decide = (event: CustomEvent<{ readonly decision: ConsentDecision }>): void => {
            this.app?.intents.setConsent(event.detail.decision);
        };
        return html`<hcm-consent-banner
            data-layout-check="consent"
            .headline=${translate(locale, 'consent.title')}
            .body=${translate(locale, 'consent.body')}
            .acceptLabel=${translate(locale, 'consent.accept')}
            .declineLabel=${translate(locale, 'consent.decline')}
            @hcm-consent=${decide}
        ></hcm-consent-banner>`;
    }

    #snackbar(state: AdminStatePort): TemplateResult {
        const dismiss = (): void => {
            this.app?.intents.dismissNotice();
        };
        const action = state.notice?.action;
        const act = (): void => {
            action?.run();
        };
        return html`<hcm-snackbar
            data-layout-check="snackbar"
            .message=${noticeOf(state.locale, state.notice)}
            .actionLabel=${action === undefined ? '' : noticeText(state.locale, action.key)}
            .closeLabel=${shellText(state.locale, 'adminShell.notice.close')}
            .timeoutMs=${action === undefined ? 8000 : 10_000}
            @hcm-action=${act}
            @hcm-dismiss=${dismiss}
        ></hcm-snackbar>`;
    }
}

/** Registers `<hcm-admin-shell>` once; calling it again is a no-op. */
export function defineHcmAdminShell(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_SHELL_TAG) === undefined) {
        registry.define(HCM_ADMIN_SHELL_TAG, HcmAdminShell);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-shell': HcmAdminShell;
    }
}
