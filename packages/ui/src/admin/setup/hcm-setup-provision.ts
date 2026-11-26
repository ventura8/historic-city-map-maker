/**
 * The provisioning card's body (step c, `docs/research/M2b-interfaces.md` §3.3 c, §3.4): the doctor list, one row per
 * `PROVISION_ITEMS` item with its state (icon and text) and reason, and one button: "Prepare the project" before
 * anything is in place, "Retry what failed" once some items are (one click, one consent each). The scheduler, which
 * only the first deploy creates, says so while it waits. A disabled Google service names the button the card shows,
 * Retry what failed (M6 setup-ux, finding 5 of 2026-10-25: the API catalogue's text names the Setup step instead, for
 * the server checks that link to it).
 */
import type { ServiceState } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupMessage, SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { setupText } from './setup-text.js';

const HCM_SETUP_PROVISION_TAG = 'hcm-setup-provision';

type DoctorItem = SetupViewState['provision']['items'][number];

const ITEM_ICONS: Readonly<Record<ServiceState, string>> = {
    missing: 'info',
    pending: 'schedule',
    ok: 'check_circle',
    invalid: 'error',
    unavailable: 'warning',
};

/** The scheduler waits for the first deploy; it says so even when the provisioner gave no reason. */
function reasonOf(item: DoctorItem): SetupMessage | null {
    const waitsForDeploy = item.id === 'scheduler' && item.state === 'pending' && item.detail === null;
    return waitsForDeploy ? { key: 'adminSetup.provision.afterDeploy' } : onThisCard(item.detail);
}

/** A disabled service on this card: Retry what failed (the button beside it) switches it on. */
function onThisCard(detail: SetupMessage | null): SetupMessage | null {
    if (detail?.key !== 'apiError.cloud.apiDisabled') {
        return detail;
    }
    return detail.params === undefined
        ? { key: 'adminSetup.provision.apiDisabled' }
        : { key: 'adminSetup.provision.apiDisabled', params: detail.params };
}

export class HcmSetupProvision extends SetupBody {
    static override readonly styles = [
        setupTextStyles,
        css`
            .doctor {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            .item {
                display: grid;
                grid-template-columns: 24px minmax(0, 1fr);
                gap: 2px 12px;
                align-items: center;
                min-block-size: 40px;
            }

            .item .reason,
            .item .state {
                grid-column: 2;
                color: var(--md-sys-color-on-surface-variant);
            }

            .item[data-state='ok'] hcm-icon {
                color: var(--md-sys-color-primary);
            }

            .item[data-state='invalid'] hcm-icon {
                color: var(--md-sys-color-error);
            }
        `,
    ];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const { items } = state.provision;
        const ready = items.filter((item) => item.state === 'ok').length;
        return html`<div class="body">
            <p class="note">${this.t('adminSetup.provision.progress', { done: String(ready), total: String(items.length) })}</p>
            <ul class="doctor">
                ${items.map((item) => this.renderItem(item))}
            </ul>
            ${this.renderAction(
                state,
                items.some((item) => item.state !== 'missing'),
            )}
        </div>`;
    }

    private renderItem(item: DoctorItem): TemplateResult {
        const reason = reasonOf(item);
        return html`<li class="item" data-item=${item.id} data-state=${item.state}>
            <hcm-icon name=${ITEM_ICONS[item.state]}></hcm-icon>
            <span>${this.t(`adminSetup.provision.item.${item.id}`)}</span>
            <span class="state">${this.t(`adminSetup.state.${item.state}`)}</span>
            ${reason === null ? nothing : html`<span class="reason">${setupText(this.locale, reason)}</span>`}
        </li>`;
    }

    /** "Prepare the project" before the first run, "Retry what failed" after it. */
    private renderAction(state: SetupViewState, ran: boolean): TemplateResult {
        const step = this.step(state, 'provision');
        if (step.state === 'ok') {
            return EMPTY;
        }
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon="cloud"
                ?disabled=${step.busy}
                @click=${() => {
                    this.act((intents) => {
                        intents.provision();
                    });
                }}
                >${this.t(ran ? 'adminSetup.provision.retry' : 'adminSetup.provision.run')}</hcm-button
            >
        </div>`;
    }
}

/** Registers `<hcm-setup-provision>` and what it renders. */
export function defineHcmSetupProvision(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SETUP_PROVISION_TAG, HcmSetupProvision);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-provision': HcmSetupProvision;
    }
}
