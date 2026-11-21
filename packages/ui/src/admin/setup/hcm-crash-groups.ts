/**
 * The crash reports panel (`docs/research/M2b-interfaces.md` §3.3 g; PLAN Addendum 2): the last week's Error
 * Reporting groups from `telemetry.listGroups`, each message as text (the server redacted it) with how often and when
 * it last happened. Error Reporting disabled offers "Enable with Google" (CR-M2-40); any other failure offers Retry.
 * Inside the analytics card it is a section; `standalone` (the `#/crashes` page) makes its title the page's heading
 * and lists the groups as soon as it appears.
 */
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmLoadingIndicator } from '../../components/loading-indicator.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupMessage, SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { formatDateTime, setupText } from './setup-text.js';

const HCM_CRASH_GROUPS_TAG = 'hcm-crash-groups';

type Crashes = SetupViewState['crashes'];

export class HcmCrashGroups extends SetupBody {
    static override readonly properties = { ...SetupBody.properties, standalone: { type: Boolean, reflect: true } };

    static override readonly styles = [
        setupTextStyles,
        css`
            .title {
                margin: 0;
                font-family: var(--md-sys-typescale-title-medium-font);
                font-size: var(--md-sys-typescale-title-medium-size);
                font-weight: var(--md-sys-typescale-title-medium-weight);
            }

            :host([standalone]) .title {
                font-family: var(--md-sys-typescale-headline-small-font);
                font-size: var(--md-sys-typescale-headline-small-size);
            }

            .groups {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            .message {
                overflow-wrap: anywhere;
            }
        `,
    ];

    /** The `#/crashes` page: the title is the page's heading and the groups load when it appears. */
    declare standalone: boolean;

    constructor() {
        super();
        this.standalone = false;
    }

    protected override firstUpdated(): void {
        if (this.standalone && this.view !== null) {
            this.loadOnce(this.view.crashes);
        }
    }

    protected override renderBody(state: SetupViewState): TemplateResult {
        const { crashes } = state;
        const level = this.standalone ? '1' : '3';
        return html`<section class="body" aria-labelledby="crash-title">
            <p id="crash-title" class="title" role="heading" aria-level=${level}>${this.t('adminSetup.crashes.title')}</p>
            ${crashes.busy ? html`<hcm-loading-indicator label=${this.t('adminSetup.crashes.loading')}></hcm-loading-indicator>` : nothing}
            <div role="alert">${crashes.error === null ? nothing : this.renderError(crashes.error, crashes.disabledApi)}</div>
            ${this.renderGroups(crashes)}
        </section>`;
    }

    private loadOnce(crashes: Crashes): void {
        if (!crashes.loaded && !crashes.busy) {
            this.act((intents) => {
                intents.loadCrashGroups();
            });
        }
    }

    /** The failure and its way out: "Enable with Google" for a disabled API, else Retry. */
    private renderError(error: SetupMessage, api: string | null): TemplateResult {
        const label = this.t(api === null ? 'adminSetup.retry' : 'adminSetup.crashes.enableApi');
        return html`<p class="alert">${setupText(this.locale, error)}</p>
            <div class="actions">
                <hcm-button
                    variant="tonal"
                    @click=${() => {
                        this.act((intents) => {
                            if (api === null) {
                                intents.loadCrashGroups();
                                return;
                            }
                            intents.enableApi(api);
                        });
                    }}
                    >${label}</hcm-button
                >
            </div>`;
    }

    /** The list once loaded (nothing while a failure is shown). */
    private renderGroups(crashes: Crashes): TemplateResult {
        if (!crashes.loaded || crashes.error !== null) {
            return EMPTY;
        }
        if (crashes.groups.length === 0) {
            return html`<p class="note">${this.t('adminSetup.crashes.none')}</p>`;
        }
        return html`<ul class="groups">
            ${crashes.groups.map(
                (group) =>
                    html`<li data-group=${group.groupId}>
                        <p class="message">${group.message}</p>
                        <p class="note">
                            ${this.t('adminSetup.crashes.count', {
                                count: String(group.count),
                                date: formatDateTime(this.locale, group.lastSeen),
                                service: group.service,
                            })}
                        </p>
                    </li>`,
            )}
        </ul>`;
    }
}

/** Registers `<hcm-crash-groups>` and what it renders. */
export function defineHcmCrashGroups(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmLoadingIndicator(registry);
    defineOnce(registry, HCM_CRASH_GROUPS_TAG, HcmCrashGroups);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-crash-groups': HcmCrashGroups;
    }
}
