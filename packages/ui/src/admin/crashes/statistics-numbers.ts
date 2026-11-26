/**
 * The Statistics view's numbers (§203; `docs/ADMIN_GUIDE.en.md` → *Where people get stuck*): **Show the numbers here**
 * with Google's note about the read-only Analytics permission, the period (7, 28 or 90 days), then the overview, the
 * visitors and visits per app and role with a line per day, and each wizard's steps (people, who left before the step,
 * the average time, the most frequent errors). Every failure says what happened and the fix, with a link to it.
 */
import type { UiLocale } from '@hcm/shared';
import type { WizardId } from '@hcm/shared/funnels';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type {
    CrashesIntentsPort,
    StatisticsDaysPort,
    StatisticsNumbersPort,
    StatisticsPendingPort,
    StatisticsProblemPort,
    StatisticsViewState,
    SurfaceNumbersPort,
} from './crashes-port.js';
import { barCard, pageName, screenName, statCards } from './statistics-bars.js';
import { dailyLine, deviceName, eventName, formatCount, surfaceName } from './statistics-format.js';
import { funnelsSection } from './statistics-funnels.js';

/** Google Analytics' home: where an account's access to the property is managed. */
const GA_HOME = 'https://analytics.google.com/analytics/web/';
const DAYS: readonly StatisticsDaysPort[] = [7, 28, 90];

export interface NumbersContext {
    readonly locale: UiLocale;
    readonly projectId: string;
    readonly authDomain: string;
    readonly state: StatisticsViewState;
    readonly intents: CrashesIntentsPort | null;
    /** A wizard's steps in order (the view's table); a step not listed follows by its people. */
    readonly order: (wizard: WizardId) => readonly string[];
    readonly stepName: (step: string) => string;
    readonly wizardName: (wizard: WizardId) => string;
}

/** The Data API's page in the Google Cloud console, where it is turned on. */
function dataApiUrl(projectId: string): string {
    return `https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=${encodeURIComponent(projectId)}`;
}

interface FixLink {
    readonly href: string;
    readonly key:
        'adminContent.statistics.problem.openSetup' | 'adminContent.statistics.problem.openConsole' | 'adminContent.statistics.open';
    readonly external: boolean;
}

const SETUP_FIX: FixLink = { href: '#/setup/analytics', key: 'adminContent.statistics.problem.openSetup', external: false };

/** The links that fix each problem; a problem without one is fixed by the button itself. */
const FIXES: Readonly<Record<StatisticsProblemPort, (projectId: string) => readonly FixLink[]>> = {
    apiDisabled: (projectId) => [
        { ...SETUP_FIX, href: '#/setup' },
        { href: dataApiUrl(projectId), key: 'adminContent.statistics.problem.openConsole', external: true },
    ],
    noProperty: () => [SETUP_FIX],
    refused: () => [{ href: GA_HOME, key: 'adminContent.statistics.open', external: true }],
    notSetUp: () => [SETUP_FIX],
    noAccess: () => [{ href: GA_HOME, key: 'adminContent.statistics.open', external: true }],
    consent: () => [],
    popupBlocked: () => [],
    wrongAccount: () => [],
    unavailable: () => [],
    blocked: () => [],
    server: () => [],
};

function fixLink(locale: UiLocale, link: FixLink): TemplateResult {
    const text = contentText(locale, link.key);
    return link.external
        ? html`<p>
              <a class="external" href=${link.href} target="_blank" rel="noopener noreferrer"
                  >${text}<hcm-icon name="open_in_new"></hcm-icon
              ></a>
          </p>`
        : html`<p><a href=${link.href}>${text}</a></p>`;
}

/** What happened and what to do, in words (the server's own refusal is its message alone). */
function problemWords(locale: UiLocale, state: StatisticsViewState, problem: StatisticsProblemPort): readonly string[] {
    if (problem === 'server') {
        return [noticeOf(locale, state.notice)];
    }
    const key = problem as 'consent';
    return [
        contentText(locale, `adminContent.statistics.problem.${key}`),
        contentText(locale, `adminContent.statistics.problem.${key}Fix`),
    ];
}

