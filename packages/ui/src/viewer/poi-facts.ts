/**
 * A place's facts in its sheet (`docs/research/M17-stories.md` §13): a description list of what the place says (architect,
 * years built, demolished and abandoned, style, floors, height, uses over time, LMI code, addresses past and present) and
 * its related places as buttons that open them (`hcm-poi-select`). Every value is data, rendered as text.
 */
import { translate, type MessageKey, type PlaceFacts, type Poi, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { localizedText } from './text.js';

/** A span of years as `1906–1940`, `1906–` or `–1940`; none, null. */
export function yearSpan(start: number | undefined, end: number | undefined): string | null {
    if (start === undefined && end === undefined) {
        return null;
    }
    return `${start === undefined ? '' : String(start)}–${end === undefined ? '' : String(end)}`;
}

/** `text`, after its years when it has any. */
function dated(text: string, start: number | undefined, end: number | undefined): string {
    const span = yearSpan(start, end);
    return span === null ? text : `${span}: ${text}`;
}

type Row = readonly [MessageKey, readonly string[]];

/** One fact as its row's values; an absent fact has none (the row is left out). */
const SCALARS: readonly (readonly [MessageKey, (facts: PlaceFacts, locale: ViewerLocale) => string | undefined])[] = [
    ['poi.facts.architects', (facts) => facts.architects?.join(', ')],
    ['poi.facts.built', (facts) => facts.yearBuilt?.toString()],
    ['poi.facts.demolished', (facts) => facts.yearDemolished?.toString()],
    ['poi.facts.abandoned', (facts) => facts.yearAbandoned?.toString()],
    ['poi.facts.style', (facts, locale) => (facts.style === undefined ? undefined : localizedText(facts.style, locale))],
    ['poi.facts.floors', (facts) => facts.floors?.toString()],
    ['poi.facts.height', (facts, locale) => (facts.heightM === undefined ? undefined : metres(facts.heightM, locale))],
    ['poi.facts.lmi', (facts) => facts.lmiCode],
];

function metres(value: number, locale: ViewerLocale): string {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter' }).format(value);
}

function scalarRows(facts: PlaceFacts, locale: ViewerLocale): Row[] {
    return SCALARS.flatMap(([key, read]) => {
        const value = read(facts, locale);
        return value === undefined ? [] : [[key, [value]] as const];
    });
}

function listRows(facts: PlaceFacts, locale: ViewerLocale): Row[] {
    const today = translate(locale, 'poi.facts.today');
    const uses = (facts.uses ?? []).map((use) => dated(localizedText(use.use, locale), use.yearStart, use.yearEnd));
    const addresses = (facts.addresses ?? []).map((address) =>
        address.current === true ? `${address.text} (${today})` : dated(address.text, address.yearStart, address.yearEnd),
    );
    return [
        ...(uses.length === 0 ? [] : [['poi.facts.uses', uses] as const]),
        ...(addresses.length === 0 ? [] : [['poi.facts.addresses', addresses] as const]),
    ];
}

function related(facts: PlaceFacts, pois: readonly Poi[], locale: ViewerLocale, open: (poiId: string) => void): TemplateResult {
    const byId = new Map(pois.map((poi) => [poi.id, poi]));
    const places = (facts.relatedPlaceIds ?? []).flatMap((id) => byId.get(id) ?? []);
    if (places.length === 0) {
        return html``;
    }
    return html`<dt>${translate(locale, 'poi.facts.related')}</dt>
        ${places.map((place) => relatedItem(place, locale, open))}`;
}

function relatedItem(place: Poi, locale: ViewerLocale, open: (poiId: string) => void): TemplateResult {
    const title = localizedText(place.title, locale);
    return html`<dd>
                <button
                    type="button"
                    class="related"
                    aria-label=${translate(locale, 'poi.openPlace', { title })}
                    @click=${() => {
                        open(place.id);
                    }}
                >
                    ${title}
                </button>
            </dd>`;
}

function factRow(locale: ViewerLocale, key: MessageKey, values: readonly string[]): TemplateResult {
    return html`<dt>${translate(locale, key)}</dt>
        ${values.map((value) => html`<dd>${value}</dd>`)}`;
}

/** The place's facts; nothing when it has none. */
export function placeFacts(poi: Poi, pois: readonly Poi[], locale: ViewerLocale, open: (poiId: string) => void): TemplateResult {
    const facts = poi.facts;
    if (facts === undefined) {
        return html``;
    }
    const rows = [...scalarRows(facts, locale), ...listRows(facts, locale)];
    return html`<section class="facts">
        <h3>${translate(locale, 'poi.facts')}</h3>
        <dl>
            ${rows.map(([key, values]) => factRow(locale, key, values))}
            ${related(facts, pois, locale, open)}
        </dl>
    </section>`;
}
