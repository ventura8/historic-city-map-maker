/**
 * The start page's run and what follows it (`docs/research/M14-start-your-map.md` §4, §7): the steps with one polite line for
 * a reader, a failure and its action, the console click with the admin's address, which is shown whatever could be read, and
 * the last screen.
 */
import type { StartKey } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { StartText } from './start-intro.js';

const STEPS = ['project', 'firebase', 'webApp', 'site', 'files', 'release'] as const;

type StepId = (typeof STEPS)[number];

export interface RunFailure {
    readonly key: StartKey;
    readonly params?: Readonly<Record<string, string>>;
    readonly link?: { readonly key: StartKey; readonly url: string };
    readonly action: 'again' | 'consent' | 'form';
}

export interface RunView {
    readonly steps: Readonly<Record<StepId, 'waiting' | 'working' | 'done' | 'failed'>>;
    readonly files: { readonly done: number; readonly total: number };
    readonly failure: RunFailure | null;
    readonly plan: { readonly projectId: string; readonly city: { readonly name: { readonly ro: string } } } | null;
    readonly providerWaiting: boolean;
    readonly providerUnreadable: boolean;
}

function stepLabel(t: StartText, view: RunView, step: StepId): string {
    return step === 'files'
        ? t('start.step.files', { done: String(view.files.done), total: String(view.files.total) })
        : t(`start.step.${step}`);
}

/** What a reader hears: the step under way, once per step, not each file of the count. */
function progress(t: StartText, view: RunView): string {
    const step = STEPS.find((id) => view.steps[id] === 'working');
    if (step === undefined) {
        return '';
    }
    return t('start.work.now', { step: t(step === 'files' ? 'start.step.filesShort' : `start.step.${step}`) });
}

function external(t: StartText, url: string, key: StartKey): TemplateResult {
    return html`<p><a href=${url} target="_blank" rel="noopener noreferrer">${t(key)}</a></p>`;
}

function failureAction(t: StartText, failure: RunFailure, tryAgain: () => void): TemplateResult {
    if (failure.action === 'form') {
        return html``;
    }
    return html`<button type="button" class="filled" @click=${tryAgain}>
        ${t(failure.action === 'consent' ? 'start.continue' : 'start.tryAgain')}
    </button>`;
}

export function failurePanel(t: StartText, view: RunView, tryAgain: () => void): TemplateResult {
    const { failure } = view;
    if (failure === null) {
        return html``;
    }
    return html`<section class="panel" role="alert" data-failure=${failure.key}>
        <p>${t(failure.key, failure.params)}</p>
        ${failure.link === undefined ? nothing : external(t, failure.link.url, failure.link.key)} ${failureAction(t, failure, tryAgain)}
    </section>`;
}

export function workScreen(t: StartText, view: RunView, tryAgain: () => void): TemplateResult {
    return html`<h1 tabindex="-1">${t('start.work.title')}</h1>
        <p>${t('start.work.body')}</p>
        <p class="for-readers" role="status" data-progress>${progress(t, view)}</p>
        <ol class="steps">
            ${STEPS.map(
                (step) =>
                    html`<li data-step=${step} data-state=${view.steps[step]}>
                        <span>${stepLabel(t, view, step)}</span>
                        <span class="chip">${t(`start.step.state.${view.steps[step]}`)}</span>
                    </li>`,
            )}
        </ol>
        ${failurePanel(t, view, tryAgain)}`;
}

const adminAddress = (view: RunView): string => `https://${view.plan?.projectId ?? ''}.web.app/admin/`;

function providerAnswer(t: StartText, view: RunView): TemplateResult {
    if (view.providerUnreadable) {
        return html`<p role="status" class="note" data-provider-unreadable>${t('start.provider.unreadable')}</p>`;
    }
    return view.providerWaiting ? html`<p role="status" class="note" data-provider-waiting>${t('start.provider.waiting')}</p>` : html``;
}

export function providerScreen(t: StartText, view: RunView, check: () => void): TemplateResult {
    const projectId = view.plan?.projectId ?? '';
    const address = adminAddress(view);
    return html`<h1 tabindex="-1">${t('start.provider.title')}</h1>
        <p>${t('start.provider.body')}</p>
        <p>${t('start.provider.how')}</p>
        ${external(t, `https://console.firebase.google.com/project/${projectId}/authentication/providers`, 'start.provider.link')}
        ${providerAnswer(t, view)}
        <button type="button" class="filled" @click=${check}>${t('start.provider.check')}</button>
        <p>${t('start.provider.address', { address })}</p>
        <p><a href=${address} data-open-admin>${t('start.provider.open')}</a></p>`;
}

export function doneScreen(t: StartText, view: RunView): TemplateResult {
    const address = adminAddress(view);
    return html`<h1 tabindex="-1">${t('start.done.title')}</h1>
        <p>${t('start.done.body', { address })}</p>
        <p>${t('start.done.next', { city: view.plan?.city.name.ro ?? '' })}</p>
        <p><a class="filled" href=${address} data-open-admin>${t('start.done.open')}</a></p>`;
}
