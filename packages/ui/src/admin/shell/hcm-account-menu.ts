/**
 * `<hcm-account-menu>`: the account button of the top app bar (or of the rail's foot on a landscape phone) and its
 * dialog (`docs/research/M2b-interfaces.md` §1.2): who is signed in, the language (any of `docs/I18N.md`'s: switching keeps
 * every form's state), the theme (follow my device, light, dark), the colours (device accent, map colours), the analytics
 * consent (withdrawable at any time, when GA4 is
 * configured), **Install app** while the browser offers it (`../../app-install.ts`) and Sign out. A rotation of a phone moves it between the top bar and the rail: the shell then gives the
 * new one's button the focus the old one held (`active`, `focusButton`).
 */
import { isUiLocale, translate, type UiLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { installApp, installGivesAccent, watchInstall } from '../../app-install.js';
import { UI_LANGUAGE_OPTIONS } from '../../components/language-options.js';

import type { SegmentOption } from '../../components/segmented-button.js';
import type { ThemeMode } from '../../theme/apply.js';
import { ACCENT_CHOICES, accentOf, deviceAccentState } from '../../theme/device-accent.js';
import type { AdminAppPort, AdminStatePort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { EMPTY } from './empty.js';
import { showsCityMenu } from './hcm-city-menu.js';
import { shellLanguage, shellText } from './text.js';

export const HCM_ACCOUNT_MENU_TAG = 'hcm-account-menu';

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function themeOptions(locale: UiLocale): SegmentOption[] {
    return THEMES.map((mode) => ({ value: mode, label: translate(locale, `theme.${mode}`) }));
}

function isThemeMode(value: string): value is ThemeMode {
    return (THEMES as readonly string[]).includes(value);
}

function accentOptions(locale: UiLocale): SegmentOption[] {
    return ACCENT_CHOICES.map((accent) => ({ value: accent, label: translate(locale, `accent.${accent}`) }));
}

/** Why Device accent cannot show here (`deviceAccentState`), per state. */
const ACCENT_NOTES = {
    hidden: ['accent.hidden', 'accent.hiddenFix'],
    grey: ['accent.grey', 'accent.greyFix'],
} as const;

export class HcmAccountMenu extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        /** M5: the city switcher sits here (a compact window, or a phone held sideways: no top bar to hold it). */
        cities: { type: Boolean },
        open: { state: true },
        installable: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: inline-flex;
            }

            .content {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            .group {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .group-label,
            .who {
                font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }

            .accent-note {
                margin: 0;
                max-inline-size: 40ch;
            }

            .consent {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
            }
        `,
    ];

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    declare cities: boolean;
    declare open: boolean;
    /** The browser's install prompt waits (`app-install.ts`): the menu offers **Install app**. */
    declare installable: boolean;
    #stopInstall: (() => void) | null = null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.cities = false;
        this.open = false;
        this.installable = false;
        this.addEventListener('hcm-city-chosen', () => {
            this.open = false;
        });
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#stopInstall = watchInstall(window, (installable) => {
            this.installable = installable;
        });
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#stopInstall?.();
        this.#stopInstall = null;
    }

    /** The dialog is open, or the focus is on the button or in the dialog. */
    get active(): boolean {
        return this.open || (this.shadowRoot?.activeElement ?? null) !== null;
    }

    /** Gives the account button the focus once it is drawn. */
    async focusButton(): Promise<void> {
        await this.updateComplete;
        const button = this.renderRoot.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('hcm-icon-button');
        await button?.updateComplete;
        button?.focus();
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        const label = shellText(locale, 'adminShell.account.label');
        const show = (): void => {
            this.open = true;
            // A phone's city list is here: opening asks for the admin's cities again, as the bar's menu does (S-A49-HAPPY).
            if (this.cities) {
                void this.app?.intents.refreshCities?.();
            }
        };
        const hide = (): void => {
            this.open = false;
        };
        return html`<hcm-icon-button icon="account_circle" .label=${label} aria-haspopup="dialog" @click=${show}></hcm-icon-button>
            <hcm-dialog
                .open=${this.open}
                .headline=${label}
                .closeLabel=${shellText(locale, 'adminShell.account.close')}
                @hcm-close=${hide}
            >
                <div class="content">
                    ${this.#who(state)} ${this.#city(state)} ${this.#language(state)} ${this.#theme(state)} ${this.#accent(state)}
                    ${this.#install(state)} ${this.#consent(state)} ${this.#signOut(state)}
                </div>
            </hcm-dialog>`;
    }

    #who(state: AdminStatePort): TemplateResult {
        const email = state.user?.email ?? null;
        const key = 'adminShell.auth.signedInAs';
        return email === null
            ? EMPTY
            : html`<p class="who" lang=${shellLanguage(state.locale, key)}>${shellText(state.locale, key, { email })}</p>`;
    }

    /** M5: the city switcher, when the shell puts it here (`cities`). */
    #city(state: AdminStatePort): TemplateResult {
        return this.cities && showsCityMenu(state) ? html`<hcm-city-menu inline .app=${this.app} .state=${state}></hcm-city-menu>` : EMPTY;
    }

    #language(state: AdminStatePort): TemplateResult {
        const label = translate(state.locale, 'language.label');
        // The list shows the admin's language until it has switched (`live`): a language whose texts cannot be fetched
        // leaves it where it was (`docs/I18N.md` → Loading).
        const change = (event: CustomEvent<{ readonly value: string }>): void => {
            (event.currentTarget as HTMLElement & { value: string }).value = state.locale;
            const chosen = event.detail.value;
            if (isUiLocale(chosen)) {
                this.app?.intents.setLocale(chosen);
            }
        };
        return html`<div class="group">
            <span class="group-label">${label}</span>
            <hcm-language-select
                .label=${label}
                .options=${UI_LANGUAGE_OPTIONS}
                .value=${live(state.locale)}
                @hcm-change=${change}
            ></hcm-language-select>
        </div>`;
    }

    #theme(state: AdminStatePort): TemplateResult {
        const label = translate(state.locale, 'theme.label');
        const change = (event: CustomEvent<{ readonly value: string }>): void => {
            const mode = event.detail.value;
            if (isThemeMode(mode)) {
                this.app?.intents.setTheme(mode);
            }
        };
        return html`<div class="group">
            <span class="group-label">${label}</span>
            <hcm-segmented-button
                .label=${label}
                .options=${themeOptions(state.locale)}
                .value=${state.theme.mode}
                @hcm-change=${change}
            ></hcm-segmented-button>
        </div>`;
    }

    /** The colours: the device's accent (the default) or the city's own (`theme/device-accent.ts`). */
    #accent(state: AdminStatePort): TemplateResult {
        const label = translate(state.locale, 'accent.label');
        const change = (event: CustomEvent<{ readonly value: string }>): void => {
            this.app?.intents.setAccent(accentOf(event.detail.value));
        };
        return html`<div class="group">
            <span class="group-label">${label}</span>
            <hcm-segmented-button
                .label=${label}
                .options=${accentOptions(state.locale)}
                .value=${state.theme.accent ?? 'device'}
                @hcm-change=${change}
            ></hcm-segmented-button>
            ${this.#accentNote(state)}
        </div>`;
    }

    /** Device accent where it cannot show (`deviceAccentState`): why the city's colours show, and what would bring the device's. */
    #accentNote(state: AdminStatePort): TemplateResult {
        const shown = (state.theme.accent ?? 'device') === 'device' ? deviceAccentState(this.ownerDocument) : 'shared';
        if (shown === 'shared') {
            return EMPTY;
        }
        return this.#installBringsAccent(shown)
            ? this.#installNote(state)
            : this.#note(ACCENT_NOTES[shown].map((key) => translate(state.locale, key)));
    }

    /** Chrome or Edge on a computer gives the device's colour to an installed app (lesson 711): the note offers the install. */
    #installBringsAccent(shown: 'hidden' | 'grey'): boolean {
        return shown === 'hidden' && this.installable && installGivesAccent(navigator);
    }

    #installNote(state: AdminStatePort): TemplateResult {
        const texts = [translate(state.locale, 'accent.hidden'), shellText(state.locale, 'adminShell.account.installFix')];
        return html`${this.#note(texts)} ${this.#installButton(state)}`;
    }

    #note(texts: readonly string[]): TemplateResult {
        return html`<p class="group-label accent-note">${texts.join(' ')}</p>`;
    }

    /** **Install app** (docs/ENGINE_API.md → *Installable app*), only while the browser's install prompt waits. */
    #install(state: AdminStatePort): TemplateResult {
        if (!this.installable) {
            return EMPTY;
        }
        return html`<div class="group">
            <span class="group-label">${translate(state.locale, 'app.title')}</span>
            <p class="group-label accent-note">${shellText(state.locale, 'adminShell.account.installHint')}</p>
            ${this.#installButton(state)}
        </div>`;
    }

    #installButton(state: AdminStatePort): TemplateResult {
        const install = (): void => {
            void installApp(window);
        };
        return html`<hcm-button variant="outlined" icon="download" @click=${install}
            >${translate(state.locale, 'app.install')}</hcm-button
        >`;
    }

    /** The analytics consent, shown only when GA4 is configured. */
    #consent(state: AdminStatePort): TemplateResult {
        if (!state.analytics) {
            return EMPTY;
        }
        // M13 §3: a visitor on the Contribute page is told of the Contribute page's statistics, not the administration's.
        const label = shellText(
            state.locale,
            state.auth === 'visitor' ? 'adminShell.account.analyticsVisitor' : 'adminShell.account.analytics',
        );
        const change = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            this.app?.intents.setConsent(event.detail.checked ? 'granted' : 'denied');
        };
        return html`<div class="consent">
            <span>${label}</span>
            <hcm-switch .label=${label} .checked=${state.consent === 'granted'} @hcm-change=${change}></hcm-switch>
        </div>`;
    }

    #signOut(state: AdminStatePort): TemplateResult {
        if (state.user === null) {
            return EMPTY;
        }
        const signOut = (): void => {
            this.open = false;
            void this.app?.intents.signOut();
        };
        return html`<hcm-button
            variant="tonal"
            icon="logout"
            lang=${shellLanguage(state.locale, 'adminShell.auth.signOut')}
            @click=${signOut}
            >${shellText(state.locale, 'adminShell.auth.signOut')}</hcm-button
        >`;
    }
}

/** Registers `<hcm-account-menu>` once; calling it again is a no-op. */
export function defineHcmAccountMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ACCOUNT_MENU_TAG) === undefined) {
        registry.define(HCM_ACCOUNT_MENU_TAG, HcmAccountMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-account-menu': HcmAccountMenu;
    }
}
