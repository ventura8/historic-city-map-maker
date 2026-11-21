/**
 * The value fields of a proposal (M13, `docs/research/M13-roles.md` §§4, 8), shared by the Contribute page and the Review page's
 * adjust: latitude, longitude, direction and date, each the keyboard's way to what the map's pin says.
 */
import type { UiLocale, SuggestionProposal } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';

type Edit = (patch: SuggestionProposal) => void;

/** A number a field holds, or undefined. */
function numberIn(typed: string): number | undefined {
    const value = Number(typed);
    return typed.trim() === '' || !Number.isFinite(value) ? undefined : value;
}

function typedIn(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
}

/** Latitude or longitude: the keyboard's way to place the pin. */
export function coordinateField(
    locale: UiLocale,
    axis: 'lat' | 'lng',
    location: SuggestionProposal['location'],
    edit: Edit,
): TemplateResult {
    const limit = axis === 'lat' ? 90 : 180;
    const change = (event: Event): void => {
        const value = numberIn(typedIn(event));
        if (value !== undefined) {
            edit({ location: { lat: 0, lng: 0, ...location, [axis]: value } });
        }
    };
    return html`<div class="field">
        <label for=${axis}>${contentText(locale, `adminContent.contribute.${axis}`)}</label>
        <input
            id=${axis}
            name=${axis}
            type="number"
            step="any"
            min=${-limit}
            max=${limit}
            .value=${String(location?.[axis] ?? '')}
            @change=${change}
        />
    </div>`;
}

export function bearingField(locale: UiLocale, bearing: number | undefined, edit: Edit): TemplateResult {
    return html`<div class="field">
        <label for="bearing">${contentText(locale, 'adminContent.contribute.bearing')}</label>
        <input
            id="bearing"
            name="bearing"
            type="number"
            step="any"
            min="0"
            max="360"
            .value=${String(bearing ?? '')}
            @change=${(event: Event) => {
                edit({ bearing: numberIn(typedIn(event)) });
            }}
        />
    </div>`;
}

function yearField(locale: UiLocale, key: 'year' | 'yearEnd', proposal: SuggestionProposal, edit: Edit): TemplateResult {
    return html`<div class="field">
        <label for=${key}>${contentText(locale, `adminContent.contribute.${key}`)}</label>
        <input
            id=${key}
            name=${key}
            type="number"
            min="1800"
            max="2100"
            .value=${String(proposal[key] ?? '')}
            @change=${(event: Event) => {
                edit({ [key]: numberIn(typedIn(event)) });
            }}
        />
    </div>`;
}

/** A date: its years, and the words it was written in. */
export function dateFields(locale: UiLocale, proposal: SuggestionProposal, edit: Edit): TemplateResult {
    return html`${yearField(locale, 'year', proposal, edit)} ${yearField(locale, 'yearEnd', proposal, edit)}
        <div class="field">
            <label for="dateText">${contentText(locale, 'adminContent.contribute.dateText')}</label>
            <input
                id="dateText"
                name="dateText"
                .value=${proposal.dateText ?? ''}
                @change=${(event: Event) => {
                    edit({ dateText: typedIn(event) });
                }}
            />
        </div>`;
}
