/**
 * The Sources card's body (step e2, M28: `docs/research/M28-sources.md` §5): the expected cost a month on top (the app's
 * platform as a fixed line, the chosen sources, a paid scan as a one-off), then one card per source in three groups (old
 * images from above; places, streets and photos; the AI), each with a switch (Sentinel-2: always on), its account's state and
 * next action, and its details folded; then the collections to draw from by hand and what is not usable, and why. **Save my
 * choice** saves the switches as the city's `sources`; on a save each switch reports a reason code to the Setup funnel
 * (`step_action` `source.<id>.<on_default|off_default|turned_on|turned_off>`).
 */
import {
    DEFAULT_SOURCES,
    GUIDED_CATALOGUE,
    NOT_USABLE_SOURCES,
    SOURCE_CATALOGUE,
    SOURCES_CHECKED_ON,
    needsUsgsAccount,
    sourceOn,
    sourcesEstimate,
    type GuidedFacts,
    type SourceChoices,
    type SourceFacts,
    type SourceGroup,
    type SourceToggle,
} from '@hcm/shared/sources';
import { translateAdminSources, type AdminSourcesKey } from '@hcm/shared/admin-sources';
import { signalFunnel } from '@hcm/shared/funnels';
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmSwitch } from '../../components/switch.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { formatDate, formatDay, formatMoney, formatUsd, intlLocale } from './setup-text.js';
import { countryFinder, type FinderContext } from './sources-finder.js';
import { translationOptions } from './sources-translations.js';
import { accountChip, accountStatus, actionLink, providerLinks, sourceDetails, sourcesKey, sourcesStyles } from './sources-parts.js';

const HCM_SETUP_SOURCES_TAG = 'hcm-setup-sources';

const GROUPS: readonly SourceGroup[] = ['imagery', 'places', 'ai'];

/** The reason code a saved switch reports: its state, and whether the owner changed it from the suggestion. */
export function choiceReason(id: SourceToggle, on: boolean): string {
    if (on === DEFAULT_SOURCES[id]) {
        return on ? 'on_default' : 'off_default';
    }
    return on ? 'turned_on' : 'turned_off';
}

/** The line above Save my choice: nothing saved yet, changed since the save, or saved. */
function saveStatus(sources: SetupViewState['sources'], changed: boolean): AdminSourcesKey {
    if (sources.saved === null) {
        return 'adminSources.notChosen';
    }
    return changed ? 'adminSources.unsaved' : 'adminSources.saved';
}

/** The choice saved leaves the USGS step out (neither its frames nor Landsat). */
function usgsLeftOut(sources: SetupViewState['sources']): boolean {
    return sources.saved !== null && !needsUsgsAccount(sources.saved);
}

/** Whether the switches differ from what the city holds (a choice never saved always does). */
function unsaved(sources: SetupViewState['sources']): boolean {
    const saved = sources.saved;
    return saved === null || Object.entries(sources.choices).some(([id, on]) => saved[id as SourceToggle] !== on);
}

export class HcmSetupSources extends SetupBody {
    static override readonly styles = [setupTextStyles, sourcesStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const { choices } = state.sources;
        return html`<div class="body">
            <p>${this.s('adminSources.intro')}</p>
            ${this.renderSummary(state, choices)} ${GROUPS.map((group) => this.renderGroup(state, group))}
            ${translationOptions(
                this.sTr(),
                (count) => new Intl.NumberFormat(intlLocale(this.locale)).format(count),
                (day) => this.day(day),
            )}
            ${countryFinder(this.finderContext(), state.sources.finder)} ${this.renderGuided()} ${this.renderNotUsable()}
            ${this.renderSave(state)}
        </div>`;
    }

    private s(key: AdminSourcesKey, params?: Readonly<Record<string, string>>): string {
        return translateAdminSources(this.locale, key, params);
    }

    /** A day (`2026-11-14`) or an instant (ISO), in the page's language. */
    private day(value: string): string {
        return value.length === 10 ? formatDay(this.locale, value) : formatDate(this.locale, value);
    }

    private finderContext(): FinderContext {
        const regions = new Intl.DisplayNames([intlLocale(this.locale)], { type: 'region' });
        return {
            t: this.sTr(),
            pick: (text) => (this.locale === 'ro' ? text.ro : text.en),
            day: (value) => this.day(value),
            countryName: (code) => regions.of(code) ?? code,
        };
    }

    private usd(amount: number): string {
        return formatUsd(this.locale, amount);
    }

