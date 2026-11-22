/**
 * The places a photo or a map layer belongs to (`placeIds`, `docs/research/M17-stories.md` §12): chips that remove one and a
 * select of the city's other places that adds one, at most `MAX_MEDIA_PLACES`. Titles are data, shown as text only.
 */
import { MAX_MEDIA_PLACES, type AdminContentKey, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { PlacePickPort } from './place-pick-port.js';


export interface PlaceLinksInput {
    /** The field's id prefix (`photo-places`, `layer-places`). */
    readonly id: string;
    readonly locale: UiLocale;
    readonly ids: readonly string[];
    /** The city's places; null while they load. */
    readonly places: readonly PlacePickPort[] | null;
    readonly readOnly: boolean;
    /** The new list; an empty list clears the field. */
    readonly change: (ids: readonly string[] | undefined) => void;
    /** The heading and the note; the photo's and the map's Places by default. */
    readonly label?: AdminContentKey;
    readonly hint?: AdminContentKey;
}

function titleIn(locale: UiLocale, place: PlacePickPort | undefined, id: string): string {
    if (place === undefined) {
        return id;
    }
    return locale === 'en' && place.title.en !== undefined && place.title.en !== '' ? place.title.en : place.title.ro;
}

function chip(input: PlaceLinksInput, placeId: string, title: string): TemplateResult {
    return html`<li>
        <hcm-button
            variant="outlined"
            icon="close"
            ?disabled=${input.readOnly}
            .label=${contentText(input.locale, 'adminContent.pois.places.remove', { title })}
            @click=${() => {
                const next = input.ids.filter((other) => other !== placeId);
                input.change(next.length === 0 ? undefined : next);
            }}
            >${title}</hcm-button
        >
    </li>`;
}

function option(locale: UiLocale, place: PlacePickPort): TemplateResult {
    return html`<option value=${place.id}>${titleIn(locale, place, place.id)}</option>`;
}

function fullNote(locale: UiLocale): TemplateResult {
    return html`<p class="note">${contentText(locale, 'adminContent.pois.places.full', { max: String(MAX_MEDIA_PLACES) })}</p>`;
}

/** The heading and the note of the field. */
function texts(input: PlaceLinksInput): readonly [string, string] {
    const label = input.label ?? 'adminContent.pois.places.label';
    const hint = input.hint ?? 'adminContent.pois.places.hint';
    return [contentText(input.locale, label), contentText(input.locale, hint)];
}

export function placeLinksField(input: PlaceLinksInput): TemplateResult {
    const { id, locale, ids } = input;
    const places = input.places ?? [];
    const add = (event: Event): void => {
        const select = event.target as HTMLSelectElement;
        if (select.value !== '') {
            input.change([...ids, select.value]);
        }
        select.value = '';
    };
    const full = ids.length >= MAX_MEDIA_PLACES;
    const off = [input.readOnly, full, input.places === null].includes(true);
    const [labelId, hintId] = [[id, 'label'].join('-'), [id, 'hint'].join('-')];
    const [label, hint] = texts(input);
    return html`<section class="field place-links">
        <h3 id=${labelId}>${label}</h3>
        <p class="note" id=${hintId}>${hint}</p>
        <ul class="chips" aria-labelledby=${labelId}>
            ${ids.map((placeId) => chip(input, placeId, titleIn(locale, places.find((place) => place.id === placeId), placeId)))}
        </ul>
        <label for=${id}>${contentText(locale, 'adminContent.pois.places.add')}</label>
        <select id=${id} aria-describedby=${hintId} ?disabled=${off} @change=${add}>
            <option value="">${contentText(locale, 'adminContent.pois.places.pick')}</option>
            ${places.filter((place) => !ids.includes(place.id)).map((place) => option(locale, place))}
        </select>
        ${full ? fullNote(locale) : html``}
    </section>`;
}
