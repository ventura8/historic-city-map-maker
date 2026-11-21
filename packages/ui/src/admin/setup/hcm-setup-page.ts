/**
 * The Setup Assistant page (`docs/research/M2b-interfaces.md` §1.2, §3): the progress ring with "n of 9 steps done",
 * Check again for the whole page, and one card per step of the controller's state. On compact and medium windows the
 * steps are one column of accordion cards, the open step expanded in place; from expanded (840 px) the list sits
 * beside the open step (list and detail, the detail at most 840 px wide). The page opens at the controller's
 * `openStep`: the first incomplete step, or the one the address named. After Check again, the self-test's checks are
 * listed under the header, each failing one with its reason and a link to its step (`self-test.ts`). M6 (setup-ux,
 * findings 7, 16 and 24): the header counts a postponed step apart ("8 of 9 steps done, 1 for later") and says what
 * "done" leaves open (USGS later, or its approval pending); a card gets the consent note only while no live token
 * holds its scope.
 */
import type { AdminSetupKey, UiLocale } from '@hcm/shared';
import { funnelHelpOpened, trackFunnel } from '@hcm/shared/funnels';
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmImageryCensus, setupCensus } from '../../census/hcm-imagery-census.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { baseStyles, focusRing, typeStyles } from '../../components/styles.js';
import { observeWindowSize } from '../../layout/window-class.js';
import { EMPTY } from '../shell/empty.js';
import type { WindowClass } from '../../theme/tokens.js';
import { defineHcmCrashGroups } from './hcm-crash-groups.js';
import { defineHcmSetupAnalytics } from './hcm-setup-analytics.js';
import { defineHcmSetupBilling } from './hcm-setup-billing.js';
import { defineHcmSetupDeploy } from './hcm-setup-deploy.js';
import { defineHcmSetupPipeline } from './hcm-setup-pipeline.js';
import { defineHcmSetupSite } from './hcm-setup-site.js';
import { defineHcmSetupImport } from './hcm-setup-import.js';
import { defineHcmSetupMapbox } from './hcm-setup-mapbox.js';
import { defineHcmSetupProvision } from './hcm-setup-provision.js';
import { defineHcmSetupStep, type ConsentNoteParams } from './hcm-setup-step.js';
import { defineHcmSetupUsgs } from './hcm-setup-usgs.js';
import { installCardAsks } from './install-status.js';
import { selfTestList, selfTestStyles } from './self-test.js';
import { SetupPortHost } from './setup-host.js';
import type { SetupIntentsPort, SetupStepId, SetupStepView, SetupViewState } from './setup-port.js';
import { setupFunnel } from './setup-funnel.js';
import { setupTextStyles } from './setup-styles.js';
import { formatMoney, setupLabel, setupText } from './setup-text.js';

export const HCM_SETUP_PAGE_TAG = 'hcm-setup-page';

/** The header's "done" line: plainly done, or done with USGS's approval pending or USGS left for later (M6). */
const READY_TEXTS: Readonly<Record<NonNullable<SetupViewState['doneNote']> | 'none', AdminSetupKey>> = {
    none: 'adminSetup.ready',
    usgsPending: 'adminSetup.readyUsgsPending',
    usgsLater: 'adminSetup.readyUsgsLater',
};

/** "n of total steps done" (with "m for later" when a step is postponed). */
function progressText(language: UiLocale, view: SetupViewState): string {
    const counts = { done: String(view.done), total: String(view.total), later: String(view.later) };
    return setupLabel(language, view.later > 0 ? 'adminSetup.progressLater' : 'adminSetup.progress', counts);
}

/** From this window class the page shows the list beside the open step. */
const SPLIT_CLASSES: ReadonlySet<WindowClass> = new Set<WindowClass>(['expanded', 'large', 'extra-large']);

interface BodyInput {
    readonly view: SetupViewState;
    readonly intents: SetupIntentsPort | null;
    readonly locale: UiLocale;
    /** The admin app (M7: the pipeline card's worker panel asks it for its feed). */
    readonly app: unknown;
}

/** The card body of each step that has one (sign-in and the claim are text only). */
const BODIES: Partial<Record<SetupStepId, (input: BodyInput) => TemplateResult>> = {
    billing: (input) => html`<hcm-setup-billing .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-billing>`,
    provision: (input) =>
        html`<hcm-setup-provision .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-provision>`,
    deploy: (input) => html`<hcm-setup-deploy .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-deploy>`,
    mapbox: (input) => html`<hcm-setup-mapbox .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-mapbox>`,
    // M28: the app's platform (e1) and the map's sources (e2).
    platform: (input) =>
        html`<hcm-setup-platform .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-platform>`,
    sources: (input) => html`<hcm-setup-sources .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-sources>`,
    usgs: (input) => html`<hcm-setup-usgs .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-usgs>`,
    analytics: (input) =>
        html`<hcm-setup-analytics .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-analytics>`,
    legacyImport: (input) =>
        html`<hcm-setup-import .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-import>`,
    // [section install] owner: installer (M6, CR-M6-6): the imagery pipeline (d3) and Publish the map (i).
    pipeline: (input) =>
        html`<hcm-setup-pipeline
            .view=${input.view}
            .intents=${input.intents}
            .locale=${input.locale}
            .app=${input.app}
        ></hcm-setup-pipeline>`,
    site: (input) => html`<hcm-setup-site .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-site>`,
    // [end install]
};

