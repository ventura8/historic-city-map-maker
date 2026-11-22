/**
 * A building's plans by level in a place's Media (`docs/research/M17-stories.md` §14): a level picker (one radio per level,
 * lowest first), then the chosen level's plans (buttons that show them on the map) and the interior photos taken on it.
 */
import { localized, translate, type PlaceMedia, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

type Level = PlaceMedia['plans'][number];

export interface PlansInput {
    readonly levels: readonly Level[];
    /** The chosen level's order; null or unknown, the lowest. */
    readonly chosen: number | null;
    readonly locale: ViewerLocale;
    readonly choose: (order: number) => void;
    readonly plan: (layer: Level['layers'][number]) => TemplateResult;
    readonly photo: (photo: Level['photos'][number]) => TemplateResult;
}

function levelLabel(level: Level, locale: ViewerLocale): string {
    return localized({ en: level.label.ro, ...level.label }, locale);
}

function levelRadio(input: PlansInput, level: Level, chosen: Level): TemplateResult {
    return html`<label
        ><input
            type="radio"
            name="level"
            .checked=${level.order === chosen.order}
            @change=${() => {
                input.choose(level.order);
            }}
        />${levelLabel(level, input.locale)}</label
    >`;
}

/** The level picker and the chosen level's plans and photos; nothing without levels. */
export function planItems(input: PlansInput): TemplateResult {
    const chosen = input.levels.find((level) => level.order === input.chosen) ?? input.levels[0];
    if (chosen === undefined) {
        return html``;
    }
    return html`<fieldset class="kinds levels">
            <legend class="visually-hidden">${translate(input.locale, 'poi.media.level')}</legend>
            ${input.levels.map((level) => levelRadio(input, level, chosen))}
        </fieldset>
        <ul class="maps">
            ${chosen.layers.map(input.plan)}
        </ul>
        <ul class="thumbs">
            ${chosen.photos.map(input.photo)}
        </ul>`;
}