function problemTemplate(context: NumbersContext): TemplateResult {
    const { locale, state } = context;
    const problem = state.problem ?? 'unavailable';
    const [what, fix] = problemWords(locale, state, problem);
    return html`<p class="alert" role="alert" data-statistics-problem=${problem}>
            <hcm-icon name="error"></hcm-icon><span>${what}${fix === undefined ? '' : ` ${fix}`}</span>
        </p>
        ${FIXES[problem](context.projectId).map((link) => fixLink(locale, link))}`;
}

/** Google's note about the read-only permission, until the numbers are there. */
function consentNote(context: NumbersContext): TemplateResult {
    const { locale } = context;
    return html`<div class="consent">
        <hcm-consent-note
            .locale=${locale}
            scope="analyticsRead"
            .projectId=${context.projectId}
            .domain=${context.authDomain}
        ></hcm-consent-note>
        <p class="note">${contentText(locale, 'adminContent.statistics.numbers.remove')}</p>
    </div>`;
}

/** The period (a segmented button) and the one action beside it: Show the numbers here, then Refresh. */
function controls(context: NumbersContext): TemplateResult {
    const { locale, state, intents } = context;
    const choose = (event: CustomEvent<{ readonly value: string }>): void => {
        intents?.setStatisticsDays(Number(event.detail.value) as StatisticsDaysPort);
    };
    const options = DAYS.map((days) => ({
        value: String(days),
        label: contentText(locale, `adminContent.statistics.numbers.days.${String(days) as '7'}`),
    }));
    const ready = state.status === 'ready';
    const show = (): void => {
        if (ready) {
            intents?.refreshStatistics();
        } else {
            intents?.showNumbers();
        }
    };
    return html`<div class="toolbar">
            <hcm-segmented-button
                .label=${contentText(locale, 'adminContent.statistics.numbers.period')}
                .options=${options}
                .value=${String(state.days)}
                @hcm-change=${choose}
            ></hcm-segmented-button>
            <hcm-button
                variant=${ready ? 'tonal' : 'filled'}
                icon=${ready ? 'refresh' : 'visibility'}
                ?disabled=${state.status === 'loading'}
                @click=${show}
                >${contentText(locale, ready ? 'adminContent.statistics.numbers.refresh' : 'adminContent.statistics.numbers.show')}</hcm-button
            >
        </div>
        ${ready ? EMPTY : consentNote(context)}`;
}

function appRow(locale: UiLocale, surface: SurfaceNumbersPort): TemplateResult {
    const name = surfaceName(locale, surface.surface);
    const max = formatCount(locale, Math.max(0, ...surface.daily.map((day) => day.visitors)));
    return html`<tr>
        <th scope="row">${name}</th>
        <td class="num">${formatCount(locale, surface.visitors)}</td>
        <td class="num">${formatCount(locale, surface.sessions)}</td>
        <td>${dailyLine(contentText(locale, 'adminContent.statistics.numbers.dailyLabel', { app: name, max }), surface.daily)}</td>
    </tr>`;
}

function appsCard(locale: UiLocale, numbers: StatisticsNumbersPort): TemplateResult {
    const title = contentText(locale, 'adminContent.statistics.numbers.apps');
    return html`<section class="card">
        <h4>${title}</h4>
        <div class="table-wrap" tabindex="0" role="region" aria-label=${title}>
            <table>
                <thead>
                    <tr>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.app')}</th>
                        <th scope="col" class="num">${contentText(locale, 'adminContent.statistics.numbers.visitors')}</th>
                        <th scope="col" class="num">${contentText(locale, 'adminContent.statistics.numbers.sessions')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.daily')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${numbers.surfaces.map((surface) => appRow(locale, surface))}
                    <tr data-surface="start">
                        <th scope="row">${contentText(locale, 'adminContent.statistics.numbers.surface.start')}</th>
                        <td colspan="3" class="note">${contentText(locale, 'adminContent.statistics.numbers.notMeasured')}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>`;
}

