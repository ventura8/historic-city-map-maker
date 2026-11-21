/**
 * The Statistics view's errors (§203): Cloud Error Reporting's groups for the view's period (`telemetry.listGroups`, read by
 * the server's own account; Error Reporting keeps 30 days), each a card (the owner's "prettify" of 2026-11-13): the
 * cause's first line as its title, how often as a chip, when it was last and first seen with the release, the whole
 * (redacted, stackless) text under **Show the full text** when the title is cut, and its page in the Google Cloud
 * console. A disabled API, a refusal or an empty period says so, with the way on.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { formatWhen, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { CrashesIntentsPort, CrashesViewState, CrashGroupPort } from './crashes-port.js';
import { formatCount } from './statistics-format.js';

/** The groups shown here: the most recent ones (the crash list has them all). */
const SHOWN = 10;
/** A cause's title: its first line, cut at about two lines of text. */
const TITLE_CHARS = 120;

/** The first line of a cause, cut with an ellipsis when longer than a title. */
export function causeTitle(message: string): string {
    const line = message.split('\n', 1).join('').trim();
    return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line;
}

/** The whole cause under **Show the full text**, when the title does not say all of it. */
function fullText(locale: UiLocale, group: CrashGroupPort, title: string): TemplateResult {
    if (title === group.message.trim()) {
        return EMPTY;
    }
    return html`<details class="more">
        <summary>${contentText(locale, 'adminContent.statistics.crashes.full')}</summary>
        <pre class="cause">${group.message}</pre>
    </details>`;
}

function groupItem(locale: UiLocale, group: CrashGroupPort, url: (groupId: string) => string): TemplateResult {
    const title = causeTitle(group.message);
    const count = formatCount(locale, group.count);
    const release = group.version ?? '—';
    return html`<li class="card error-item">
        <div class="error-head">
            <span class="error-title">${title}</span>
            <span class="tag" data-tone="error">${contentText(locale, 'adminContent.statistics.crashes.times', { count })}</span>
        </div>
        <p class="note">
            ${contentText(locale, 'adminContent.statistics.crashes.seen', {
                last: formatWhen(locale, group.lastSeen),
                first: formatWhen(locale, group.firstSeen),
                release,
            })}
        </p>
        ${fullText(locale, group, title)}
        <a class="external" href=${url(group.groupId)} target="_blank" rel="noopener noreferrer"
            >${contentText(locale, 'adminContent.statistics.crashes.open')}<hcm-icon name="open_in_new"></hcm-icon
        ></a>
    </li>`;
}

function groupsList(locale: UiLocale, groups: readonly CrashGroupPort[], url: (groupId: string) => string): TemplateResult {
    const label = contentText(locale, 'adminContent.statistics.crashes.tableLabel');
    return html`<ul class="errors" aria-label=${label}>
        ${groups.slice(0, SHOWN).map((group) => groupItem(locale, group, url))}
    </ul>`;
}

function failure(locale: UiLocale, view: CrashesViewState, intents: CrashesIntentsPort | null): TemplateResult {
    const retry = (): void => {
        intents?.retry();
    };
    const fix = view.apiDisabled
        ? html`<p>${contentText(locale, 'adminContent.crashes.apiDisabled')}</p>
              <p><a href="#/setup/analytics">${contentText(locale, 'adminContent.crashes.openSetup')}</a></p>`
        : html``;
    return html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.failure)}</span></p>
        ${fix}
        <div class="actions">
            <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
        </div>`;
}

function body(
    locale: UiLocale,
    view: CrashesViewState,
    intents: CrashesIntentsPort | null,
    url: (groupId: string) => string,
): TemplateResult {
    if (view.status === 'error') {
        return failure(locale, view, intents);
    }
    if (view.groups.length === 0) {
        return view.status === 'loading'
            ? loadingTemplate(locale)
            : html`<p class="note">${contentText(locale, 'adminContent.crashes.empty')}</p>`;
    }
    return groupsList(locale, view.groups, url);
}

/** The errors' section; `url` is a group's page in the console (`errorGroupUrl`). */
export function crashesSection(
    locale: UiLocale,
    view: CrashesViewState,
    intents: CrashesIntentsPort | null,
    url: (groupId: string) => string,
): TemplateResult {
    const longest =
        view.statistics.days === 90 ? html`<p class="note">${contentText(locale, 'adminContent.statistics.crashes.longest')}</p>` : html``;
    return html`<section class="crash-groups" data-statistics-crashes>
        <div class="section-head"><h3>${contentText(locale, 'adminContent.statistics.crashes.title')}</h3></div>
        ${longest} ${body(locale, view, intents, url)}
    </section>`;
}
