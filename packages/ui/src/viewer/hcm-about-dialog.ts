/**
 * `<hcm-about-dialog>`: About, credits and the privacy notice of the city (scenario V13), the engine version and the
 * analytics consent with its withdrawal (V19), in the ui-kit's `<hcm-dialog>` (full screen on compact). The About and privacy texts are the Markdown subset walked into DOM nodes;
 * empty credits hide their section (S-V13-BAD-EMPTY-CREDITS). The dialog sits in the browser's top layer, over the
 * map and its own logo and attribution: full screen the map does not show, so there is nothing to credit; a centred
 * dialog leaves the map's corners, and Mapbox's controls, to show around it (V18; the Pixel 9 Pro review, P3, found a
 * copy of the credits at the dialog's foot taking 40 to 80 px of Settings and About on a phone).
 *
 * Its `mode` picks what it shows: About (`about`, with the accessibility statement of docs/research/viewer-input.md §5),
 * the help panel of the keyboard and the gamepad (`help`, §2), or Settings (`settings`, the menu's Setări): the language
 * and theme choices (V11, V12: the mode, Follow my device by default, and the colours, Device accent by default), which
 * the owner wanted out of About (2026-11-08).
 *
 * Events (viewer-internal): `hcm-locale-change` (`{locale}`), `hcm-theme-change` (`{theme}` or `{accent}`), `hcm-consent`
 * (`{decision: 'denied'}`, the kit banner's event) when the visitor withdraws consent, `hcm-help-open` and
 * `hcm-shortcuts-change` (`{enabled}`).
 */
import {
    DEFAULT_LOCALE,
    LANGUAGE_NAMES,
    localized,
    resolveViewerLocale,
    shownLanguage,
    translate,
    type City,
    type Credit,
    type ViewerLocale,
} from '@hcm/shared';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { installApp, installGivesAccent, watchInstall } from '../app-install.js';
import { tabbableElements } from '../components/focus.js';
import { deviceAccentState } from '../theme/device-accent.js';
import { EMPTY } from './empty.js';
import { fallbackNote } from './fallback-note.js';
import { externalLink, renderMarkdown } from './markdown.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { renderShortcutsHelp } from './shortcuts-help.js';
import type { AccentChoice, ConsentState, ThemeMode } from './store-port.js';

export const HCM_ABOUT_DIALOG_TAG = 'hcm-about-dialog';

/** Where anyone reports a problem of the viewer, on every city: the manifest has no contact field (docs/research/viewer-input.md §5). */
const REPORT_URL = 'https://github.com/ventura8/historic-city-map-maker/issues';

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const ACCENTS: readonly AccentChoice[] = ['device', 'map'];

/** What the dialog shows: About, the help panel or Settings (`dialogMode` of the open sheet). */
export type AboutMode = 'about' | 'help' | 'settings';

const HEADLINES = { about: 'about.title', help: 'input.help', settings: 'settings.title' } as const;

/** A credit line: a link when the credit names a page. */
function creditText(credit: Credit, locale: ViewerLocale): TemplateResult | string {
    const label = localized(credit.label, locale);
    return credit.url === undefined ? label : externalLink(credit.url, label);
}

/** The language dropdown's options: every viewer language by its own name, in its own language, in `LANGUAGE_NAMES`' fixed order. */
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value, label, lang: value }));

const THEME_ICONS: Readonly<Record<ThemeMode, string>> = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
/** Why Device accent cannot show here (`deviceAccentState`), per state. */
const ACCENT_NOTES = {
    hidden: ['accent.hidden', 'accent.hiddenFix'],
    grey: ['accent.grey', 'accent.greyFix'],
} as const;

const ACCENT_ICONS: Readonly<Record<AccentChoice, string>> = { device: 'palette', map: 'map' };

function isThemeMode(value: string): value is ThemeMode {
    return (THEMES as readonly string[]).includes(value);
}

function isAccent(value: string): value is AccentChoice {
    return (ACCENTS as readonly string[]).includes(value);
}

/** The `{value}` of a kit `hcm-change` event, which stops here (the dialog re-fires it in its own words). */
function changedValue(event: Event): string {
    event.stopPropagation();
    return String((event as CustomEvent<{ readonly value: unknown }>).detail.value);
}

export class HcmAboutDialog extends LitElement {
    static override readonly properties = {
        open: { type: Boolean },
        mode: { type: String },
        shortcuts: { type: Boolean },
        city: { attribute: false },
        locale: { type: String },
        engineVersion: { type: String, attribute: 'engine-version' },
        consent: { type: String },
        analytics: { type: Boolean },
        fullscreen: { type: Boolean },
        theme: { type: String },
        accent: { type: String },
        installable: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: contents;
            }

            .details {
                max-inline-size: 60ch;
            }

