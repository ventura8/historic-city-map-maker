/**
 * `<hcm-join-panel>`: the `joinPending` screen (`docs/research/M2b-interfaces.md` §1.3; scenario A02). An invitation for
 * the signed-in address waits: Join calls `admin.join`; an expired or missing invitation shows its message here.
 */
import { html, type TemplateResult } from 'lit';

import { adminBase, panelStyles } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { shellText } from '../shell/text.js';
import { AdminPanel, issueTemplate } from './panel.js';

export const HCM_JOIN_PANEL_TAG = 'hcm-join-panel';

export class HcmJoinPanel extends AdminPanel {
    static override readonly styles = [adminBase, panelStyles];

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        const join = (): void => {
            void this.app?.intents.join();
        };
        return html`<section class="panel" aria-labelledby="title">
            <h1 id="title">${shellText(locale, 'adminShell.auth.joinTitle')}</h1>
            <p>${shellText(locale, 'adminShell.auth.joinIntro')}</p>
            ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">
                <hcm-button variant="filled" icon="group" ?disabled=${state.busy} @click=${join}
                    >${shellText(locale, 'adminShell.auth.joinAction')}</hcm-button
                >
                ${this.otherAccount(locale)}
            </div>
        </section>`;
    }
}

/** Registers `<hcm-join-panel>` once; calling it again is a no-op. */
export function defineHcmJoinPanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_JOIN_PANEL_TAG) === undefined) {
        registry.define(HCM_JOIN_PANEL_TAG, HcmJoinPanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-join-panel': HcmJoinPanel;
    }
}
