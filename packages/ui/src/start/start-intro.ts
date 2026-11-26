/**
 * The start page's first screens (`docs/research/M14-start-your-map.md`): what you get, the cost in honest words, the accounts,
 * and either Google's consent explained with its button, or, before the road is open, the terminal's command.
 */
import type { StartKey } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

export type StartText = (key: StartKey, params?: Readonly<Record<string, string>>) => string;

interface IntroView {
    readonly notice: StartKey | null;
    readonly command: string;
}

function list(t: StartText, title: StartKey, items: readonly StartKey[]): TemplateResult {
    return html`<section>
        <h2>${t(title)}</h2>
        <ul>
            ${items.map((item) => html`<li>${t(item)}</li>`)}
        </ul>
    </section>`;
}

function explanation(t: StartText): TemplateResult {
    return html`${list(t, 'start.get.title', ['start.get.map', 'start.get.admin', 'start.get.yours'])}
    ${list(t, 'start.cost.title', ['start.cost.start', 'start.cost.server', 'start.cost.serverFree', 'start.cost.budget', 'start.cost.mapbox'])}
    ${list(t, 'start.accounts.title', ['start.accounts.google', 'start.accounts.mapbox', 'start.accounts.usgs'])}`;
}

export function closedScreen(t: StartText, view: IntroView): TemplateResult {
    return html`<h1 tabindex="-1">${t('start.title')}</h1>
        <p class="lede">${t('start.lede')}</p>
        ${explanation(t)}
        <section class="panel" data-state="closed">
            <h2>${t('start.closed.title')}</h2>
            <p>${t('start.closed.body', { command: view.command })}</p>
        </section>`;
}

export function introScreen(t: StartText, view: IntroView, signIn: () => void): TemplateResult {
    return html`<h1 tabindex="-1">${t('start.title')}</h1>
        <p class="lede">${t('start.lede')}</p>
        ${view.notice === null ? nothing : html`<p role="alert" class="alert">${t(view.notice)}</p>`} ${explanation(t)}
        <section class="panel">
            <h2>${t('start.consent.title')}</h2>
            <p>${t('start.consent.body')}</p>
            <p>${t('start.consent.token')}</p>
            <p>${t('start.consent.warning')}</p>
            <p>${t('start.consent.warningNo')}</p>
            <button type="button" class="filled" @click=${signIn}>${t('start.signIn')}</button>
        </section>
        <section>
            <h2>${t('start.terminal.title')}</h2>
            <p>${t('start.terminal.body', { command: view.command })}</p>
        </section>
        <section>
            <h2>${t('start.privacy.title')}</h2>
            <p>${t('start.privacy.body')}</p>
            <p>${t('start.privacy.token')}</p>
        </section>`;
}
