/**
 * `<hcm-city-menu>`: M5's city switcher (`docs/research/M5-interfaces.md` §1.5; behaviour A49). From the medium window
 * class it is the top bar's button naming the current city, whose dialog lists the admin's cities, each with its role;
 * on a compact window (or a phone held sideways) the same list sits in the account menu (`inline`). Choosing another city
 * opens it with a page load (`switchCity`: an unsaved edit is asked about first); the project's owner also gets New city.
 * It shows only to an admin of two cities or more, or to the project's owner: an admin of one city sees the shell as
 * before (S-A49-HAPPY-ONE-CITY). Opening it asks the server for the admin's cities again (at most once a minute, the
 * app's `refreshCities`), so a city the admin was just added to appears without a reload.
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import type { AdminAppPort, AdminCityPort, AdminStatePort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { EMPTY } from './empty.js';
import { shellText } from './text.js';

export const HCM_CITY_MENU_TAG = 'hcm-city-menu';

/** Whether the shell offers a city menu: an admin of two cities or more, or the project's owner (New city). */
export function showsCityMenu(state: AdminStatePort): boolean {
    return (state.cities?.length ?? 0) >= 2 || state.projectOwner === true;
}

function nameOf(city: AdminCityPort, locale: UiLocale): string {
    return locale === 'en' ? (city.name.en ?? city.name.ro) : city.name.ro;
}

/** The open city's name (its id until the session named it). */
export function currentCityLabel(state: AdminStatePort): string {
    const city = state.cities?.find((candidate) => candidate.id === state.cityId);
    return city === undefined ? (state.cityId ?? '') : nameOf(city, state.locale);
}

/**
 * ` · <city>` for an admin of two cities or more, else nothing (one city's shell stays as before): a phone's top bar, a
 * sideways phone's heading and the tab's title name the open city, which only the city menu named before
 * (`docs/LESSONS.md` 250).
 */
export function cityTitle(state: AdminStatePort): string {
    const city = (state.cities?.length ?? 0) >= 2 ? currentCityLabel(state) : '';
    return city === '' ? '' : ` · ${city}`;
}

export class HcmCityMenu extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        inline: { type: Boolean, reflect: true },
        open: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: inline-flex;
                min-inline-size: 0;
            }

            :host([inline]) {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .group-label {
                font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }

            /* 40 px buttons 8 px apart, 4 px inside the list's edges: each keeps its whole 48 px touch target (M3). */
            ul {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin: 0;
                padding: 4px 0;
                list-style: none;
            }

            .choice {
                display: flex;
            }

            .choice hcm-button {
                flex: 1;
            }

            .role {
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }
        `,
    ];

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    declare inline: boolean;
    declare open: boolean;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.inline = false;
        this.open = false;
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null || !showsCityMenu(state)) {
            return EMPTY;
        }
        return this.inline ? this.#inline(state) : this.#bar(state);
    }

    #inline(state: AdminStatePort): TemplateResult {
        return html`<span class="group-label" id="cities-label">${shellText(state.locale, 'adminShell.city.label')}</span>
            ${this.#choices(state)}`;
    }

    #bar(state: AdminStatePort): TemplateResult {
        const locale = state.locale;
        const show = (): void => {
            this.open = true;
            void this.app?.intents.refreshCities?.();
        };
        const hide = (): void => {
            this.open = false;
        };
        const label = currentCityLabel(state);
        // Its name says what the button shows (the open city) and what it opens (docs/LESSONS.md 249).
        return html`<hcm-button
                variant="text"
                icon="apartment"
                .popup=${'dialog'}
                .label=${label === '' ? undefined : shellText(locale, 'adminShell.city.current', { city: label })}
                data-city-menu
                @click=${show}
                >${label === '' ? shellText(locale, 'adminShell.city.switch') : label}</hcm-button
            >
            <hcm-dialog
                .open=${this.open}
                .headline=${shellText(locale, 'adminShell.city.switch')}
                .closeLabel=${shellText(locale, 'adminShell.account.close')}
                @hcm-close=${hide}
            >
                ${this.#choices(state)}
            </hcm-dialog>`;
    }

    /** Each city with its role (the open one marked), then New city for the project's owner. */
    #choices(state: AdminStatePort): TemplateResult {
        const locale = state.locale;
        return html`<ul aria-labelledby=${this.inline ? 'cities-label' : nothing}>
                ${(state.cities ?? []).map((city) => this.#choice(state, city))}
            </ul>
            ${this.#newCity(state, locale)}`;
    }

    #choice(state: AdminStatePort, city: AdminCityPort): TemplateResult {
        const locale = state.locale;
        const current = city.id === state.cityId;
        const role = shellText(locale, `adminShell.city.role.${city.role}`);
        const choose = (): void => {
            this.open = false;
            this.#closeAccountMenu();
            if (!current) {
                this.app?.intents.switchCity?.(city.id);
            }
        };
        return html`<li class="choice">
            <hcm-button
                variant=${current ? 'tonal' : 'text'}
                icon=${current ? 'check' : 'apartment'}
                .current=${current}
                data-city=${city.id}
                @click=${choose}
                >${nameOf(city, locale)} <span class="role">· ${role}</span></hcm-button
            >
        </li>`;
    }

    #newCity(state: AdminStatePort, locale: UiLocale): TemplateResult {
        if (state.projectOwner !== true) {
            return EMPTY;
        }
        const create = (): void => {
            this.open = false;
            this.#closeAccountMenu();
            this.app?.intents.navigate({ id: 'cities', params: ['new'] });
        };
        return html`<hcm-button variant="outlined" icon="add_location_alt" @click=${create}
            >${shellText(locale, 'adminShell.city.new')}</hcm-button
        >`;
    }

    /** Inside the account menu, choosing closes it too. */
    #closeAccountMenu(): void {
        this.dispatchEvent(new CustomEvent('hcm-city-chosen', { bubbles: true, composed: true }));
    }
}

/** Registers `<hcm-city-menu>` once; calling it again is a no-op. */
export function defineHcmCityMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_CITY_MENU_TAG) === undefined) {
        registry.define(HCM_CITY_MENU_TAG, HcmCityMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-city-menu': HcmCityMenu;
    }
}
