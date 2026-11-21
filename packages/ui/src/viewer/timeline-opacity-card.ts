/**
 * The opacity card's content (`timeline-opacity.ts`; the owner, 2026-11-15): a year of one layer shows one slider; a year of
 * several layers shows an "all" slider first, which sets every layer of the year at once, then one row per layer by date,
 * each with its own slider. Every slider fires the Layers panel's own `hcm-overlay-opacity` (`{id, opacity, final}`), so
 * the store keeps one value per layer and the panel's sliders follow. The Tab order is the DOM's: "all", then the rows.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { defineHcmSlider } from '../components/slider.js';

defineHcmSlider();

/** One layer of the selected year, as the store holds it. */
export interface YearLayer {
    readonly id: string;
    /** The Layers panel's name for it (the slider's accessible name). */
    readonly name: string;
    /** Its date in the visitor's language (the row's visible label). */
    readonly date: string;
    /** 0 to 1. */
    readonly opacity: number;
}

/** The layers the card changes: every layer of the selected year, by date. */
export interface YearOpacity {
    readonly year: number;
    readonly layers: readonly YearLayer[];
}

/** The "all" slider's value: the layers' mean, in whole percent. */
export function meanPercent(layers: readonly YearLayer[]): number {
    const sum = layers.reduce((total, layer) => total + layer.opacity, 0);
    return Math.round((sum / Math.max(layers.length, 1)) * 100);
}

/** The kit slider's own event stops here; the timeline sends the Layers panel's, once per layer. */
function sendAll(host: EventTarget, ids: readonly string[], event: Event, final: boolean): void {
    event.stopPropagation();
    const opacity = (event as CustomEvent<{ readonly value: number }>).detail.value / 100;
    for (const id of ids) {
        host.dispatchEvent(new CustomEvent('hcm-overlay-opacity', { bubbles: true, detail: { id, opacity, final } }));
    }
}

/**
 * One kit slider (as in the Layers panel: its track and handle keep 3:1 against the card, WCAG 1.4.11), 0 to 100 %, that
 * sends `ids`' opacity.
 */
/** What one slider changes: the layers `ids`, at `percent`, named `name` as the Layers panel names it. */
interface SliderOf {
    readonly ids: readonly string[];
    readonly percent: number;
    readonly name: string;
}

function slider(host: EventTarget, { ids, percent, name }: SliderOf, locale: ViewerLocale): TemplateResult {
    return html`<hcm-slider
        min="0"
        max="100"
        step="1"
        .value=${percent}
        label=${translate(locale, 'layers.opacity', { name })}
        value-text=${translate(locale, 'layers.opacityValue', { percent: String(percent) })}
        @hcm-input=${(event: Event) => {
            sendAll(host, ids, event, false);
        }}
        @hcm-change=${(event: Event) => {
            sendAll(host, ids, event, true);
        }}
    ></hcm-slider>`;
}

function layerSlider(host: EventTarget, layer: YearLayer, locale: ViewerLocale): TemplateResult {
    return slider(host, { ids: [layer.id], percent: Math.round(layer.opacity * 100), name: layer.name }, locale);
}

/** The card's sliders: one for a single layer; "all" and one row per layer for several. */
export function opacitySliders(year: YearOpacity, locale: ViewerLocale, host: EventTarget): TemplateResult {
    const [only] = year.layers;
    if (only !== undefined && year.layers.length === 1) {
        return layerSlider(host, only, locale);
    }
    const all = translate(locale, 'timeline.opacityAll', { year: String(year.year) });
    const ids = year.layers.map((layer) => layer.id);
    const row = (label: string, input: TemplateResult): TemplateResult =>
        html`<div class="opacity-row"><span class="opacity-name" aria-hidden="true">${label}</span>${input}</div>`;
    return html`${row(all, slider(host, { ids, percent: meanPercent(year.layers), name: all }, locale))}
    ${year.layers.map((layer) => row(layer.date, layerSlider(host, layer, locale)))}`;
}
