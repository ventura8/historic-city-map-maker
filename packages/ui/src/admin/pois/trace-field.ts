/**
 * M27 "Disappeared streets": the place editor's "Traced on map" field. A select of "None" and the city's old maps by year
 * sets the place's `sourceLayer`; the store shows the chosen map under the drawing, and the opacity slider fades it to compare
 * with today's streets. A place naming a map that no longer exists (deleted, or replaced by its date's join) says so in plain
 * words and lets the admin choose another map or None. Native controls, styled by the editing kit.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import type { FieldContext } from './poi-fields.js';
import { localized, poiText } from './poi-text.js';
import type { TraceLayerPort } from './pois-port.js';

export interface TraceChoice {
    readonly layers: readonly TraceLayerPort[];
    /** The old map's opacity under the drawing, in percent. */
    readonly opacity: number;
    readonly setOpacity: (percent: number) => void;
}

function valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function layerOption(locale: UiLocale, layer: TraceLayerPort, chosen: string | undefined): TemplateResult {
    const text = poiText(locale, 'adminContent.pois.trace.layerOption', {
        year: String(layer.year),
        label: localized(locale, layer.label),
    });
    return html`<option value=${layer.id} ?selected=${layer.id === chosen}>${text}</option>`;
}

/** The option of a map the place names but the city no longer has. */
function goneOption(locale: UiLocale, chosen: string): TemplateResult {
    return html`<option value=${chosen} selected>${poiText(locale, 'adminContent.pois.trace.gone')}</option>`;
}

function opacityField(locale: UiLocale, choice: TraceChoice, readOnly: boolean): TemplateResult {
    return html`<div class="field">
        <label for="trace-opacity">${poiText(locale, 'adminContent.pois.field.traceOpacity')}</label>
        <input
            id="trace-opacity"
            type="range"
            min="0"
            max="100"
            step="1"
            ?disabled=${readOnly}
            .value=${String(choice.opacity)}
            aria-valuetext=${`${String(choice.opacity)} %`}
            aria-describedby="trace-opacity-hint"
            @input=${(event: Event) => {
                choice.setOpacity(Number(valueOf(event)));
            }}
        />
        <p class="note" id="trace-opacity-hint">${poiText(locale, 'adminContent.pois.trace.opacityHint')}</p>
    </div>`;
}

/** Under the select: why a gone map shows nothing and what to do, else what the field is for. */
function traceHint(locale: UiLocale, gone: boolean): TemplateResult {
    return gone
        ? html`<p class="error" id="trace-gone">${poiText(locale, 'adminContent.pois.trace.goneHint')}</p>`
        : html`<p class="note" id="trace-hint">${poiText(locale, 'adminContent.pois.trace.hint')}</p>`;
}

/** Whether the place's map is one of the city's (`known`), or one it no longer has (`gone`). */
function stateOf(chosen: string | undefined, layers: readonly TraceLayerPort[]): { readonly known: boolean; readonly gone: boolean } {
    const known = layers.some((layer) => layer.id === chosen);
    return { known, gone: chosen !== undefined && !known };
}

export function traceFields(context: FieldContext, choice: TraceChoice): TemplateResult {
    const { locale, readOnly } = context;
    const chosen = context.value.sourceLayer ?? '';
    const { known, gone } = stateOf(context.value.sourceLayer, choice.layers);
    return html`<div class="field" ?data-invalid=${gone}>
            <label for="trace-layer">${poiText(locale, 'adminContent.pois.field.traceLayer')}</label>
            <select
                id="trace-layer"
                ?disabled=${readOnly}
                aria-describedby=${gone ? 'trace-gone' : 'trace-hint'}
                @change=${(event: Event) => {
                    const id = valueOf(event);
                    context.edit({ sourceLayer: id === '' ? undefined : id });
                }}
            >
                <option value="" ?selected=${chosen === ''}>${poiText(locale, 'adminContent.pois.trace.none')}</option>
                ${gone ? goneOption(locale, chosen) : EMPTY} ${choice.layers.map((layer) => layerOption(locale, layer, chosen))}
            </select>
            ${traceHint(locale, gone)}
        </div>
        ${known ? opacityField(locale, choice, readOnly) : EMPTY}`;
}