export class HcmSetupPage extends SetupPortHost {
    static override readonly properties = {
        ...SetupPortHost.properties,
        windowClass: { type: String, reflect: true, attribute: 'window-class' },
    };

    // The kit's ring (focusRing): without it the server checks' fix links showed the browser's own ring (finding 20's tour state).
    static override readonly styles = [baseStyles, focusRing, typeStyles, setupTextStyles, selfTestStyles, pageStyles()];

    /**
     * The page's width class. Only the width is followed (the page's height follows its content), and a change is
     * applied on the next frame: re-laying out inside the observer's callback would resize the page it observes
     * ("ResizeObserver loop completed with undelivered notifications").
     */
    declare windowClass: WindowClass;

    private stopObserving: (() => void) | null = null;

    constructor() {
        super();
        this.windowClass = 'compact';
        this.addEventListener('click', this.#linkOpened);
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.stopObserving = observeWindowSize(this, (size) => {
            requestAnimationFrame(() => {
                this.windowClass = size.widthClass;
            });
        });
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopObserving?.();
        this.stopObserving = null;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const split = SPLIT_CLASSES.has(this.windowClass);
        return html`<section class="page" aria-labelledby="setup-title">
            ${this.renderHeader(view)}
            <div role="alert">${view.error === null ? nothing : html`<p class="alert">${setupText(this.language, view.error)}</p>`}</div>
            ${setupCensus(view, this.language)} ${selfTestList(this.language, view)}
            ${split ? this.renderSplit(view) : this.renderColumn(view)}
        </section>`;
    }

    /** The whole assistant's counted inputs and consents, for the e2e input budget (S-A30-HAPPY). */
    protected override updated(): void {
        if (this.view !== null) {
            this.dataset['inputs'] = String(this.view.used.inputs);
            this.dataset['consents'] = String(this.view.used.consents);
            // The funnel (§200): what changed since the last render, as codes (never the cards' words).
            trackFunnel(this, setupFunnel(this.view));
        }
    }

    /** A guide or console link of the open card opened in a new tab: the step's help (`step_help_opened`). */
    readonly #linkOpened = (event: Event): void => {
        const step = this.view?.openStep;
        const link = event.composedPath().some((node) => node instanceof HTMLAnchorElement && node.target === '_blank');
        if (step !== null && step !== undefined && link) {
            funnelHelpOpened(this, 'setup', step);
        }
    };

    private renderHeader(view: SetupViewState): TemplateResult {
        const loading = view.loading === true;
        const checking = loading || view.checking;
        const progress = progressText(this.language, view);
        const status = checking ? setupLabel(this.language, 'adminSetup.checking') : progress;
        return html`<header class="header">
            ${this.renderRing(view, loading, loading ? status : progress)}
            <div class="heading-text">
                <h1 id="setup-title" class="headline-small">${setupLabel(this.language, 'adminSetup.title')}</h1>
                <p class="note" role="status" ?data-loading=${loading}>${status}</p>
                ${this.renderReady(view)}
            </div>
            <hcm-button
                variant="tonal"
                icon="refresh"
                ?disabled=${checking}
                @click=${() => {
                    this.intents?.recheck();
                }}
                >${setupLabel(this.language, 'adminSetup.recheck')}</hcm-button
            >
        </header>`;
    }

    /** The header's "done" line once Setup is done. */
    private renderReady(view: SetupViewState): TemplateResult {
        return view.ready ? html`<p class="success ready">${setupLabel(this.language, READY_TEXTS[view.doneNote ?? 'none'])}</p>` : EMPTY;
    }

    /**
     * The progress ring with "n/total"; finding 32 of 2026-10-31: while the first checks have not answered, an indeterminate
     * ring without a count (never "0/11" meanwhile).
     */
    private renderRing(view: SetupViewState, loading: boolean, label: string): TemplateResult {
        if (loading) {
            return html`<div class="ring"><hcm-progress kind="circular" indeterminate label=${label}></hcm-progress></div>`;
        }
        return html`<div class="ring">
            <hcm-progress kind="circular" .value=${view.done / view.total} label=${label}></hcm-progress>
            <span class="count label-large" aria-hidden="true">${view.done}/${view.total}</span>
        </div>`;
    }