    /** The month: the platform's fixed line, the sources, both together, a scan's one-off price, the estimate's date. */
    private renderSummary(state: SetupViewState, choices: SourceChoices): TemplateResult {
        const estimate = sourcesEstimate(choices);
        const range = (low: number, high: number): Readonly<Record<string, string>> => ({ low: this.usd(low), high: this.usd(high) });
        const sources =
            estimate.sources.high === 0
                ? this.s('adminSources.summary.sourcesFree')
                : this.s('adminSources.summary.sources', range(estimate.sources.low, estimate.sources.high));
        const amount = formatMoney(this.locale, state.billing.amount, state.billing.currency);
        return html`<section class="summary" aria-labelledby="sources-summary">
            <h3 id="sources-summary" class="title-medium">${this.s('adminSources.summary.title')}</h3>
            <p>${this.s('adminSources.summary.platform', range(estimate.platform.low, estimate.platform.high))}</p>
            <p>${this.s('adminSources.summary.budget', { amount })}</p>
            <p>${sources}</p>
            <p class="title-small">${this.s('adminSources.summary.total', range(estimate.monthly.low, estimate.monthly.high))}</p>
            ${estimate.perScanUsd === null ? nothing : html`<p>${this.s('adminSources.summary.scan', { usd: this.usd(estimate.perScanUsd) })}</p>`}
            <p class="note">${this.s('adminSources.summary.estimate', { date: formatDay(this.locale, SOURCES_CHECKED_ON) })}</p>
            ${actionLink(this.s('adminSources.summary.openPlatform'), '#/setup/platform', false)}
        </section>`;
    }

    private renderGroup(state: SetupViewState, group: SourceGroup): TemplateResult {
        const id = `sources-${group}`;
        return html`<section aria-labelledby=${id}>
            <h3 id=${id} class="title-medium">${this.s(sourcesKey(`adminSources.group.${group}`))}</h3>
            <ul class="group">
                ${SOURCE_CATALOGUE.filter((entry) => entry.group === group).map((entry) => this.renderSource(state, entry))}
            </ul>
        </section>`;
    }

    private renderSource(state: SetupViewState, facts: SourceFacts): TemplateResult {
        const title = this.s(sourcesKey(`adminSources.${facts.id}.title`));
        const on = sourceOn(state.sources.choices, facts.id);
        return html`<li class="source" data-source=${facts.id}>
            <div class="source-head">
                <div class="source-name">
                    <h4 class="title-small">${title}</h4>
                    <p class="note">${this.s(sourcesKey(`adminSources.${facts.id}.short`))}</p>
                </div>
                ${this.renderSwitch(state, facts, title, on)}
            </div>
            ${on ? this.renderAccount(state, facts) : nothing} ${this.renderNeeds(state, facts)}
            ${sourceDetails((key, params) => this.s(key, params), facts.id, { ...facts, example: true }, providerLinks(this.sTr(), facts.links))}
        </li>`;
    }

    private sTr(): (key: AdminSourcesKey, params?: Readonly<Record<string, string>>) => string {
        return (key, params) => this.s(key, params);
    }

    /** A switch, or "Always on" for Sentinel-2; paid scans wait for the declassified frames. */
    private renderSwitch(state: SetupViewState, facts: SourceFacts, title: string, on: boolean): TemplateResult {
        if (facts.required) {
            return html`<span class="tag label-medium">${this.s('adminSources.alwaysOn')}</span>`;
        }
        const id = facts.id as SourceToggle;
        const blocked = facts.needs !== null && !state.sources.choices[facts.needs];
        return html`<hcm-switch
            .checked=${on}
            .label=${title}
            ?disabled=${blocked || state.steps.sources.busy}
            @hcm-change=${(event: CustomEvent<{ readonly checked: boolean }>) => {
                this.act((intents) => {
                    intents.chooseSource(id, event.detail.checked);
                });
            }}
        ></hcm-switch>`;
    }

    private renderNeeds(state: SetupViewState, facts: SourceFacts): TemplateResult {
        return facts.needs !== null && !state.sources.choices[facts.needs]
            ? html`<p class="note">${this.s('adminSources.needsUsgs')}</p>`
            : EMPTY;
    }

    /** The account a chosen source needs: its state, and the next action straight to the place that does it. */
    private renderAccount(state: SetupViewState, facts: SourceFacts): TemplateResult {
        if (facts.account === null) {
            return html`<span class="tag label-medium">${this.s('adminSources.account.none')}</span>`;
        }
        const status = accountStatus(state, facts.account);
        return html`<div class="actions">${accountChip(this.sTr(), status)} ${this.accountAction(state, facts.account, status)}</div>`;
    }