            /* Its colour is detailStyles' .supporting. */
            .engine {
                font-size: var(--md-sys-typescale-body-small-size);
            }

            hcm-switch {
                margin-block: 8px;
            }

            kbd {
                border: 1px solid;
            }
        `,
    ];

    declare open: boolean;
    declare mode: AboutMode;
    /** The single-key shortcuts are on (the help panel's switch). */
    declare shortcuts: boolean;
    declare city: City | null;
    declare locale: ViewerLocale;
    declare engineVersion: string;
    declare consent: ConsentState;
    /** True when the manifest configures analytics (a measurement id): only then is there a consent to show. */
    declare analytics: boolean;
    declare fullscreen: boolean;
    declare theme: ThemeMode;
    declare accent: AccentChoice;
    /** The browser's install prompt waits (`app-install.ts`): Settings offers **Install app**. */
    declare installable: boolean;
    #stopInstall: (() => void) | null = null;

    constructor() {
        super();
        this.open = false;
        this.mode = 'about';
        this.shortcuts = true;
        this.city = null;
        this.locale = DEFAULT_LOCALE;
        this.engineVersion = '';
        this.consent = 'unknown';
        this.analytics = false;
        this.fullscreen = false;
        this.theme = 'system';
        this.accent = 'device';
        this.installable = false;
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

    override render(): TemplateResult {
        const locale = this.locale;
        return html`<hcm-dialog
            .open=${this.open}
            .headline=${translate(locale, HEADLINES[this.mode])}
            .closeLabel=${translate(locale, 'action.close')}
            ?fullscreen=${this.fullscreen}
        >
            ${this.#body()}
        </hcm-dialog>`;
    }

    /** About's button to the help panel removes the focused button: the focus goes on to the dialog's first control. */
    protected override updated(changed: PropertyValues<this>): void {
        if (changed.get('mode') === 'about' && this.open) {
            tabbableElements(this.renderRoot as ShadowRoot)[0]?.focus();
        }
    }

    #body(): TemplateResult {
        if (this.mode === 'settings') {
            return this.#preferences();
        }
        if (this.mode === 'help') {
            return renderShortcutsHelp(this.locale, this.shortcuts, (event) => {
                event.stopPropagation();
                this.#emit('hcm-shortcuts-change', { enabled: event.detail.checked });
            });
        }
        return this.city === null ? EMPTY : this.#content(this.city);
    }

    #content(city: City): TemplateResult {
        const locale = this.locale;
        return html`<div class="details">
            <section>
                <h3 lang=${shownLanguage(city.name, locale)}>${localized(city.name, locale)}</h3>
                <div lang=${shownLanguage(city.about, locale)}>${renderMarkdown(localized(city.about, locale))}</div>
                ${fallbackNote(city.about, locale)}
            </section>
            ${this.#credits(city.credits)} ${this.#inputAndAccessibility()}
            <section>
                <h3>${translate(locale, 'about.privacy')}</h3>
                <div lang=${shownLanguage(city.privacy, locale)}>${renderMarkdown(localized(city.privacy, locale))}</div>
                ${this.#consent()}
            </section>
            <p class="supporting engine">${translate(locale, 'about.engine', { version: this.engineVersion })}</p>
        </div>`;
    }

    /** The keyboard and the gamepad, and the accessibility statement (docs/research/viewer-input.md §5). */
    #inputAndAccessibility(): TemplateResult {
        const locale = this.locale;
        const onHelp = (): void => {
            this.#emit('hcm-help-open', {});
        };
        return html`<section>
            <h3>${translate(locale, 'about.accessibility')}</h3>
            <p>${translate(locale, 'about.a11yWorks')}</p>
            <p>${translate(locale, 'about.a11yMissing')}</p>
            <p>${externalLink(REPORT_URL, translate(locale, 'about.a11yReport'))}</p>
            <hcm-button variant="outlined" @click=${onHelp}>${translate(locale, 'input.help')}</hcm-button>
        </section>`;
    }

    #credits(credits: readonly Credit[]): TemplateResult {
        if (credits.length === 0) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<section>
            <h3>${translate(locale, 'about.credits')}</h3>
            <ul>
                ${credits.map((credit) => html`<li>${creditText(credit, locale)}</li>`)}
            </ul>
        </section>`;
    }

    #preferences(): TemplateResult {
        const locale = this.locale;
        // Full screen (compact width) leaves no room for an icon beside every Romanian theme label: only the
        // selected segment keeps its check mark there.
        const icons = (icon: string): { readonly icon?: string } => (this.fullscreen ? {} : { icon });
        const themes = THEMES.map((choice) => ({
            value: choice,
            label: translate(locale, `theme.${choice}`),
            ...icons(THEME_ICONS[choice]),
        }));
        // The list shows the page's language until the store has switched (`live`): a language whose texts cannot be
        // fetched leaves it where it was, and its new value comes back with the page's.
        const onLanguage = (event: Event): void => {
            const chosen = resolveViewerLocale(changedValue(event));
            (event.currentTarget as HTMLElement & { value: string }).value = locale;
            this.#emit('hcm-locale-change', { locale: chosen });
        };
        const onTheme = (event: Event): void => {
            const value = changedValue(event);
            if (isThemeMode(value)) {
                this.#emit('hcm-theme-change', { theme: value });
            }
        };
        return html`<section class="preferences">
            <h3>${translate(locale, 'language.label')}</h3>
            <hcm-language-select
                .options=${LANGUAGE_OPTIONS}
                .value=${live(locale)}
                .label=${translate(locale, 'language.label')}
                @hcm-change=${onLanguage}
            ></hcm-language-select>
            <h3>${translate(locale, 'theme.label')}</h3>
            <hcm-segmented-button
                .options=${themes}
                .value=${this.theme}
                .label=${translate(locale, 'theme.label')}
                @hcm-change=${onTheme}
            ></hcm-segmented-button>
            ${this.#accent(icons)} ${this.#app()}
        </section>`;
    }

    /** **Install app** (docs/ENGINE_API.md → *Installable app*), only while the browser's install prompt waits. */
    #app(): TemplateResult {
        if (!this.installable) {
            return EMPTY;
        }
        return html`<h3>${translate(this.locale, 'app.title')}</h3>
            <p class="supporting">${translate(this.locale, 'app.installHint')}</p>
            ${this.#installButton()}`;
    }

