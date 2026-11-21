/**
 * V13: a timeline year with several historical layers (several dates, or several images of one date). Its stop carries a
 * small badge with the count, a hint for the eye only; selecting that year (a tap, a click, the end of a drag or a scrub,
 * Enter, the gamepad's A: the owner, 2026-11-13) asks for the date picker (`hcm-dates-open`), which lists the year's
 * layers by date (`<hcm-date-menu>`); picking one brings it to the front (the store's `pickLayer`, V15's mechanism). The
 * stops, the badge's template and the picker's items are here; the timeline and the viewer only call them.
 */
import { localized, translate, type Layer, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { TimelineStop } from './timeline-model.js';

/** The years with two layers or more, and how many each has. */
export function dateCounts(layers: readonly Pick<Layer, 'year'>[]): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const layer of layers) {
        counts.set(layer.year, (counts.get(layer.year) ?? 0) + 1);
    }
    return new Map([...counts].filter(([, count]) => count > 1));
}

/** How many dates the stop has (0 for "today" and for a year with a single layer). */
export function countOf(counts: ReadonlyMap<number, number>, stop: TimelineStop): number {
    return stop === null ? 0 : (counts.get(stop) ?? 0);
}

/** `hcm-dates-open`: the year whose dates to list, and the box (client px) the picker opens beside. */
export interface DatesOpenDetail {
    readonly year: number;
    readonly anchor: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** The event that asks for the picker of `year`, beside `from` (the slider's thumb). */
export function datesOpenEvent(year: number, from: Element): CustomEvent<DatesOpenDetail> {
    const box = from.getBoundingClientRect();
    const anchor = { x: box.x, y: box.y, width: box.width, height: box.height };
    return new CustomEvent('hcm-dates-open', { bubbles: true, composed: true, detail: { year, anchor } });
}

/**
 * The badge of a stop with `count` dates: a number in a small circle, for the eye only (the slider says it in its value
 * text). It takes no press (too small for a finger or a mouse, the owner 2026-11-13): a press through it lands on the
 * year's point, and selecting the year opens its dates.
 */
export function dateBadge(year: TimelineStop, count: number): TemplateResult {
    if (year === null || count < 2) {
        return EMPTY;
    }
    return html`<span class="badge" aria-hidden="true">${String(count)}</span>`;
}

/** The slider's value text: the year, and on a year with several dates how many and that Enter lists them. */
export function datesValueText(locale: ViewerLocale, yearText: string, count: number): string {
    return count < 2 ? yearText : `${yearText}, ${translate(locale, 'timeline.datesHint', { count: String(count) })}`;
}

/** One entry of the picker: a layer of the year, named by its date (or its year) and its own label. */
export interface DateItem {
    readonly id: string;
    readonly date: string;
    readonly label: string;
}

/** A layer's date in the visitor's language (`12 aprilie 1966`), else its year; the date is `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
export function dateText(layer: Pick<Layer, 'year' | 'date'>, locale: ViewerLocale): string {
    const [, month, day] = (layer.date ?? '').split('-').map(Number);
    if (month === undefined) {
        return String(layer.year);
    }
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', timeZone: 'UTC' };
    if (day !== undefined) {
        options.day = 'numeric';
    }
    return new Intl.DateTimeFormat(locale, options).format(new Date(Date.UTC(layer.year, month - 1, day ?? 1)));
}

/** The picker's entries for `year`: its layers by date, the undated ones last, each in manifest order among equals. */
export function dateItems(
    layers: readonly Pick<Layer, 'id' | 'year' | 'date' | 'label'>[],
    year: number,
    locale: ViewerLocale,
): readonly DateItem[] {
    return layers
        .filter((layer) => layer.year === year)
        .map((layer, at) => ({ layer, at, key: layer.date ?? '￿' }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.at - b.at)
        .map(({ layer }) => ({ id: layer.id, date: dateText(layer, locale), label: localized(layer.label, locale) }));
}

/**
 * The layer of `year` on top: the chosen front when it is one of that year's, else the year's last in manifest order
 * (what the engine's `stack.ts` draws highest among equals).
 */
export function frontOfYear(layers: readonly Pick<Layer, 'id' | 'year'>[], year: number, front: string | null): string | null {
    const ofYear = layers.filter((layer) => layer.year === year);
    return ofYear.find((layer) => layer.id === front)?.id ?? ofYear.at(-1)?.id ?? null;
}
