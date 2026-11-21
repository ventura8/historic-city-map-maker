/**
 * `<hcm-install-over>`: "Install this admin's version anyway" on the card of a target newer than this admin (the live
 * finding of 2026-11-12, `docs/research/M6-interfaces.md` §1.7.1). The downgrade guard stays: the card offers no Update,
 * and this outlined button opens a confirmation that says the build replaces the newer release with the admin's older
 * one (a rollback, which Cloud Build's history marks). Install it calls the intent; Keep, Esc and the scrim close it. The
 * card's status is a function without state, so this element keeps whether its dialog is open.
 */
import type { InstallTarget, Locale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmConfirmDialog } from '../editing/hcm-confirm-dialog.js';
import type { SetupIntentsPort } from './setup-port.js';
import { setupLabel } from './setup-text.js';

const HCM_INSTALL_OVER_TAG = 'hcm-install-over';

class HcmInstallOver extends LitElement {
    static override readonly properties = {
        target: { type: String },
        locale: { type: String },
        installed: { type: String },
        release: { type: String },
        disabled: { type: Boolean },
        intents: { attribute: false },
        asking: { state: true },
    };

    static override readonly styles = css`
        :host {
            display: block;
        }
    `;

    declare target: InstallTarget;
    declare locale: Locale;
    /** The newer release installed. */
    declare installed: string;
    /** This admin's own release, which the build installs. */
    declare release: string;
    declare disabled: boolean;
    declare intents: SetupIntentsPort | null;
    /** The confirmation is open. */
    declare asking: boolean;

    constructor() {
        super();
        this.target = 'server';
        this.locale = 'ro';
        this.installed = '';
        this.release = '';
        this.disabled = false;
        this.intents = null;
        this.asking = false;
    }

    override render(): TemplateResult {
        const params = { installed: this.installed, release: this.release };
        const t = (key: Parameters<typeof setupLabel>[1]): string => setupLabel(this.locale, key, params);
        return html`<hcm-button
                variant="outlined"
                icon="history"
                ?disabled=${this.disabled}
                @click=${() => {
                    this.asking = true;
                }}
                >${t('adminSetup.install.over.action')}</hcm-button
            >
            <hcm-confirm-dialog
                destructive
                .open=${this.asking}
                .headline=${t('adminSetup.install.over.title')}
                .body=${t('adminSetup.install.over.body')}
                .confirmLabel=${t('adminSetup.install.over.confirm')}
                .cancelLabel=${t('adminSetup.install.over.cancel')}
                .closeLabel=${t('adminSetup.install.over.close')}
                @hcm-confirm=${() => {
                    this.asking = false;
                    this.intents?.installOver(this.target);
                }}
                @hcm-cancel=${() => {
                    this.asking = false;
                }}
            ></hcm-confirm-dialog>`;
    }
}

/** Registers `<hcm-install-over>` and what it renders. */
export function defineHcmInstallOver(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmConfirmDialog(registry);
    defineOnce(registry, HCM_INSTALL_OVER_TAG, HcmInstallOver);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-install-over': HcmInstallOver;
    }
}
