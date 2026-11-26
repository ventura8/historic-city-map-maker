/**
 * The imagery pipeline card's body (step d3, `docs/research/M6-interfaces.md` §1.8, §4.1): the first install starts
 * with the server's (Install the server starts both). Its own button is Try again after a failure, and **Install the
 * pipeline** once the server is there but the pipeline is not (a server installed from GitHub Actions, or a pipeline
 * blocked at the server's click whose blocker has lifted: finding 3 of the M6 review). It shows the build's status
 * (`install-status.ts`), the cost line and, before the server's click, when it will start. While this admin's bundle
 * cannot install the pipeline (no Docker builder, §67e) it says "Not available yet: …" and offers no button at all
 * (finding 43 of 2026-11-01). M7 (`docs/research/M7-local-worker.md` §7): once a pipeline is installed, the local worker's
 * panel (the lazy `worker` chunk) follows the card.
 */
import { html, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { visuallyHidden } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import {
    blockerLine,
    costLine,
    installStatus,
    installStatusStyles,
    mayInstall,
    pipelineInstallsAlone,
    pipelineOffReason,
    pipelineShown,
    pipelineTriesAgain,
    type InstallStatusInput,
} from './install-status.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { loadWorkerElements } from '../worker/load.js';
import type { WorkerHostPort } from '../worker/worker-port.js';
import { setupTextStyles } from './setup-styles.js';

const HCM_SETUP_PIPELINE_TAG = 'hcm-setup-pipeline';

class HcmSetupPipeline extends SetupBody {
    static override readonly properties = { ...SetupBody.properties, app: { attribute: false } };

    static override readonly styles = [setupTextStyles, installStatusStyles, visuallyHidden];

    /** The admin app, which hands the worker's panel its feed. */
    declare app: WorkerHostPort | null;

    constructor() {
        super();
        this.app = null;
    }

    protected override renderBody(state: SetupViewState): TemplateResult {
        const input: InstallStatusInput = {
            target: 'pipeline',
            slice: state.install,
            locale: this.locale,
            intents: this.intents,
            step: 'pipeline',
        };
        return html`<div class="body">
            <p>${this.t('adminSetup.install.pipeline.explain')}</p>
            ${costLine(input)} ${this.renderWaiting(state)} ${installStatus(input)} ${blockerLine(input, pipelineShown(state.install))}
            ${this.renderAction(state)} ${this.renderWorker(state)}
        </div>`;
    }

    /**
     * M7: the local worker's panel once a pipeline is installed and the server answers (normal mode: the panel reads the
     * city's workers and `setup.status`); its elements are the lazy `worker` chunk's.
     */
    private renderWorker(state: SetupViewState): TemplateResult {
        if (state.mode !== 'normal' || state.install.pipeline.installedRelease === null) {
            return EMPTY;
        }
        loadWorkerElements(this.app);
        return html`<hcm-worker-panel .app=${this.app} .locale=${this.locale} project=${state.projectId} level="3"></hcm-worker-panel>`;
    }

    /** Before the server's click, when the pipeline starts. */
    private renderWaiting(state: SetupViewState): TemplateResult {
        const { server, pipeline } = state.install;
        const waits = pipeline.state === 'notInstalled' && pipelineOffReason(state.install) === null;
        return waits && server.buildId === null && !pipelineInstallsAlone(state)
            ? html`<p class="note">${this.t('adminSetup.install.pipeline.waitsForServer')}</p>`
            : EMPTY;
    }

    /** Try again after a stopped build; Install the pipeline once the server is there without it; else nothing. */
    private renderAction(state: SetupViewState): TemplateResult {
        const view = state.install.pipeline;
        const tryAgain = pipelineTriesAgain(state);
        if (!tryAgain && !pipelineInstallsAlone(state)) {
            return EMPTY;
        }
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon=${tryAgain ? 'replay' : 'cloud'}
                ?disabled=${!mayInstall(view)}
                @click=${() => {
                    this.act((intents) => {
                        intents.install('pipeline');
                    });
                }}
                >${this.t(tryAgain ? 'adminSetup.install.tryAgain' : 'adminSetup.install.pipeline.action')}</hcm-button
            >
        </div>`;
    }
}

/** Registers `<hcm-setup-pipeline>` and what it renders. */
export function defineHcmSetupPipeline(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SETUP_PIPELINE_TAG, HcmSetupPipeline);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-pipeline': HcmSetupPipeline;
    }
}
