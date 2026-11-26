/**
 * What the last self-test found, check by check (`setup.selfTest`, Check again in normal mode; `docs/research/M2-interfaces.md`
 * §3.3; S-A03-BAD-SELFTEST-FAILURE, `DECISIONS-for-review.md` §42b): every check of `SELF_TEST_CHECKS` with its state, a
 * failing check's reason in the admin's language, and a link to the step that fixes it (the cloud checks to Prepare the
 * project, Mapbox and USGS to their cards, Error Reporting to the analytics card). Text only. M6 (setup-ux, findings 20
 * and 24 of 2026-10-25): an optional feature's check (the translation drafts' Vertex AI) is listed apart, under Optional
 * features: off, with its reason and a neutral icon, never the alarm of a required check, and it never holds Setup back.
 */
import type { AdminSetupKey, UiLocale, SelfTestCheck, ServiceState } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';

import type { SetupStepId, SetupViewState } from './setup-port.js';
import { setupLabel, setupText } from './setup-text.js';

/** The step whose card fixes what a check found. */
const STEP_OF: Readonly<Record<SelfTestCheck, SetupStepId>> = {
    firestore: 'provision',
    secrets: 'provision',
    'private-bucket': 'provision',
    'public-bucket': 'provision',
    'task-queue': 'provision',
    /** M6 (finding 17): Prepare the project grants `roles/run.invoker`, which the events need (`docs/research/M6-interfaces.md` §1.6). */
    events: 'provision',
    mapbox: 'mapbox',
    usgs: 'usgs',
    'firebase-management': 'provision',
    'error-reporting': 'analytics',
    /** M4: Vertex AI is enabled, and its role granted, by Prepare the project (`docs/research/M4-interfaces.md` §4.4). */
    ai: 'provision',
};

const ICONS: Readonly<Record<ServiceState, string>> = {
    missing: 'info',
    pending: 'schedule',
    ok: 'check_circle',
    invalid: 'error',
    unavailable: 'warning',
};

type CheckView = SetupViewState['selfTest']['checks'][number];

/** The checks of optional features, each with what the list says while it is not ok. */
const OPTIONAL_CHECKS: Partial<Readonly<Record<SelfTestCheck, AdminSetupKey>>> = {
    ai: 'adminSetup.selfTest.off.ai',
};

const isOptional = (check: CheckView): boolean => OPTIONAL_CHECKS[check.id] !== undefined;

function fix(locale: UiLocale, check: CheckView): TemplateResult {
    if (check.state === 'ok') {
        return EMPTY;
    }
    const step = STEP_OF[check.id];
    const name = setupLabel(locale, `adminSetup.step.${step}`);
    return html`<a class="fix" href=${['#', 'setup', step].join('/')}>${setupLabel(locale, 'adminSetup.selfTest.fix', { step: name })}</a>`;
}

function checkRow(locale: UiLocale, check: CheckView): TemplateResult {
    return html`<li class="check" data-check=${check.id} data-state=${check.state}>
        <hcm-icon name=${ICONS[check.state]}></hcm-icon>
        <span>${setupLabel(locale, `adminSetup.selfTest.check.${check.id}`)}</span>
        <span class="state">${setupLabel(locale, `adminSetup.state.${check.state}`)}</span>
        ${check.detail === null ? nothing : html`<span class="reason">${setupText(locale, check.detail)}</span>`} ${fix(locale, check)}
    </li>`;
}

/** §67g: the model a passing AI check found offered, on a line of its own. */
function modelLine(locale: UiLocale, check: CheckView): TemplateResult | typeof nothing {
    return check.model === undefined
        ? nothing
        : html`<span class="reason" data-model>${setupLabel(locale, 'adminSetup.selfTest.model', { model: check.model })}</span>`;
}

/** An optional feature's check: off (a neutral icon) with its reason while not ok, never an alarm; on, the model in use. */
function optionalRow(locale: UiLocale, check: CheckView): TemplateResult {
    const off = check.state === 'ok' ? undefined : OPTIONAL_CHECKS[check.id];
    return html`<li class="check" data-check=${check.id} data-state=${check.state} data-optional>
        <hcm-icon name=${off === undefined ? ICONS.ok : 'info'}></hcm-icon>
        <span>${setupLabel(locale, off ?? `adminSetup.selfTest.check.${check.id}`)}</span>
        ${modelLine(locale, check)}
        ${check.detail === null ? nothing : html`<span class="reason">${setupText(locale, check.detail)}</span>`} ${fix(locale, check)}
    </li>`;
}

function optionalList(locale: UiLocale, checks: readonly CheckView[]): TemplateResult {
    if (checks.length === 0) {
        return EMPTY;
    }
    return html`<h3 id="self-test-optional" class="label-large">${setupLabel(locale, 'adminSetup.selfTest.optionalTitle')}</h3>
        <p class="note">${setupLabel(locale, 'adminSetup.selfTest.optionalIntro')}</p>
        <ul class="checks optional" aria-labelledby="self-test-optional">
            ${checks.map((check) => optionalRow(locale, check))}
        </ul>`;
}

/** The checks of the last self-test, the optional features' apart; nothing before Check again ran one. */
export function selfTestList(locale: UiLocale, view: SetupViewState): TemplateResult {
    const { checks } = view.selfTest;
    if (checks.length === 0) {
        return EMPTY;
    }
    return html`<section class="self-test" aria-labelledby="self-test-title">
        <h2 id="self-test-title" class="title-medium">${setupLabel(locale, 'adminSetup.selfTest.title')}</h2>
        <p class="note">${setupLabel(locale, 'adminSetup.selfTest.intro')}</p>
        <ul class="checks">
            ${checks.filter((check) => !isOptional(check)).map((check) => checkRow(locale, check))}
        </ul>
        ${optionalList(
            locale,
            checks.filter((check) => isOptional(check)),
        )}
    </section>`;
}

/** The list as the provisioning doctor's: an icon, the check, its state, its reason and the fix, each on its own line. */
export const selfTestStyles = css`
    /* The list's own container: its links' focus ring is the container's "on" colour (secondary reads 2.16:1 on it). */
    .self-test {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);

        --hcm-focus-ring-color: var(--md-sys-color-on-surface, CanvasText);
    }

    .self-test h2,
    .self-test h3 {
        margin: 0;
    }

    .checks {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .check {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 2px 12px;
        align-items: center;
        min-block-size: 40px;
    }

    .check .state,
    .check .reason,
    .check .fix {
        grid-column: 2;
    }

    .check .state,
    .check .reason {
        color: var(--md-sys-color-on-surface-variant);
    }

    .check .fix {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
    }

    .check[data-state='ok'] hcm-icon {
        color: var(--md-sys-color-primary);
    }

    .check[data-state='invalid'] hcm-icon,
    .check[data-state='unavailable'] hcm-icon {
        color: var(--md-sys-color-error);
    }
`;
