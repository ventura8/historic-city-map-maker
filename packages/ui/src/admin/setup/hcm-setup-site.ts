/**
 * The public map card's body (step i, `docs/research/M6-interfaces.md` §1.8, §2): the address it publishes to (the
 * project's own Hosting address; the admin stays at `/admin/`), what visitors will see, the cost line and **Publish
 * the map** (one click), off with the reason while there is nothing to show (no published manifest of the first city)
 * or the server is not installed. A tip suggests importing the old photos first. Once published: the address as a link
 * and the release; an older site offers Update the map (`install-status.ts`).
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { visuallyHidden } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import {
    blockerLine,
    costLine,
    INSTALLABLE_STATES,
    installStatus,
    installStatusStyles,
    mayInstall,
    type InstallStatusInput,
} from './install-status.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';

const HCM_SETUP_SITE_TAG = 'hcm-setup-site';

/** The states in which the public map is there to open. */
const PUBLISHED: ReadonlySet<string> = new Set(['installed', 'updateAvailable', 'newerInstalled']);

class HcmSetupSite extends SetupBody {
    static override readonly styles = [setupTextStyles, installStatusStyles, visuallyHidden];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const input: InstallStatusInput = {
            target: 'site',
            slice: state.install,
            locale: this.locale,
            intents: this.intents,
            step: 'site',
        };
        return html`<div class="body">
            <p>${this.t('adminSetup.install.site.explain')}</p>
            <p>${this.t('adminSetup.install.site.address', { address: state.install.address })}</p>
            <p class="note">${this.t('adminSetup.install.site.visitors')}</p>
            ${costLine(input)} ${installStatus(input)} ${this.renderPublished(state)} ${this.renderAction(state, input)}
        </div>`;
    }

    /** The public map's address as a link, once it is there. */
    private renderPublished(state: SetupViewState): TemplateResult {
        if (!PUBLISHED.has(state.install.site.state)) {
            return EMPTY;
        }
        return html`<p class="success">${this.t('adminSetup.install.site.published')}</p>
            <a class="public-map" href=${state.install.address} target="_blank" rel="noopener noreferrer"
                >${this.t('adminSetup.install.site.open')}<span class="visually-hidden"> ${this.t('adminSetup.newTab')}</span></a
            >`;
    }

    private renderAction(state: SetupViewState, input: InstallStatusInput): TemplateResult {
        const view = state.install.site;
        if (!INSTALLABLE_STATES.has(view.state)) {
            return blockerLine(input, view);
        }
        const tip =
            state.steps.legacyImport.state === 'ok' || !state.order.includes('legacyImport')
                ? nothing
                : html`<p class="note">${this.t('adminSetup.install.site.importFirst')}</p>`;
        return html`${blockerLine(input, view)} ${tip}
            <div class="actions">${this.renderButton(view.state === 'failed', !mayInstall(view) || state.steps.site.busy)}</div>`;
    }

    private renderButton(tryAgain: boolean, disabled: boolean): TemplateResult {
        return html`<hcm-button
            variant="filled"
            icon=${tryAgain ? 'replay' : 'publish'}
            ?disabled=${disabled}
            @click=${() => {
                this.act((intents) => {
                    intents.install('site');
                });
            }}
            >${this.t(tryAgain ? 'adminSetup.install.tryAgain' : 'adminSetup.install.site.action')}</hcm-button
        >`;
    }
}

/** Registers `<hcm-setup-site>` and what it renders. */
export function defineHcmSetupSite(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SETUP_SITE_TAG, HcmSetupSite);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-site': HcmSetupSite;
    }
}
