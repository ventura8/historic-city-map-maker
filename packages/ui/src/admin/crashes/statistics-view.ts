/**
 * The Statistics view (`#/crashes/statistics`, the owner's request of 2026-11-13; `docs/ARCHITECTURE.md` → *Wizard
 * funnels*, `docs/ADMIN_GUIDE.en.md` → *Where people get stuck*): every wizard with its steps in order and their codes,
 * the way to its funnel in Google Analytics (a funnel exploration of `step_view`, the errors of `step_error`, the time
 * between steps), and a plain note when analytics is not set up. Since §203 the numbers show here too: **Show the numbers
 * here** asks Google for the owner's read-only Analytics permission and reads the GA4 Data API (`statistics-numbers.ts`),
 * and Error Reporting's groups follow the same period (`statistics-crashes.ts`).
 */
import type { UiLocale } from '@hcm/shared';
import { WIZARD_IDS, type WizardId } from '@hcm/shared/funnels';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { CrashesIntentsPort, CrashesViewState, StatisticsNumbersPort } from './crashes-port.js';
import type * as Live from './statistics-live.js';
import { loadingTemplate } from '../editing/states.js';

type LiveModule = typeof Live;

let live: LiveModule | null = null;
let loading: Promise<LiveModule> | null = null;

/** The live sections' chunk, fetched once (§203: a chunk of its own, so the crashes page stays within its budget). */
export function loadStatisticsLive(): Promise<LiveModule> {
    loading ??= import('./statistics-live.js').then((module) => {
        live = module;
        return module;
    });
    return loading;
}

/** The live sections' styles once their chunk is there (the page adopts them), else null. */
export function statisticsLiveSheet(): CSSStyleSheet | null {
    return live?.liveStyles.styleSheet ?? null;
}

/** Whether the live sections' chunk is there (the page asks for it once, then renders again). */
export function statisticsLiveReady(): boolean {
    return live !== null;
}

/** Google Analytics' home: the owner picks the project's property there (its id is not kept by the admin). */
export const GA_HOME_URL = 'https://analytics.google.com/analytics/web/';

/** Each wizard's steps in order (Setup's are its cards, listed by the page itself). */
const WIZARD_STEPS = {
    setup: [],
    new_city: ['names', 'area', 'create'],
    start: ['intro', 'plan', 'work', 'provider', 'done'],
    tiles: ['order', 'seams', 'preview', 'points'],
    georef: ['points', 'save', 'approve'],
    usgs_import: ['search', 'choose', 'import'],
    upload: ['choose', 'year', 'upload', 'check'],
    local_import: ['choose', 'upload', 'scan'],
    worker: ['connect', 'update'],
} as const satisfies Readonly<Record<WizardId, readonly string[]>>;

type StepId = (typeof WIZARD_STEPS)[WizardId][number];

const STEP_IDS: ReadonlySet<string> = new Set(Object.values(WIZARD_STEPS).flat());

const HOW = ['how1', 'how2', 'how3', 'how4', 'how5'] as const;

type CodesState = 'unknown' | 'ready' | 'notRegistered' | 'notReady' | 'noData';

/** Whether GA4 can show the codes, as the last read of the numbers found (unknown before one). */
function codesState(view: CrashesViewState | null): CodesState {
    const numbers = view?.statistics.numbers ?? null;
    return numbers === null ? 'unknown' : codesOf(numbers);
}

function codesOf(numbers: StatisticsNumbersPort): CodesState {
    return numbers.pending?.reason ?? 'ready';
}

function stepItem(locale: UiLocale, step: StepId): TemplateResult {
    const name = contentText(locale, `adminContent.statistics.step.${step}`);
    return html`<li>${name} <code>${step}</code></li>`;
}

function howItem(locale: UiLocale, key: (typeof HOW)[number]): TemplateResult {
    const text = contentText(locale, `adminContent.statistics.${key}`);
    return html`<li>${text}</li>`;
}

function stepsOf(locale: UiLocale, wizard: WizardId): TemplateResult {
    const steps: readonly StepId[] = WIZARD_STEPS[wizard];
    if (steps.length === 0) {
        return html`<p>${contentText(locale, 'adminContent.statistics.setupSteps')}</p>`;
    }
    return html`<ol aria-label=${contentText(locale, 'adminContent.statistics.stepsLabel')}>
        ${steps.map((step) => stepItem(locale, step))}
    </ol>`;
}

