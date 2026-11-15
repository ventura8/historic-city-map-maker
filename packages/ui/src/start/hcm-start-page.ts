/**
 * The public start page (`docs/research/M14-start-your-map.md`): what you get, the cost in honest words, the accounts, then
 * Google's consent, the city and the project, the run, and the one console click no API can do. Every word comes from the
 * `start.*` catalogue, in logical CSS, with no kit element: this page loads before anything exists, and stays small.
 */
import { directionOf, familyLanguage, translateStart, type UiLocale, type StartKey } from '@hcm/shared';
import { trackFunnel } from '@hcm/shared/funnels';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { defineHcmImageryCensus } from '../census/hcm-imagery-census.js';
import { defineOnce } from '../components/internal.js';
import { applyTheme } from '../theme/apply.js';
import { BASELINE_THEME } from '../theme/baseline.js';
import { defineHcmStartLanguage } from './hcm-start-language.js';
import { closedScreen, introScreen, type StartText } from './start-intro.js';
import { doneScreen, failurePanel, providerScreen, workScreen, type RunFailure, type RunView } from './start-run.js';
import { startHostStyles, startStyles } from './start-styles.js';
import { startFunnel } from './start-funnel.js';

export const HCM_START_PAGE_TAG = 'hcm-start-page';

const EDGES = ['west', 'south', 'east', 'north'] as const;

type Edge = (typeof EDGES)[number];

export type StartPageFailure = RunFailure;

export interface StartPageView extends RunView {
    readonly screen: 'closed' | 'intro' | 'plan' | 'work' | 'provider' | 'done';
    readonly locale: UiLocale;
    readonly form: {
        readonly nameRo: string;
        readonly nameEn: string;
        readonly cityId: string;
        readonly area: Readonly<Record<Edge, string>>;
        readonly create: boolean;
        readonly projectId: string;
        readonly picked: string;
    };
    readonly projects: readonly { readonly projectId: string; readonly displayName: string }[] | null;
    readonly notice: StartKey | null;
    readonly busy: boolean;
    readonly command: string;
}

export interface StartPagePort {
    readonly view: StartPageView;
    subscribe(listener: () => void): () => void;
    readonly intents: {
        setLocale(locale: UiLocale): void;
        signIn(): void;
        setName(name: string): void;
        setNameEn(name: string): void;
        setCityId(cityId: string): void;
        setEdge(edge: Edge, value: string): void;
        setCreate(create: boolean): void;
        setProjectId(projectId: string): void;
        setPicked(projectId: string): void;
        go(): void;
        tryAgain(): void;
        checkProvider(): void;
    };
    /** M29: the rectangle the imagery census searches, once it can be a city (absent: no census). */
    censusBox?(): readonly [number, number, number, number] | null;
    /** What the form says about its values (the form's own rules), and whether Create may run. */
    readonly problems: () => {
        readonly cityId: StartKey | null;
        readonly area: StartKey | null;
        readonly projectId: StartKey | null;
        readonly ready: boolean;
    };
}

interface FieldSpec {
    readonly id: string;
    readonly label: StartKey;
    readonly value: string;
    readonly input: (value: string) => void;
    readonly problem: StartKey | null;
    readonly help?: string;
}

const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

export class HcmStartPage extends LitElement {
    static override readonly properties = { port: { attribute: false } };
    static override readonly styles = [startHostStyles, startStyles];

    declare port: StartPagePort | undefined;
    #unsubscribe: (() => void) | null = null;
    /** The screen last rendered: a move to another one takes the focus to its heading, which a reader then announces. */
    #shown: StartPageView['screen'] | undefined;

    override connectedCallback(): void {
        super.connectedCallback();
        applyTheme(this, BASELINE_THEME, 'system', false);
        this.#follow();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    override willUpdate(changed: Map<PropertyKey, unknown>): void {
        if (changed.has('port')) {
            this.#follow();
        }
    }

    override updated(): void {
        this.#trackFunnel();
        const screen = this.port?.view.screen;
        if (this.#shown !== undefined && screen !== this.#shown) {
            this.renderRoot.querySelector('h1')?.focus();
        }
        this.#shown = screen;
    }

