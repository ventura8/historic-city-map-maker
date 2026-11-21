/**
 * What the Platform and Sources cards share (M28, `docs/research/M28-sources.md` §5): the folded details of a source (what it
 * gives, pros, cons, costs, what to do, licence, recommended for, the provider's pages), the account a source needs and its
 * state as Setup's steps know it, and the styles. Text only; every link opens in a new tab.
 */
import type { AdminSourcesKey } from '@hcm/shared/admin-sources';
import type { SourceAccount, SourceLink } from '@hcm/shared/sources';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { SetupViewState } from './setup-port.js';

export type SourcesText = (key: AdminSourcesKey, params?: Readonly<Record<string, string>>) => string;

/** How many numbered texts of each list a card has (`<prefix>.pro.1` …). */
export interface DetailCounts {
    readonly pros: number;
    readonly cons: number;
    readonly steps: number;
    /** It has an `example` text (the collections drawn from by hand have none). */
    readonly example: boolean;
}

/** An account as Setup knows it: missing, saved and waiting for the provider's approval, or working. */
export type AccountStatus = 'needed' | 'waiting' | 'signedIn';

/** `key` as a catalogue key (the catalogue test proves every one the cards build exists). */
export function sourcesKey(key: string): AdminSourcesKey {
    return key as AdminSourcesKey;
}

function numbered(t: SourcesText, prefix: string, part: string, count: number): readonly string[] {
    return Array.from({ length: count }, (_, index) => t(sourcesKey(`${prefix}.${part}.${String(index + 1)}`)));
}

function list(t: SourcesText, heading: AdminSourcesKey, items: readonly string[], ordered = false): TemplateResult {
    if (items.length === 0) {
        return html``;
    }
    const entries = items.map((item) => html`<li>${item}</li>`);
    return html`<h4 class="title-small">${t(heading)}</h4>
        ${
            ordered
                ? html`<ol>
                      ${entries}
                  </ol>`
                : html`<ul>
                      ${entries}
                  </ul>`
        }`;
}

function paragraph(t: SourcesText, heading: AdminSourcesKey, text: string): TemplateResult {
    return html`<h4 class="title-small">${t(heading)}</h4>
        <p>${text}</p>`;
}

const LINK_KEYS: Readonly<Record<SourceLink['kind'], AdminSourcesKey>> = {
    pricing: 'adminSources.link.pricing',
    licence: 'adminSources.link.licence',
    policy: 'adminSources.link.policy',
    site: 'adminSources.link.site',
};

/** The provider's pages, each named by what it is and where it goes. */
export function providerLinks(t: SourcesText, links: readonly SourceLink[]): TemplateResult {
    if (links.length === 0) {
        return html``;
    }
    return html`<h4 class="title-small">${t('adminSources.section.links')}</h4>
        <ul class="links">
            ${links.map(
                (link) =>
                    html`<li>
                        <a href=${link.url} target="_blank" rel="noopener noreferrer"
                            >${t(LINK_KEYS[link.kind])}: ${new URL(link.url).hostname}</a
                        >
                    </li>`,
            )}
        </ul>`;
}

/** The folded details of source `id` (`adminSources.<id>.*`): closed by default, so the list stays short. */
export function sourceDetails(t: SourcesText, id: string, counts: DetailCounts, extra: TemplateResult = html``): TemplateResult {
    const prefix = `adminSources.${id}`;
    const text = (part: string): string => t(sourcesKey(`${prefix}.${part}`));
    return html`<details class="details">
        <summary>${t('adminSources.details')}</summary>
        <div class="detail-body">
            ${paragraph(t, 'adminSources.section.gives', text('gives'))}
            ${counts.example ? paragraph(t, 'adminSources.section.example', text('example')) : nothing}
            ${list(t, 'adminSources.section.pros', numbered(t, prefix, 'pro', counts.pros))}
            ${list(t, 'adminSources.section.cons', numbered(t, prefix, 'con', counts.cons))}
            ${paragraph(t, 'adminSources.section.cost', text('cost'))} ${paragraph(t, 'adminSources.section.effort', text('effort'))}
            ${list(t, 'adminSources.section.effort', numbered(t, prefix, 'step', counts.steps), true)} ${extra}
            ${paragraph(t, 'adminSources.section.licence', text('licence'))}
            ${paragraph(t, 'adminSources.section.recommended', text('recommended'))}
        </div>
    </details>`;
}

/** USGS: working, saved and waiting for USGS's approval, or still to do; Google: the billing account linked. */
export function accountStatus(view: SetupViewState, account: SourceAccount): AccountStatus {
    if (account === 'google') {
        return view.steps.billing.state === 'ok' ? 'signedIn' : 'needed';
    }
    if (view.steps.usgs.state === 'ok') {
        return 'signedIn';
    }
    return view.usgs.pendingSince === null ? 'needed' : 'waiting';
}

const STATUS_KEYS: Readonly<Record<AccountStatus, AdminSourcesKey>> = {
    needed: 'adminSources.account.needed',
    waiting: 'adminSources.account.waiting',
    signedIn: 'adminSources.account.signedIn',
};

const STATUS_ICONS: Readonly<Record<AccountStatus, string>> = { needed: 'person_add', waiting: 'schedule', signedIn: 'check_circle' };

/** The account's chip: its icon and words, so the state never rests on colour alone. */
export function accountChip(t: SourcesText, status: AccountStatus): TemplateResult {
    return html`<span class="account label-medium" data-account=${status}
        ><hcm-icon name=${STATUS_ICONS[status]} aria-hidden="true"></hcm-icon>${t(STATUS_KEYS[status])}</span
    >`;
}

/** The link of a card's next action, opened in a new tab (a provider's page) or in place (a Setup step). */
export function actionLink(label: string, href: string, external: boolean): TemplateResult {
    return external
        ? html`<a class="action" href=${href} target="_blank" rel="noopener noreferrer">${label}</a>`
        : html`<a class="action" href=${href}>${label}</a>`;
}

export const sourcesStyles = css`
    .group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .source {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface-container-low);
    }

    .source-head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        align-items: center;
        justify-content: space-between;
    }

    .source-name {
        flex: 1 1 24ch;
        min-inline-size: 0;
    }

    h3,
    h4 {
        margin: 0;
    }

    .account {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        padding: 4px 12px;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
    }

    .account[data-account='signedIn'] {
        background: var(--md-sys-color-primary-container);
        color: var(--md-sys-color-on-primary-container);
    }

    .action,
    .links a,
    summary {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
        cursor: pointer;
    }

    .detail-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-block-end: 8px;
    }

    ul,
    ol {
        margin: 0;
        padding-inline-start: 20px;
    }

    .links {
        padding: 0;
        list-style: none;
    }

    .summary {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
    }

    .summary .note {
        color: inherit;
    }

    .tag {
        color: var(--md-sys-color-on-surface-variant);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
    }

    .chips .tag {
        padding: 4px 12px;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-surface-container-high);
    }

    h5 {
        margin: 0;
    }

    .letter {
        margin: 0;
        padding: 12px 16px;
        border-inline-start: 4px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface-container);
    }

    .letter-body {
        white-space: pre-line;
        overflow-wrap: anywhere;
    }

    button.action {
        border: 0;
        background: none;
        font: inherit;
        padding: 0;
    }

    @media (forced-colors: active) {
        .source,
        .summary,
        .account {
            border: 1px solid CanvasText;
        }
    }
`;