    #installButton(): TemplateResult {
        const install = (): void => {
            void installApp(window);
        };
        return html`<hcm-button variant="outlined" icon="download" @click=${install}>${translate(this.locale, 'app.install')}</hcm-button>`;
    }

    /** The colours: the device's accent (the default) or the map's own. */
    #accent(icons: (icon: string) => { readonly icon?: string }): TemplateResult {
        const locale = this.locale;
        const accents = ACCENTS.map((choice) => ({
            value: choice,
            label: translate(locale, `accent.${choice}`),
            ...icons(ACCENT_ICONS[choice]),
        }));
        const onAccent = (event: Event): void => {
            const value = changedValue(event);
            if (isAccent(value)) {
                this.#emit('hcm-theme-change', { accent: value });
            }
        };
        return html`<h3>${translate(locale, 'accent.label')}</h3>
            <hcm-segmented-button
                .options=${accents}
                .value=${this.accent}
                .label=${translate(locale, 'accent.label')}
                @hcm-change=${onAccent}
            ></hcm-segmented-button>
            ${this.#accentNote()}`;
    }

    /** Device accent where it cannot show (`deviceAccentState`): why the map's colours show, and what would bring the device's. */
    #accentNote(): TemplateResult {
        const state = this.accent === 'device' ? deviceAccentState(this.ownerDocument) : 'shared';
        if (state === 'shared') {
            return EMPTY;
        }
        return this.#installBringsAccent(state) ? this.#installNote() : this.#note(ACCENT_NOTES[state]);
    }

    /** Chrome or Edge on a computer gives the device's colour to an installed app (lesson 711): the note offers the install. */
    #installBringsAccent(state: 'hidden' | 'grey'): boolean {
        return state === 'hidden' && this.installable && installGivesAccent(navigator);
    }

    #installNote(): TemplateResult {
        return html`${this.#note(['accent.hidden', 'accent.installFix'])} ${this.#installButton()}`;
    }

    #note(
        keys: readonly ('accent.hidden' | 'accent.hiddenFix' | 'accent.grey' | 'accent.greyFix' | 'accent.installFix')[],
    ): TemplateResult {
        return html`<p class="supporting accent-note">${keys.map((key) => translate(this.locale, key)).join(' ')}</p>`;
    }

    #emit(type: string, detail: object): void {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    }

    #consent(): TemplateResult {
        if (!this.analytics || this.consent === 'unknown') {
            return EMPTY;
        }
        if (this.consent === 'denied') {
            return html`<p class="supporting">${translate(this.locale, 'consent.denied')}</p>`;
        }
        const withdraw = (): void => {
            this.#emit('hcm-consent', { decision: 'denied' });
        };
        return html`<p class="supporting">${translate(this.locale, 'consent.granted')}</p>
            <hcm-button variant="outlined" @click=${withdraw}>${translate(this.locale, 'consent.withdraw')}</hcm-button>`;
    }
}

/** Registers `<hcm-about-dialog>` once; calling it again is a no-op. */
export function defineHcmAboutDialog(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ABOUT_DIALOG_TAG) === undefined) {
        registry.define(HCM_ABOUT_DIALOG_TAG, HcmAboutDialog);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-about-dialog': HcmAboutDialog;
    }
}