function wizardName(locale: UiLocale, wizard: WizardId): string {
    return contentText(locale, `adminContent.statistics.wizard.${wizard}`);
}

function wizardItem(locale: UiLocale, wizard: WizardId): TemplateResult {
    return html`<li class="card" data-wizard=${wizard}>
        <h4>${wizardName(locale, wizard)} <code>${wizard}</code></h4>
        ${stepsOf(locale, wizard)}
    </li>`;
}

/** The note and link when GA4 is not configured: nothing is measured until Setup's step g. */
function offNote(locale: UiLocale, analytics: boolean): TemplateResult {
    return analytics
        ? EMPTY
        : html`<p class="note" data-statistics-off>${contentText(locale, 'adminContent.statistics.off')}</p>
              <p><a href="#/setup/analytics">${contentText(locale, 'adminContent.statistics.openSetup')}</a></p>`;
}

/** What the view shows besides the language: the page's state and intents, the project for its links. */
export interface StatisticsContext {
    /** The admin's GA4 is configured (its web configuration has a measurement id). */
    readonly analytics: boolean;
    readonly projectId: string;
    readonly authDomain: string;
    readonly view: CrashesViewState | null;
    readonly intents: CrashesIntentsPort | null;
    /** An error group's page in the Google Cloud console. */
    readonly groupUrl: (groupId: string) => string;
}

/** §203: the numbers and the errors, once the page's store and the sections' chunk are there. */
function liveSections(locale: UiLocale, context: StatisticsContext): TemplateResult {
    const view = context.view;
    if (view === null) {
        return EMPTY;
    }
    if (live === null) {
        return loadingTemplate(locale);
    }
    return live.liveSections(locale, view, {
        ...{ projectId: context.projectId, authDomain: context.authDomain, intents: context.intents, groupUrl: context.groupUrl },
        order: (wizard) => WIZARD_STEPS[wizard],
        stepName: (step) => (STEP_IDS.has(step) ? contentText(locale, `adminContent.statistics.step.${step as StepId}`) : step),
        wizardName: (wizard) => wizardName(locale, wizard),
    });
}

/** How to explore more in Google Analytics: the funnel exploration's steps and every wizard's step codes, folded away. */
function helpSection(locale: UiLocale, view: CrashesViewState | null): TemplateResult {
    return html`<div class="card">
        <details class="help" data-statistics-help>
            <summary>${contentText(locale, 'adminContent.statistics.helpTitle')}</summary>
            <div class="help-body">
                <h3>${contentText(locale, 'adminContent.statistics.howTitle')}</h3>
                <ol>
                    ${HOW.map((key) => howItem(locale, key))}
                    <li data-statistics-codes=${codesState(view)}>
                        ${contentText(locale, `adminContent.statistics.codes.${codesState(view)}`)}
                    </li>
                </ol>
                <h3>${contentText(locale, 'adminContent.statistics.wizardsTitle')}</h3>
                <ul class="wizards">
                    ${WIZARD_IDS.map((wizard) => wizardItem(locale, wizard))}
                </ul>
            </div>
        </details>
    </div>`;
}

/** The whole view: the title, the numbers and the errors, then the help, folded. */
export function statisticsView(locale: UiLocale, context: StatisticsContext): TemplateResult {
    return html`<div class="pane statistics">
        <p><a href="#/crashes">${contentText(locale, 'adminContent.statistics.back')}</a></p>
        <div class="page-head">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.statistics.title')}</h2>
            <p>${contentText(locale, 'adminContent.statistics.intro')}</p>
            <p class="note">${contentText(locale, 'adminContent.statistics.intro2')}</p>
            <p>
                <a class="external" href=${GA_HOME_URL} target="_blank" rel="noopener noreferrer"
                    >${contentText(locale, 'adminContent.statistics.open')}<hcm-icon name="open_in_new"></hcm-icon
                ></a>
            </p>
        </div>
        ${offNote(locale, context.analytics)} ${liveSections(locale, context)} ${helpSection(locale, context.view)}
    </div>`;
}
