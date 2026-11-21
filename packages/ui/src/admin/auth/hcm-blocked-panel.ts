/**
 * `<hcm-blocked-panel>`: the screens that stop the admin (`docs/research/M2b-interfaces.md` §1.3): the site's Firebase
 * configuration is missing (Reload), the account does not own the project (`notOwner`) or does not administer the map
 * (`notAdmin`; S-A01-BAD-STRANGER, already signed out), or the server does not answer (`backendDown`, Try again).
 *
 * M13 §3: on the Contribute page's address (`state.welcome`) every one of them speaks to a contributor: the welcome's
 * heading, "the map is resting" (Try again) or "not open yet" (`contributeClosed`), and Back to the map; never the
 * administration's name nor another account.
 */
import type { AdminShellKey, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminAppPort, AdminAuthStatePort, AdminStatePort, AdminWelcomePort } from '../admin-port.js';
import { adminBase, panelStyles } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { shellText } from '../shell/text.js';
import { welcomeOf, welcomeTitle } from './hcm-sign-in.js';
import { AdminPanel, issueTemplate } from './panel.js';

export const HCM_BLOCKED_PANEL_TAG = 'hcm-blocked-panel';

type BlockedState = Extract<AdminAuthStatePort, 'configMissing' | 'notOwner' | 'notAdmin' | 'backendDown' | 'contributeClosed'>;

interface BlockedSpec {
    readonly icon: string;
    readonly message: AdminShellKey;
    /** The main action, if any: its label and what it does. */
    readonly action: { readonly label: AdminShellKey; readonly icon: string; readonly run: (app: AdminAppPort) => void } | null;
    /** Offer "Use another Google account". */
    readonly otherAccount: boolean;
}

const SPECS: Readonly<Record<BlockedState, BlockedSpec>> = {
    configMissing: {
        icon: 'error',
        message: 'adminShell.config.missing',
        action: {
            label: 'adminShell.config.reload',
            icon: 'refresh',
            run: (app) => {
                app.intents.reload();
            },
        },
        otherAccount: false,
    },
    notOwner: { icon: 'warning', message: 'adminShell.auth.notOwner', action: null, otherAccount: true },
    notAdmin: { icon: 'warning', message: 'adminShell.auth.notAdmin', action: null, otherAccount: true },
    backendDown: {
        icon: 'cloud',
        message: 'adminShell.backend.down',
        action: { label: 'adminShell.backend.retry', icon: 'refresh', run: (app) => void app.intents.retry() },
        otherAccount: true,
    },
    contributeClosed: { icon: 'schedule', message: 'adminShell.welcome.closed', action: null, otherAccount: false },
};

/** M13 §3: what each blocked state tells a contributor on the Contribute page (its action stays: Reload, Try again). */
const CONTRIBUTOR_MESSAGES: Readonly<Record<BlockedState, AdminShellKey>> = {
    configMissing: 'adminShell.welcome.resting',
    notOwner: 'adminShell.welcome.closed',
    notAdmin: 'adminShell.welcome.closed',
    backendDown: 'adminShell.welcome.resting',
    contributeClosed: 'adminShell.welcome.closed',
};

function isBlocked(auth: AdminAuthStatePort): auth is BlockedState {
    return auth in SPECS;
}

export class HcmBlockedPanel extends AdminPanel {
    static override readonly styles = [adminBase, panelStyles];

    override render(): TemplateResult {
        const state = this.state;
        if (state === null || !isBlocked(state.auth)) {
            return EMPTY;
        }
        const spec = SPECS[state.auth];
        const welcome = welcomeOf(state);
        if (welcome !== null) {
            return this.#contributor(state, state.auth, welcome);
        }
        const locale = state.locale;
        return html`<section class="panel" role="alert" aria-labelledby="title">
            <hcm-icon name=${spec.icon}></hcm-icon>
            <h1 id="title">${shellText(locale, 'adminShell.appName')}</h1>
            <p>${shellText(locale, spec.message, { projectId: state.projectId })}</p>
            ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">${this.#action(spec, locale)} ${spec.otherAccount ? this.otherAccount(locale) : EMPTY}</div>
        </section>`;
    }

    /** M13 §3: the Contribute page's version: the welcome's heading, the contributor's message, and the way back to the map. */
    #contributor(state: AdminStatePort, auth: BlockedState, welcome: AdminWelcomePort): TemplateResult {
        const locale = state.locale;
        return html`<section class="panel" role="alert" aria-labelledby="title">
            <hcm-icon name=${SPECS[auth].icon}></hcm-icon>
            <h1 id="title">${welcomeTitle(locale, welcome)}</h1>
            <p>${shellText(locale, CONTRIBUTOR_MESSAGES[auth])}</p>
            ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">
                ${this.#action(SPECS[auth], locale)}
                <a class="back" href=${welcome.mapUrl}>${shellText(locale, 'adminShell.welcome.back')}</a>
            </div>
        </section>`;
    }

    #action(spec: BlockedSpec, locale: UiLocale): TemplateResult {
        const action = spec.action;
        if (action === null) {
            return EMPTY;
        }
        const run = (): void => {
            if (this.app !== null) {
                action.run(this.app);
            }
        };
        return html`<hcm-button variant="filled" icon=${action.icon} @click=${run}>${shellText(locale, action.label)}</hcm-button>`;
    }
}

/** Registers `<hcm-blocked-panel>` once; calling it again is a no-op. */
export function defineHcmBlockedPanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_BLOCKED_PANEL_TAG) === undefined) {
        registry.define(HCM_BLOCKED_PANEL_TAG, HcmBlockedPanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-blocked-panel': HcmBlockedPanel;
    }
}