    private accountAction(state: SetupViewState, account: NonNullable<SourceFacts['account']>, status: string): TemplateResult {
        if (status === 'signedIn') {
            return EMPTY;
        }
        if (account === 'google') {
            return actionLink(this.s('adminSources.account.google.open'), '#/setup/billing', false);
        }
        if (status === 'waiting') {
            return html`<p class="note">${this.s('adminSources.account.usgs.wait')}</p>`;
        }
        const register = state.steps.usgs.links.find((link) => link.id === 'usgs.register');
        return html`${register === undefined ? EMPTY : actionLink(this.s('adminSources.account.usgs.signUp'), register.url, true)}
        ${actionLink(this.s('adminSources.account.usgs.open'), '#/setup/usgs', false)}`;
    }

    /** The collections drawn from by hand: no switch, each with whether it may go public and how it comes in today. */
    private renderGuided(): TemplateResult {
        return html`<section aria-labelledby="sources-guided">
            <h3 id="sources-guided" class="title-medium">${this.s('adminSources.group.guided')}</h3>
            <p class="note">${this.s('adminSources.guided.intro')}</p>
            <ul class="group">
                ${GUIDED_CATALOGUE.map((facts) => this.renderGuidedSource(facts))}
            </ul>
        </section>`;
    }

    private renderGuidedSource(facts: GuidedFacts): TemplateResult {
        const t = this.sTr();
        const extra = html`<h4 class="title-small">${this.s('adminSources.section.publicUse')}</h4>
            <p>${this.s(sourcesKey(`adminSources.publicUse.${facts.publicUse}`))}</p>
            <h4 class="title-small">${this.s('adminSources.section.path')}</h4>
            <p>${this.s(sourcesKey(`adminSources.path.${facts.path}`))}</p>
            <p class="note">${this.s(sourcesKey(`adminSources.automatic.${facts.automatic}`))}</p>
            ${providerLinks(t, facts.links)}`;
        return html`<li class="source" data-guided=${facts.id}>
            <h4 class="title-small">${this.s(sourcesKey(`adminSources.${facts.id}.title`))}</h4>
            <p class="note">${this.s(sourcesKey(`adminSources.${facts.id}.short`))}</p>
            ${sourceDetails(t, facts.id, { pros: 2, cons: 2, steps: 2, example: false }, extra)}
        </li>`;
    }

    private renderNotUsable(): TemplateResult {
        return html`<section aria-labelledby="sources-not-usable">
            <h3 id="sources-not-usable" class="title-medium">${this.s('adminSources.notUsable.title')}</h3>
            <ul>
                ${NOT_USABLE_SOURCES.map(
                    (id) =>
                        html`<li data-not-usable=${id}>
                            <strong>${this.s(sourcesKey(`adminSources.notUsable.${id}.title`))}</strong>:
                            ${this.s(sourcesKey(`adminSources.notUsable.${id}.why`))}
                        </li>`,
                )}
            </ul>
        </section>`;
    }

    /** Save my choice, what is saved, and that USGS's step left the list. */
    private renderSave(state: SetupViewState): TemplateResult {
        const sources = state.sources;
        const changed = unsaved(sources);
        return html`<p class="note" role="status">${this.s(saveStatus(sources, changed))}</p>
            ${usgsLeftOut(sources) ? html`<p class="note">${this.s('adminSources.usgsLeftOut')}</p>` : nothing}
            <div class="actions">
                <hcm-button
                    variant="filled"
                    icon="check"
                    ?disabled=${!changed || state.steps.sources.busy}
                    @click=${() => {
                        this.save(sources.choices);
                    }}
                    >${this.s('adminSources.save')}</hcm-button
                >
            </div>`;
    }

    /** Saves, and reports each switch's reason code to the Setup funnel (codes only, never words). */
    private save(choices: SourceChoices): void {
        for (const [id, on] of Object.entries(choices) as [SourceToggle, boolean][]) {
            signalFunnel(this, { kind: 'action', wizard: 'setup', step: 'sources', action: `source.${id}.${choiceReason(id, on)}` });
        }
        this.act((intents) => {
            intents.saveSources();
        });
    }
}

/** Registers `<hcm-setup-sources>` and what it renders. */
export function defineHcmSetupSources(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineHcmSwitch(registry);
    defineOnce(registry, HCM_SETUP_SOURCES_TAG, HcmSetupSources);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-sources': HcmSetupSources;
    }
}
