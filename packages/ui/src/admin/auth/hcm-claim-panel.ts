/**
 * `<hcm-claim-panel>`: the `claimPending` screen (`docs/research/M2b-interfaces.md` §1.3, §3.3 d2). The map has no owner
 * and no live Google token proves ownership (a reload, an hour, a returning owner): one click asks Google for the
 * read-only Cloud scope and sends the token to `admin.claim`. A refusal shows its message here.
 */
import { html, type TemplateResult } from 'lit';

import { adminBase, panelStyles } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { shellText } from '../shell/text.js';
import { AdminPanel, issueTemplate } from './panel.js';

export const HCM_CLAIM_PANEL_TAG = 'hcm-claim-panel';

export class HcmClaimPanel extends AdminPanel {
    static override readonly styles = [adminBase, panelStyles];

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        const claim = (): void => {
            void this.app?.intents.claim();
        };
        return html`<section class="panel" aria-labelledby="title">
            <h1 id="title">${shellText(locale, 'adminShell.auth.claimTitle', { projectId: state.projectId })}</h1>
            <p>${shellText(locale, 'adminShell.auth.claimIntro')}</p>
            <hcm-consent-note
                .locale=${locale}
                scope="cloudReadOnly"
                .projectId=${state.projectId}
                .domain=${state.authDomain}
            ></hcm-consent-note>
            ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">
                <hcm-button variant="filled" icon="key" ?disabled=${state.busy} @click=${claim}
                    >${shellText(locale, 'adminShell.auth.claimAction')}</hcm-button
                >
                ${this.otherAccount(locale)}
            </div>
        </section>`;
    }
}

/** Registers `<hcm-claim-panel>` once; calling it again is a no-op. */
export function defineHcmClaimPanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_CLAIM_PANEL_TAG) === undefined) {
        registry.define(HCM_CLAIM_PANEL_TAG, HcmClaimPanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-claim-panel': HcmClaimPanel;
    }
}
