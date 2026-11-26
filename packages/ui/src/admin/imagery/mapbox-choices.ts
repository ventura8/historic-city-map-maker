/**
 * What only a city that publishes through Mapbox sees (`docs/research/M12-own-tiles.md`; before it, the approval card's): what publishing
 * costs in Mapbox compute units and what is left this month, and the ways out of a publish that does not fit: the free Mapbox Studio
 * upload (three steps), next month, or pay about $X now (asked first). At the tileset cap neither money nor a month frees a place: the
 * card says to delete a layer (with the way to Layers) or use Studio; a file Mapbox refused as too large has only the Studio way
 * (CR-M3-47). A chunk of its own (the admin's `mapbox-choices-<hash>.js`): a city on its own bucket, the default, never fetches it.
 */
import { availableComputeUnits, MAX_TILESETS, nextMonthStart, translateApiError, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionPagePort, VersionViewPort } from './imagery-port.js';
import { dayText, numberText } from './imagery-text.js';
import { when } from './when.js';

/** Mapbox Studio's tilesets page: `links.json` → `mapbox.studioTilesets` (CR-M3-9; the weekly contract run probes it). */
const MAPBOX_STUDIO_TILESETS_URL = 'https://studio.mapbox.com/tilesets/';

export type Guard = NonNullable<VersionViewPort['guard']>;

/** The page is busy with another action, or nothing may be written. */
function busy(context: ImageryContext, page: VersionPagePort): boolean {
    return page.acting !== null || context.readOnly;
}

export function costText(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    const available = Math.max(0, availableComputeUnits(page.usage ?? undefined, version.id));
    const estimate = numberText(locale, version.estimate ?? 0);
    return html`<p class="note" data-estimate>
        ${contentText(locale, 'adminContent.imagery.approval.cost', { estimate, available: numberText(locale, available) })}
    </p>`;
}

function studioSteps(context: ImageryContext, page: VersionPagePort): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    return html`<ol class="steps" data-state="studio-steps">
            <li>
                <hcm-button variant="tonal" icon="download" ?disabled=${off} @click=${() => void intents?.download()}
                    >${contentText(locale, 'adminContent.imagery.studio.download')}</hcm-button
                >
                ${when(page.downloaded, () => html`<hcm-icon name="check_circle"></hcm-icon>`)}
            </li>
            <li>
                <a class="external" href=${MAPBOX_STUDIO_TILESETS_URL} target="_blank" rel="noopener noreferrer"
                    >${contentText(locale, 'adminContent.imagery.studio.open')}<hcm-icon name="open_in_new"></hcm-icon
                ></a>
            </li>
            <li>
                <hcm-button variant="filled" icon="check" ?disabled=${off} @click=${() => void intents?.studioDone()}
                    >${contentText(locale, 'adminContent.imagery.studio.done')}</hcm-button
                >
            </li>
        </ol>
        <p class="note">${contentText(locale, 'adminContent.imagery.studio.note')}</p>`;
}

/** The version's file for Mapbox in whole megabytes, as the refusal says it. */
function megabytesOf(version: VersionViewPort): string {
    return String(Math.ceil((version.output?.cogBytes ?? 0) / 1e6));
}

/** M5: the city's share of the month is what stops the publish (`apiError.city.budgetReached`). */
function cityOverText(locale: UiLocale, guard: Guard, version: VersionViewPort): string {
    const params = { estimate: numberText(locale, version.estimate ?? 0), available: numberText(locale, Math.max(0, guard.available)) };
    return translateApiError(locale, 'apiError.city.budgetReached', params);
}

/** Why the publish waits: the month's compute units, the tileset cap, a file Mapbox refused as too large, or the city's share. */
function overText(locale: UiLocale, guard: Guard, version: VersionViewPort): string {
    if (guard.verdict === 'city-over') {
        return cityOverText(locale, guard, version);
    }
    if (guard.verdict === 'tileset-limit') {
        return contentText(locale, 'adminContent.imagery.approval.tilesetLimit', { limit: String(MAX_TILESETS) });
    }
    if (guard.verdict === 'too-large') {
        return contentText(locale, 'adminContent.imagery.approval.tooLarge', { megabytes: megabytesOf(version) });
    }
    return contentText(locale, 'adminContent.imagery.approval.over', { available: numberText(locale, Math.max(0, guard.available)) });
}

/**
 * Next month and paying: only when the month's compute units are what stops the publish; over the city's share (M5) next
 * month alone, since paying the project's overage would not raise the city's share.
 */
function laterOrPay(context: ImageryContext, page: VersionPagePort, guard: Guard): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    const next = dayText(locale, nextMonthStart(new Date()).toISOString());
    const later = html`<hcm-button variant="tonal" icon="pending" ?disabled=${off} @click=${() => void intents?.choose('defer')}
        >${contentText(locale, 'adminContent.imagery.choice.defer', { date: next })}</hcm-button
    >`;
    if (guard.verdict === 'city-over') {
        return later;
    }
    const usd = numberText(locale, guard.overageUsd ?? 0, 2);
    return when(
        guard.verdict === 'over',
        () =>
            html`${later}
                <hcm-button
                    variant="outlined"
                    icon="credit_card"
                    ?disabled=${off}
                    @click=${() => {
                        context.ask('pay');
                    }}
                    >${contentText(locale, 'adminContent.imagery.choice.pay', { usd })}</hcm-button
                >`,
    );
}

/** At the tileset cap a layer must go: the way to Layers. */
function layersLink(locale: UiLocale, guard: Guard): TemplateResult {
    return when(
        guard.verdict === 'tileset-limit',
        () => html`<a href="#/layers">${contentText(locale, 'adminContent.imagery.openLayers')}</a>`,
    );
}

const CHOICE_STATES: Readonly<Record<Exclude<Guard['verdict'], 'within'>, string>> = {
    over: 'over-budget',
    'tileset-limit': 'tileset-limit',
    'too-large': 'too-large',
    'city-over': 'city-over',
};

/** The ways out of a publish the guard stopped: Studio always; next month or paying only over the month's units. */
function choices(context: ImageryContext, page: VersionPagePort, guard: Guard, version: VersionViewPort): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    return html`<div class="choices" data-state=${CHOICE_STATES[guard.verdict as Exclude<Guard['verdict'], 'within'>]}>
        <p class="alert" role="alert"><hcm-icon name="info"></hcm-icon><span>${overText(locale, guard, version)}</span></p>
        ${layersLink(locale, guard)}
        <hcm-button variant="filled" icon="upload_file" ?disabled=${off} @click=${() => void intents?.choose('studio')}
            >${contentText(locale, 'adminContent.imagery.choice.studio')}</hcm-button
        >
        ${laterOrPay(context, page, guard)}
    </div>`;
}

function deferred(locale: UiLocale, deferUntil: string): TemplateResult {
    return html`<p class="note" data-state="deferred">
        ${contentText(locale, 'adminContent.imagery.wait.deferred', { date: dayText(locale, deferUntil) })}
    </p>`;
}

/** What the card offers once the guard spoke: the Studio steps, the deferral's date, or the choices. */
export function guarded(context: ImageryContext, page: VersionPagePort, guard: Guard, version: VersionViewPort): TemplateResult {
    if (guard.choice === 'studio') {
        return studioSteps(context, page);
    }
    if (guard.choice === 'defer' && guard.deferUntil !== null) {
        return deferred(context.locale, guard.deferUntil);
    }
    return choices(context, page, guard, version);
}
