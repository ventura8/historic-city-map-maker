/**
 * `<hcm-shot-direction>`, the layer editor's shot direction fields, a side chunk (`shot-direction-row.ts` renders it). A satellite or aerial layer's shot direction in the layer editor (V93, the owner 2026-11-23): the compass dial
 * (`<hcm-direction-dial>`) and the same value in degrees, typed; Clear removes it. When the layer came from a USGS scene
 * whose corners say how the frame lies, Use the USGS direction fills it in (the draft only: nothing is written before
 * Save). A drawn map has no shot direction: the row is not shown for one.
 */
import type { LayerDoc, UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';

import { contentText } from '../shell/text.js';
import { wholeBearing } from './bearing.js';
import { defineHcmDirectionDial } from './hcm-direction-dial.js';

/**
 * The degrees as typed: a number from 0 to 360 in whole degrees (a comma for a decimal point; 360 is north); empty is none
 * (undefined), anything else NaN, which the schema refuses at the field (as a year that is no number).
 */
export function shotDirectionOf(text: string): number | undefined {
    const trimmed = text.trim().replace(',', '.');
    const value = Number(trimmed);
    if (trimmed === '') {
        return undefined;
    }
    return Number.isFinite(value) && value >= 0 && value <= 360 ? wholeBearing(value) : Number.NaN;
}

/** What `shotDirectionRow` hands the fields. */
export interface ShotDirectionRowInput {
    readonly locale: UiLocale;
    readonly layer: Pick<LayerDoc, 'kind' | 'shotDirection'>;
    /** The direction the layer's USGS scene suggests, when there is one. */
    readonly suggestion: number | undefined;
    readonly readOnly: boolean;
    readonly change: (shotDirection: number | undefined) => void;
    readonly mapReady?: boolean;
    readonly bearing?: () => number | null;
    readonly announce?: (text: string) => void;
}

function suggestionButton(input: ShotDirectionRowInput): TemplateResult {
    const { suggestion, locale } = input;
    if (suggestion === undefined || suggestion === input.layer.shotDirection) {
        return html``;
    }
    return html`<hcm-button
        variant="text"
        data-shot-suggestion
        ?disabled=${input.readOnly}
        @click=${() => {
            input.change(suggestion);
        }}
        >${contentText(locale, 'adminContent.layers.shot.useUsgs', { degrees: String(suggestion) })}</hcm-button
    >`;
}

function setFromView(input: ShotDirectionRowInput): void {
    const bearing = input.bearing?.() ?? Number.NaN;
    if (!Number.isFinite(bearing)) {
        return;
    }
    const value = wholeBearing(bearing);
    input.change(value);
    input.announce?.(contentText(input.locale, 'adminContent.layers.shot.fromViewDone', { degrees: String(value) }));
}

function mapHint(locale: ShotDirectionRowInput['locale'], ready: boolean): TemplateResult {
    return ready
        ? html``
        : html`<p class="note" id="layer-shot-map-hint">${contentText(locale, 'adminContent.layers.shot.mapNotReady')}</p>`;
}

function fromViewButton(input: ShotDirectionRowInput): TemplateResult {
    const { locale } = input;
    const ready = input.mapReady === true;
    return html`<hcm-button
            variant="outlined"
            data-shot-from-view
            ?disabled=${input.readOnly || !ready}
            @click=${() => {
                setFromView(input);
            }}
            >${contentText(locale, 'adminContent.layers.shot.fromView')}</hcm-button
        >${mapHint(locale, ready)}`;
}

function shotDirectionFields(input: ShotDirectionRowInput): TemplateResult {
    const { locale, layer } = input;
    const value = layer.shotDirection ?? null;
    return html`<div class="field shot" data-shot-direction>
        <p class="note" id="layer-shot-label">${contentText(locale, 'adminContent.layers.shot')}</p>
        <hcm-direction-dial
            .value=${value}
            .label=${contentText(locale, 'adminContent.layers.shot')}
            .empty=${contentText(locale, 'adminContent.layers.shot.none')}
            ?disabled=${input.readOnly}
            aria-describedby="layer-shot-hint"
            @hcm-change=${(event: CustomEvent<{ value: number }>) => {
                input.change(event.detail.value);
            }}
        ></hcm-direction-dial>
        <label for="layer-shot-degrees">${contentText(locale, 'adminContent.layers.shot.degrees')}</label>
        <input
            id="layer-shot-degrees"
            inputmode="decimal"
            autocomplete="off"
            aria-describedby="layer-shot-hint"
            ?readonly=${input.readOnly}
            .value=${value === null ? '' : String(value)}
            @change=${(event: Event) => {
                input.change(shotDirectionOf((event.target as HTMLInputElement).value));
            }}
        />
        ${fromViewButton(input)}
        <hcm-button
            variant="text"
            data-shot-clear
            ?disabled=${input.readOnly || value === null}
            @click=${() => {
                input.change(undefined);
            }}
            >${contentText(locale, 'adminContent.layers.shot.clear')}</hcm-button
        >
        ${suggestionButton(input)}
        <p class="note" id="layer-shot-hint">${contentText(locale, 'adminContent.layers.shot.hint')}</p>
    </div>`;
}

/** The fields in the editor's own DOM (its labels, ids and styles), so they read and test as the other fields do. */
class HcmShotDirection extends LitElement {
    static override readonly properties = { input: { attribute: false } };

    declare input: ShotDirectionRowInput | null;

    constructor() {
        super();
        this.input = null;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }

    override render(): TemplateResult {
        return this.input === null ? html`` : shotDirectionFields(this.input);
    }
}

export function defineHcmShotDirection(registry: CustomElementRegistry = customElements): void {
    defineHcmDirectionDial(registry);
    defineOnce(registry, 'hcm-shot-direction', HcmShotDirection);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-shot-direction': HcmShotDirection;
    }
}
