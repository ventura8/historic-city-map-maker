/**
 * `<hcm-sign-in>`: the `signedOut` screen (`docs/research/M2b-interfaces.md` §1.3, §3.3 a). One button opens Google's
 * popup; when the server did not answer (start-up mode) the popup asks for the read-only Cloud scope, so the consent
 * note explains it first. After a reload in start-up mode the Google token is gone: the panel asks to confirm again.
 * When Resource Manager is disabled in the project, the button enables it first ("Enable with Google").
 *
 * M13 §3: on the Contribute page's address (`state.welcome`) a public visitor is welcomed as a contributor, never as an
 * admin: the city's name, what contributing means, that Google is needed only to send something, one sign-in button and
 * the way back to the map. The tab's title says Contribute too (`<hcm-admin-shell>`). Whether the server answers or not:
 * a visitor never sees the start-up mode's setup intro or its Cloud consent note.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import type { AdminStatePort, AdminWelcomePort } from '../admin-port.js';
import { adminBase, panelStyles } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { shellText } from '../shell/text.js';
import { AdminPanel, issueTemplate } from './panel.js';

export const HCM_SIGN_IN_TAG = 'hcm-sign-in';

function introOf(state: AdminStatePort): string {
    if (state.gate.reconsent) {
        return shellText(state.locale, 'adminShell.auth.reconsent');
    }
    return state.mode === 'normal'
        ? shellText(state.locale, 'adminShell.auth.signInIntro')
        : shellText(state.locale, 'adminShell.auth.setupIntro', { projectId: state.projectId });
}

/** The welcome to show: the Contribute page's while its address is open, whatever the server says (M13 §3). */
export function welcomeOf(state: AdminStatePort): AdminWelcomePort | null {
    return state.welcome ?? null;
}

/** The Contribute page's heading: the map of the city the link named, or of no city. */
export function welcomeTitle(locale: UiLocale, welcome: AdminWelcomePort): string {
    return welcome.cityName === null
        ? shellText(locale, 'adminShell.welcome.titleNoCity')
        : shellText(locale, 'adminShell.welcome.title', { city: welcome.cityName });
}

/**
 * The app's name before the shell shows (the tab's title, the loading screen's heading) and the city it names: on the
 * Contribute page's address a visitor is told Contribute, never administration; null when that does not apply.
 */
export function welcomeName(state: AdminStatePort, shellShown: boolean): { readonly app: string; readonly city: string } | null {
    const welcome = shellShown ? null : welcomeOf(state);
    return welcome === null
        ? null
        : { app: shellText(state.locale, 'adminShell.welcome.tabTitle'), city: welcome.cityName === null ? '' : ` · ${welcome.cityName}` };
}

export class HcmSignIn extends AdminPanel {
    static override readonly styles = [
        adminBase,
        panelStyles,
        css`
            hcm-consent-note {
                margin-block-end: 8px;
            }

            ul {
                display: grid;
                gap: 8px;
                margin: 0;
                padding-inline-start: 24px;
            }
        `,
    ];

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const welcome = welcomeOf(state);
        return welcome === null ? this.#admin(state) : this.#welcome(state, welcome);
    }

    readonly #signIn = (): void => {
        void this.app?.intents.signIn();
    };

    /** M13 §3: a visitor who came from the map to contribute. */
    #welcome(state: AdminStatePort, welcome: AdminWelcomePort): TemplateResult {
        const locale = state.locale;
        return html`<section class="panel" aria-labelledby="title">
            <h1 id="title">${welcomeTitle(locale, welcome)}</h1>
            <p>${shellText(locale, 'adminShell.welcome.intro')}</p>
            <ul>
                <li>${shellText(locale, 'adminShell.welcome.send')}</li>
                <li>${shellText(locale, 'adminShell.welcome.suggest')}</li>
                <li>${shellText(locale, 'adminShell.welcome.role')}</li>
            </ul>
            <p>${shellText(locale, 'adminShell.welcome.signInNote')}</p>
            ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">
                <hcm-button variant="filled" icon="account_circle" @click=${this.#signIn}
                    >${shellText(locale, 'adminShell.welcome.signIn')}</hcm-button
                >
                <a class="back" href=${welcome.mapUrl}>${shellText(locale, 'adminShell.welcome.back')}</a>
            </div>
        </section>`;
    }

    #admin(state: AdminStatePort): TemplateResult {
        const locale = state.locale;
        const enable = (): void => {
            void this.app?.intents.enableApi();
        };
        const action =
            state.gate.enableApi === null
                ? html`<hcm-button variant="filled" icon="account_circle" @click=${this.#signIn}
                      >${shellText(locale, 'adminShell.auth.signIn')}</hcm-button
                  >`
                : html`<hcm-button variant="filled" icon="key" @click=${enable}
                      >${shellText(locale, 'adminShell.auth.enableApi')}</hcm-button
                  >`;
        return html`<section class="panel" aria-labelledby="title">
            <h1 id="title">${shellText(locale, 'adminShell.appName')}</h1>
            <p>${introOf(state)}</p>
            ${this.#note(state)} ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">${action} ${state.user === null ? EMPTY : this.otherAccount(locale)}</div>
        </section>`;
    }

    /** The read-only Cloud scope is asked only when the server did not answer (start-up mode). */
    #note(state: AdminStatePort): TemplateResult {
        const scope = state.gate.enableApi === null ? 'cloudReadOnly' : 'cloudPlatform';
        return state.mode === 'normal'
            ? EMPTY
            : html`<hcm-consent-note
                  .locale=${state.locale}
                  .scope=${scope}
                  .projectId=${state.projectId}
                  .domain=${state.authDomain}
              ></hcm-consent-note>`;
    }
}

/** Registers `<hcm-sign-in>` once; calling it again is a no-op. */
export function defineHcmSignIn(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SIGN_IN_TAG) === undefined) {
        registry.define(HCM_SIGN_IN_TAG, HcmSignIn);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-sign-in': HcmSignIn;
    }
}