    /**
     * The consent note's words, or null when no button of the card asks Google now: a live token holds the step's scope
     * (finding 7), or an install card has nothing to do and no Continue (finding 40 of 2026-11-01, `installCardAsks`).
     */
    private noteParams(view: SetupViewState, step: SetupStepView): ConsentNoteParams | null {
        if (step.scope === null || view.liveScopes.includes(step.scope)) {
            return null;
        }
        if (!step.needsContinue && !installCardAsks(view, step.id)) {
            return null;
        }
        return {
            projectId: view.projectId,
            domain: view.authDomain,
            amount: formatMoney(this.language, view.billing.amount, view.billing.currency),
        };
    }

    private renderBody(view: SetupViewState, id: SetupStepId): TemplateResult {
        const body = BODIES[id];
        return body === undefined ? EMPTY : body({ view, intents: this.intents, locale: this.language, app: this.app });
    }

    private renderColumn(view: SetupViewState): TemplateResult {
        return html`<ol class="steps" aria-label=${setupLabel(this.language, 'adminSetup.steps')}>
            ${view.order.map((id) => {
                const open = view.openStep === id;
                return html`<li>
                    <hcm-setup-step
                        mode="inline"
                        .step=${view.steps[id]}
                        .intents=${this.intents}
                        .noteParams=${this.noteParams(view, view.steps[id])}
                        .locale=${this.language}
                        ?open=${open}
                        >${open ? this.renderBody(view, id) : nothing}</hcm-setup-step
                    >
                </li>`;
            })}
        </ol>`;
    }

    private renderSplit(view: SetupViewState): TemplateResult {
        const open = view.openStep;
        return html`<div class="split">
            <ol class="steps list" aria-label=${setupLabel(this.language, 'adminSetup.steps')}>
                ${view.order.map(
                    (id) =>
                        html`<li>
                            <hcm-setup-step
                                mode="summary"
                                .step=${view.steps[id]}
                                .intents=${this.intents}
                                .locale=${this.language}
                                ?open=${open === id}
                            ></hcm-setup-step>
                        </li>`,
                )}
            </ol>
            <div class="detail">
                ${
                    open === null
                        ? nothing
                        : html`<hcm-setup-step
                              mode="detail"
                              .step=${view.steps[open]}
                              .intents=${this.intents}
                              .noteParams=${this.noteParams(view, view.steps[open])}
                              .locale=${this.language}
                              open
                              >${this.renderBody(view, open)}</hcm-setup-step
                          >`
                }
            </div>
        </div>`;
    }
}

function pageStyles(): ReturnType<typeof css> {
    return css`
        :host {
            display: block;
            container-type: inline-size;
        }

        /* The list (360 px at most) and the detail (840 px at most) stay together, centred on a wide window. */
        .page {
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-sizing: border-box;
            inline-size: 100%;
            max-inline-size: 1256px;
            margin-inline: auto;
            padding: 16px;
        }

        .header {
            display: flex;
            flex-wrap: wrap;
            gap: 12px 16px;
            align-items: center;
        }

        .ring {
            position: relative;
            display: grid;
            place-items: center;
        }

        .count {
            position: absolute;
        }

        .heading-text {
            flex: 1 1 16ch;
            min-inline-size: 0;
        }

        h1 {
            margin: 0;
        }

        .steps {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .split {
            display: grid;
            grid-template-columns: minmax(240px, 360px) minmax(0, 840px);
            gap: 24px;
            align-items: start;
        }

        .list {
            gap: 4px;
        }
    `;
}

/** Registers `<hcm-setup-page>`, every card and body, and the kit elements they render. */
/**
 * M28: fetches the Platform and Sources cards' chunk and registers them; a failed fetch leaves the two cards empty until the
 * page loads again, and the next definition tries again.
 */
export async function loadSourcesCards(registry: CustomElementRegistry = customElements): Promise<void> {
    try {
        (await import('./sources-cards.js')).defineSourcesCards(registry);
    } catch {
        // The cards stay unregistered: the steps' own cards and links still work, and the next page load fetches it again.
        return;
    }
}

export function defineHcmSetupPage(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineHcmSetupStep(registry);
    defineHcmSetupBilling(registry);
    defineHcmSetupProvision(registry);
    defineHcmSetupDeploy(registry);
    defineHcmSetupPipeline(registry);
    defineHcmSetupSite(registry);
    defineHcmSetupMapbox(registry);
    defineHcmSetupUsgs(registry);
    defineHcmImageryCensus(registry);
    void loadSourcesCards(registry);
    defineHcmSetupAnalytics(registry);
    defineHcmSetupImport(registry);
    defineHcmCrashGroups(registry);
    defineOnce(registry, HCM_SETUP_PAGE_TAG, HcmSetupPage);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-page': HcmSetupPage;
    }
}