    /** The start's funnel (§200): what changed since the last render, as codes. */
    #trackFunnel(): void {
        if (this.port !== undefined) {
            trackFunnel(this, startFunnel(this.port.view));
        }
    }

    #follow(): void {
        this.#unsubscribe?.();
        this.#unsubscribe =
            this.port?.subscribe(() => {
                this.requestUpdate();
            }) ?? null;
    }

    #t(key: StartKey, params?: Readonly<Record<string, string>>): string {
        return translateStart(this.port?.view.locale ?? 'ro', key, params);
    }

    readonly #text: StartText = (key, params) => this.#t(key, params);

    readonly #tryAgain = (): void => {
        this.port?.intents.tryAgain();
    };

    override render(): TemplateResult {
        const view = this.port?.view;
        if (view === undefined) {
            return html``;
        }
        document.documentElement.lang = view.locale;
        document.documentElement.dir = directionOf(view.locale);
        // Until a language's file holds the start page's texts they show in English, and say so (WCAG 3.1.2).
        const shown = familyLanguage(view.locale, 'start.');
        return html`<header>
                <p class="brand" lang=${shown}>${this.#t('start.title')}</p>
                <hcm-start-language
                    lang=${shown}
                    .locale=${view.locale}
                    .choose=${(locale: UiLocale) => {
                        this.port?.intents.setLocale(locale);
                    }}
                ></hcm-start-language>
            </header>
            <main lang=${shown}>${this.#screen(view)}</main>`;
    }

    #screen(view: StartPageView): TemplateResult {
        const screens: Readonly<Record<StartPageView['screen'], () => TemplateResult>> = {
            closed: () => closedScreen(this.#text, view),
            intro: () =>
                introScreen(this.#text, view, () => {
                    this.port?.intents.signIn();
                }),
            plan: () => this.#plan(view),
            work: () => workScreen(this.#text, view, this.#tryAgain),
            provider: () =>
                providerScreen(this.#text, view, () => {
                    this.port?.intents.checkProvider();
                }),
            done: () => doneScreen(this.#text, view),
        };
        return screens[view.screen]();
    }

    #field(spec: FieldSpec): TemplateResult {
        const { id, problem, help } = spec;
        const described = [help === undefined ? '' : `${id}-help`, problem === null ? '' : `${id}-problem`].join(' ').trim();
        return html`<div class="field">
            <label for=${id}>${this.#t(spec.label)}</label>
            <input
                id=${id}
                .value=${spec.value}
                autocomplete="off"
                aria-invalid=${problem === null ? 'false' : 'true'}
                aria-describedby=${described === '' ? nothing : described}
                @input=${(event: Event) => {
                    spec.input(valueOf(event));
                }}
            />
            ${this.#fieldNotes(spec)}
        </div>`;
    }

    #fieldNotes({ id, problem, help }: FieldSpec): TemplateResult {
        const helpLine = help === undefined ? nothing : html`<p id="${id}-help" class="note">${help}</p>`;
        const problemLine = problem === null ? nothing : html`<p id="${id}-problem" class="alert">${this.#t(problem)}</p>`;
        // The region is there before its problem, or a reader would not announce it.
        return html`${helpLine}
            <div role="status" data-field-status=${id}>${problemLine}</div>`;
    }

    #edges(view: StartPageView, port: StartPagePort): TemplateResult {
        const problem = port.problems().area;
        return html`<fieldset>
            <legend>${this.#t('start.plan.area')}</legend>
            <p class="note">${this.#t('start.plan.areaHelp')}</p>
            <div class="edges">
                ${EDGES.map(
                    (edge) =>
                        html`<div class="field">
                            <label for="edge-${edge}">${this.#t(`start.plan.${edge}`)}</label>
                            <input
                                id="edge-${edge}"
                                inputmode="decimal"
                                aria-invalid=${problem === null ? 'false' : 'true'}
                                aria-describedby=${problem === null ? nothing : 'area-problem'}
                                .value=${view.form.area[edge]}
                                @input=${(event: Event) => {
                                    port.intents.setEdge(edge, valueOf(event));
                                }}
                            />
                        </div>`,
                )}
            </div>
            <div role="status" data-area-status>
                ${problem === null ? nothing : html`<p id="area-problem" class="alert" data-area-problem>${this.#t(problem)}</p>`}
            </div>
        </fieldset>`;
    }

    #projectKind(view: StartPageView, port: StartPagePort): TemplateResult {
        const radio = (create: boolean, label: StartKey): TemplateResult =>
            html`<label class="choice">
                <input
                    type="radio"
                    name="kind"
                    .checked=${view.form.create === create}
                    @change=${() => {
                        port.intents.setCreate(create);
                    }}
                />
                ${this.#t(label)}
            </label>`;
        return html`<fieldset>
            <legend>${this.#t('start.plan.projectKind')}</legend>
            ${radio(true, 'start.plan.newProject')} ${radio(false, 'start.plan.existingProject')}
            ${view.form.create ? this.#newProject(view, port) : this.#pickProject(view, port)}
        </fieldset>`;
    }

    #newProject(view: StartPageView, port: StartPagePort): TemplateResult {
        const { projectId } = view.form;
        return this.#field({
            id: 'project-id',
            label: 'start.plan.projectId',
            value: projectId,
            input: (value) => {
                port.intents.setProjectId(value);
            },
            problem: port.problems().projectId,
            help: this.#t('start.plan.projectIdHelp', { projectId: projectId === '' ? '…' : projectId }),
        });
    }

    #pickProject(view: StartPageView, port: StartPagePort): TemplateResult {
        if (view.projects === null || view.projects.length === 0) {
            return html`<p class="note" data-no-projects>${view.projects === null ? '…' : this.#t('start.plan.pickNone')}</p>`;
        }
        return html`<div class="field">
            <label for="picked">${this.#t('start.plan.pick')}</label>
            <select
                id="picked"
                @change=${(event: Event) => {
                    port.intents.setPicked(valueOf(event));
                }}
            >
                <option value=""></option>
                ${view.projects.map(
                    (project) =>
                        html`<option value=${project.projectId} ?selected=${project.projectId === view.form.picked}>
                            ${project.displayName} (${project.projectId})
                        </option>`,
                )}
            </select>
            <p class="note">${this.#t('start.plan.pickWarning')}</p>
        </div>`;
    }

    #plan(view: StartPageView): TemplateResult {
        const { port } = this;
        if (port === undefined) {
            return html``;
        }
        const { form } = view;
        return html`<h1 tabindex="-1">${this.#t('start.plan.title')}</h1>
            ${failurePanel(this.#text, view, this.#tryAgain)}
            <form
                @submit=${(event: Event) => {
                    event.preventDefault();
                    port.intents.go();
                }}
            >
                ${this.#field({
                    id: 'name-ro',
                    label: 'start.plan.cityName',
                    value: form.nameRo,
                    input: (value) => {
                        port.intents.setName(value);
                    },
                    problem: null,
                })}
                ${this.#field({
                    id: 'name-en',
                    label: 'start.plan.cityNameEn',
                    value: form.nameEn,
                    input: (value) => {
                        port.intents.setNameEn(value);
                    },
                    problem: null,
                })}
                ${this.#field({
                    id: 'city-id',
                    label: 'start.plan.cityId',
                    value: form.cityId,
                    input: (value) => {
                        port.intents.setCityId(value);
                    },
                    problem: port.problems().cityId,
                    help: this.#t('start.plan.cityIdHelp', { cityId: form.cityId === '' ? '…' : form.cityId }),
                })}
                ${this.#edges(view, port)}
                ${
                    port.censusBox === undefined
                        ? nothing
                        : html`<hcm-imagery-census .box=${port.censusBox()} .locale=${view.locale}></hcm-imagery-census>`
                }
                ${this.#projectKind(view, port)}
                <button type="submit" class="filled" ?disabled=${!port.problems().ready}>
                    ${this.#t(form.create ? 'start.plan.go' : 'start.plan.goExisting')}
                </button>
            </form>`;
    }
}

export function defineHcmStartPage(registry: CustomElementRegistry = customElements): void {
    defineHcmStartLanguage(registry);
    defineHcmImageryCensus(registry);
    defineOnce(registry, HCM_START_PAGE_TAG, HcmStartPage);
}