/** The key numbers: visitors, visits, visits per visitor and the map's key actions in all. */
function overview(locale: UiLocale, numbers: StatisticsNumbersPort): TemplateResult {
    const text = (key: 'visitors' | 'sessions' | 'perVisitor' | 'keyActions'): string =>
        contentText(locale, `adminContent.statistics.numbers.${key}`);
    const perVisitor = numbers.visitors === 0 ? 0 : numbers.sessions / numbers.visitors;
    const actions = numbers.events.reduce((sum, item) => sum + item.count, 0);
    return statCards(contentText(locale, 'adminContent.statistics.numbers.overview'), [
        { label: text('visitors'), value: formatCount(locale, numbers.visitors), hook: 'visitors' },
        { label: text('sessions'), value: formatCount(locale, numbers.sessions) },
        { label: text('perVisitor'), value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(perVisitor) },
        { label: text('keyActions'), value: formatCount(locale, actions) },
    ]);
}

/**
 * Why the apps, the admin screens and the wizards' steps are incomplete, with the fix: Setup's step g for a name GA4 does
 * not know, else when to look again.
 */
function pendingTemplate(locale: UiLocale, pending: StatisticsPendingPort | null): TemplateResult {
    if (pending === null) {
        return EMPTY;
    }
    const key = pending.reason;
    return html`<p class="info" role="status" data-statistics-pending=${key}>
            <hcm-icon name="schedule"></hcm-icon
            ><span
                >${contentText(locale, `adminContent.statistics.pending.${key}`)}
                ${contentText(locale, `adminContent.statistics.pending.${key}Fix`)}</span
            >
        </p>
        ${key === 'notRegistered' ? fixLink(locale, SETUP_FIX) : EMPTY}`;
}

function numbersTemplate(context: NumbersContext, numbers: StatisticsNumbersPort): TemplateResult {
    const { locale } = context;
    const title = (key: 'pages' | 'screens' | 'events' | 'devices' | 'countries'): string =>
        contentText(locale, `adminContent.statistics.numbers.${key}`);
    const identity = { name: (value: string): string => value };
    const period = contentText(locale, `adminContent.statistics.numbers.days.${String(context.state.days) as '7'}`);
    const funnels = { locale, period, order: context.order, stepName: context.stepName, wizardName: context.wizardName };
    return html`${pendingTemplate(locale, numbers.pending)} ${overview(locale, numbers)} ${appsCard(locale, numbers)}
        <div class="grid">
            ${barCard(locale, title('pages'), numbers.pages, { name: (value) => pageName(locale, value), raw: true })}
            ${barCard(locale, title('screens'), numbers.screens, { name: (value) => screenName(locale, value) })}
            ${barCard(locale, title('events'), numbers.events, { name: (value) => eventName(locale, value) })}
            ${barCard(locale, title('devices'), numbers.devices, { name: (value) => deviceName(locale, value) })}
            ${barCard(locale, title('countries'), numbers.countries, identity)}
        </div>
        ${funnelsSection(funnels, numbers)}`;
}

/** The numbers' placeholder while Google answers: the cards' shapes, and the words for a screen reader. */
function skeleton(locale: UiLocale): TemplateResult {
    const text = contentText(locale, 'adminContent.common.loading');
    const blocks = (count: number, kind: string): TemplateResult[] =>
        Array.from({ length: count }, () => html`<span class="skeleton ${kind}"></span>`);
    return html`<div class="skeletons" role="status" data-statistics-loading>
        <span class="visually-hidden">${text}</span>
        <div class="stats" aria-hidden="true">${blocks(4, 'stat')}</div>
        <div class="grid" aria-hidden="true">${blocks(3, 'block')}</div>
    </div>`;
}

function bodyOf(context: NumbersContext): TemplateResult {
    const { state } = context;
    if (state.status === 'loading') {
        return skeleton(context.locale);
    }
    if (state.status === 'error') {
        return problemTemplate(context);
    }
    return state.status === 'ready' && state.numbers !== null ? numbersTemplate(context, state.numbers) : EMPTY;
}

/** The numbers' section: its title, what it reads, the controls and the state's body. */
export function numbersSection(context: NumbersContext): TemplateResult {
    const { locale } = context;
    return html`<section class="numbers" data-statistics-numbers>
        <div class="section-head">
            <h3>${contentText(locale, 'adminContent.statistics.numbers.title')}</h3>
            <p class="note">${contentText(locale, 'adminContent.statistics.numbers.intro')}</p>
        </div>
        ${controls(context)} ${bodyOf(context)}
    </section>`;
}
