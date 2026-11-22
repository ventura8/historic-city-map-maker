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

export function placeLinksField(input: PlaceLinksInput): TemplateResult {
    const { id, locale, ids, readOnly, change } = input;
    const places = input.places ?? [];
    const titleOf = (placeId: string): string => titleIn(locale, places.find((place) => place.id === placeId), placeId);
    const set = (next: readonly string[]): void => {
        change(next.length === 0 ? undefined : next);
    };
    const add = (event: Event): void => {
        const select = event.target as HTMLSelectElement;
        if (select.value !== '') {
            set([...ids, select.value]);
        }
        select.value = '';
    };
    const full = ids.length >= MAX_MEDIA_PLACES;
    return html`<section class="field place-links">
        <h3 id=${`${id}-label`}>${contentText(locale, input.label ?? 'adminContent.pois.places.label')}</h3>
        <p class="note" id=${`${id}-hint`}>${contentText(locale, input.hint ?? 'adminContent.pois.places.hint')}</p>
        <ul class="chips" aria-labelledby=${`${id}-label`}>
            ${ids.map(
                (placeId) =>
                    html`<li>
                        <hcm-button
                            variant="outlined"
                            icon="close"
                            ?disabled=${readOnly}
                            .label=${contentText(locale, 'adminContent.pois.places.remove', { title: titleOf(placeId) })}
                            @click=${() => {
                                set(ids.filter((other) => other !== placeId));
                            }}
                            >${titleOf(placeId)}</hcm-button
                        >
                    </li>`,
            )}
        </ul>
        <label for=${id}>${contentText(locale, 'adminContent.pois.places.add')}</label>
        <select id=${id} aria-describedby=${`${id}-hint`} ?disabled=${readOnly || full || input.places === null} @change=${add}>
            <option value="">${contentText(locale, 'adminContent.pois.places.pick')}</option>
            ${places
                .filter((place) => !ids.includes(place.id))
                .map((place) => html`<option value=${place.id}>${titleIn(locale, place, place.id)}</option>`)}
        </select>
        ${full ? html`<p class="note">${contentText(locale, 'adminContent.pois.places.full', { max: String(MAX_MEDIA_PLACES) })}</p>` : html``}
    </section>`;
}
