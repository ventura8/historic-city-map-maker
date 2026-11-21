/**
 * The Platform card's body (step e1, M28: `docs/research/M28-sources.md` §5): the services every map runs on, in five sections
 * (Google Cloud with billing and the budget; Firebase: sign-in, the server, the two web addresses, App Check; Firestore;
 * storage, processing and secret keys; Mapbox). Each says what it does, its costs and free allowance, its limits, how to sign
 * up (with the provider's page where there is an account to make), its state as its own step knows it, and a link to that
 * step: the card restructures what Setup shows, never what the steps do (their ids, links and funnel steps are unchanged).
 */
import { PLATFORM_LINKS, PLATFORM_SECTIONS, type PlatformSection } from '@hcm/shared/sources';
import { translateAdminSources, type AdminSourcesKey } from '@hcm/shared/admin-sources';
import { html, type TemplateResult } from 'lit';

import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupStepId, SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { setupLabel } from './setup-text.js';
import { actionLink, providerLinks, sourcesKey, sourcesStyles } from './sources-parts.js';

const HCM_SETUP_PLATFORM_TAG = 'hcm-setup-platform';

interface SectionSpec {
    /** The steps that set it up: it is ready once they are done. */
    readonly steps: readonly SetupStepId[];
    /** The step its Open the step button goes to. */
    readonly open: SetupStepId;
    /** How many `help.N` texts it has. */
    readonly helps: number;
    /** The provider's sign-up or sign-in page, where there is an account to make; null for none. */
    readonly signUp: (view: SetupViewState) => string | null;
}

/** A link of a step's card (`links.json`), or null. */
function stepLink(view: SetupViewState, step: SetupStepId, id: string): string | null {
    return view.steps[step].links.find((link) => link.id === id)?.url ?? null;
}

const SECTIONS: Readonly<Record<PlatformSection, SectionSpec>> = {
    googleCloud: { steps: ['billing'], open: 'billing', helps: 3, signUp: (view) => view.billing.createUrl },
    firebase: { steps: ['deploy', 'claim'], open: 'deploy', helps: 2, signUp: (view) => stepLink(view, 'signIn', 'gcp.firebaseConsole') },
    firestore: { steps: ['provision'], open: 'provision', helps: 1, signUp: () => null },
    cloudServices: { steps: ['provision'], open: 'provision', helps: 1, signUp: () => null },
    mapbox: { steps: ['mapbox'], open: 'mapbox', helps: 2, signUp: (view) => stepLink(view, 'mapbox', 'mapbox.signup') },
};

/** A section is ready once every step that sets it up is done. */
export function sectionReady(view: SetupViewState, section: PlatformSection): boolean {
    return SECTIONS[section].steps.every((step) => view.steps[step].state === 'ok');
}

export class HcmSetupPlatform extends SetupBody {
    static override readonly styles = [setupTextStyles, sourcesStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        return html`<div class="body">
            <p>${this.s('adminSources.platform.intro')}</p>
            <ul class="group">
                ${PLATFORM_SECTIONS.map((section) => this.renderSection(state, section))}
            </ul>
        </div>`;
    }

    private s(key: AdminSourcesKey, params?: Readonly<Record<string, string>>): string {
        return translateAdminSources(this.locale, key, params);
    }

    private renderSection(state: SetupViewState, section: PlatformSection): TemplateResult {
        const spec = SECTIONS[section];
        const prefix = `adminSources.platform.${section}`;
        const text = (part: string): string => this.s(sourcesKey(`${prefix}.${part}`));
        const ready = sectionReady(state, section);
        const helps = Array.from({ length: spec.helps }, (_, index) => text(`help.${String(index + 1)}`));
        return html`<li class="source" data-platform=${section}>
            <div class="source-head">
                <h3 class="title-small source-name">${text('title')}</h3>
                <span class="account label-medium" data-account=${ready ? 'signedIn' : 'needed'}
                    ><hcm-icon name=${ready ? 'check_circle' : 'pending'} aria-hidden="true"></hcm-icon>${this.s(
                        ready ? 'adminSources.platform.status.ready' : 'adminSources.platform.status.toDo',
                    )}</span
                >
            </div>
            <p>${text('role')}</p>
            <details class="details">
                <summary>${this.s('adminSources.details')}</summary>
                <div class="detail-body">
                    <h4 class="title-small">${this.s('adminSources.platform.section.cost')}</h4>
                    <p>${text('cost')}</p>
                    <h4 class="title-small">${this.s('adminSources.platform.section.limits')}</h4>
                    <p>${text('limits')}</p>
                    <h4 class="title-small">${this.s('adminSources.platform.section.help')}</h4>
                    <ol>
                        ${helps.map((help) => html`<li>${help}</li>`)}
                    </ol>
                    ${providerLinks((key, params) => this.s(key, params), PLATFORM_LINKS[section])}
                </div>
            </details>
            <div class="actions">${this.renderActions(state, spec, ready, text('title'))}</div>
        </li>`;
    }

    /** Sign up (the provider's page, while the section is to do) and Open the step. */
    private renderActions(state: SetupViewState, spec: SectionSpec, ready: boolean, title: string): TemplateResult {
        const signUp = ready ? null : spec.signUp(state);
        const step = setupLabel(this.locale, `adminSetup.step.${spec.open}`);
        const signUpLabel = this.s('adminSources.platform.signUp') + ': ' + title;
        const openLabel = this.s('adminSources.platform.open') + ': ' + step;
        return html`${signUp === null ? EMPTY : actionLink(signUpLabel, signUp, true)}
        ${actionLink(openLabel, '#/setup/' + spec.open, false)}`;
    }
}

/** Registers `<hcm-setup-platform>` and what it renders. */
export function defineHcmSetupPlatform(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SETUP_PLATFORM_TAG, HcmSetupPlatform);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-platform': HcmSetupPlatform;
    }
}
