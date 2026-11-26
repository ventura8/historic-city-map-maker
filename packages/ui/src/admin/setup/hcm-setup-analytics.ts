/**
 * The analytics card's body (step g, `docs/research/M2b-interfaces.md` §3.3 g): the detected GA4 measurement id, or
 * where to enable Google Analytics (the card's deep link starts a 15 s watch), the GA4 stream setting that turns
 * history page views off (one click, one consent), Create the measurement reports (§76f: one click, the same scope), the
 * crash e-mail switch (one click, one consent), and the crash reports panel.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmSwitch, type HcmSwitch } from '../../components/switch.js';
import { EMPTY } from '../shell/empty.js';
import { defineHcmCrashGroups } from './hcm-crash-groups.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';

const HCM_SETUP_ANALYTICS_TAG = 'hcm-setup-analytics';

export class HcmSetupAnalytics extends SetupBody {
    static override readonly styles = [setupTextStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const { measurementId, watching } = state.analytics;
        return html`<div class="body">
            ${
                measurementId === null
                    ? html`<p class="note">${this.t('adminSetup.analytics.enableHow')}</p>`
                    : html`<p class="success">${this.t('adminSetup.analytics.measurementId', { id: measurementId })}</p>`
            }
            <p class="note" role="status">${watching ? this.t('adminSetup.analytics.watching') : nothing}</p>
            ${this.renderStream(state)} ${this.renderReports(state)} ${this.renderCrashEmails(state)}
            <hcm-crash-groups .view=${state} .intents=${this.intents} .locale=${this.locale}></hcm-crash-groups>
        </div>`;
    }

    private renderStream(state: SetupViewState): TemplateResult {
        if (state.analytics.pageChangesOff) {
            return html`<p class="success stream-off">
                <hcm-icon name="check_circle"></hcm-icon>${this.t('adminSetup.analytics.streamOff')}
            </p>`;
        }
        return html`<div class="actions">
            <hcm-button
                variant="tonal"
                ?disabled=${this.step(state, 'analytics').busy}
                @click=${() => {
                    this.act((intents) => {
                        intents.disableHistoryPageViews();
                    });
                }}
                >${this.t('adminSetup.analytics.streamSetting')}</hcm-button
            >
        </div>`;
    }

    /** §76f: Create the measurement reports once a measurement id is known, and what the last run did. */
    private renderReports(state: SetupViewState): TemplateResult {
        const { measurementId, reports } = state.analytics;
        if (measurementId === null) {
            return EMPTY;
        }
        const done =
            reports === null
                ? ''
                : this.t('adminSetup.analytics.reportsDone', { created: String(reports.created), skipped: String(reports.skipped) });
        return html`<div class="actions">
                <hcm-button
                    variant="tonal"
                    ?disabled=${this.step(state, 'analytics').busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.createMeasurementReports();
                        });
                    }}
                    >${this.t('adminSetup.analytics.reports')}</hcm-button
                >
            </div>
            <p class="success reports" role="status">${done}</p>`;
    }

    private renderCrashEmails(state: SetupViewState): TemplateResult {
        const label = this.t('adminSetup.analytics.crashEmails');
        const enabled = state.analytics.crashEmails;
        return html`<div class="actions">
            <hcm-switch
                .checked=${enabled}
                label=${label}
                @hcm-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    // The switch shows the alert policy, not the click: it moves when the state says the policy did.
                    (event.target as HcmSwitch).checked = enabled;
                    this.act((intents) => {
                        intents.setCrashEmails(event.detail.checked);
                    });
                }}
            ></hcm-switch>
            <span aria-hidden="true">${label}</span>
        </div>`;
    }
}

/** Registers `<hcm-setup-analytics>` and what it renders. */
export function defineHcmSetupAnalytics(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineHcmSwitch(registry);
    defineHcmCrashGroups(registry);
    defineOnce(registry, HCM_SETUP_ANALYTICS_TAG, HcmSetupAnalytics);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-analytics': HcmSetupAnalytics;
    }
}
