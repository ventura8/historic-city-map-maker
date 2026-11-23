/**
 * A building's plans by level in a place's Media (`docs/research/M17-stories.md` §14): a level picker (the kit's segmented
 * button, one segment per level, lowest first), then the chosen level's plans (buttons that show them on the map) and the interior photos taken on it.
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

/** The level picker and the chosen level's plans and photos; nothing without levels. */
export function planItems(input: PlansInput): TemplateResult {
    const chosen = input.levels.find((level) => level.order === input.chosen) ?? input.levels[0];
    if (chosen === undefined) {
        return html``;
    }
    // The kit's segmented button: a bare radio drew no border a visitor could see and was a 13 px target (the tour).
    const options = input.levels.map((level) => ({ value: String(level.order), label: levelLabel(level, input.locale) }));
    const choose = (event: CustomEvent<{ value: string }>): void => {
        input.choose(Number(event.detail.value));
    };
    return html`<hcm-segmented-button
            class="kinds levels"
            .options=${options}
            .value=${String(chosen.order)}
            .label=${translate(input.locale, 'poi.media.level')}
            @hcm-change=${choose}
        ></hcm-segmented-button>
        <ul class="maps">
            ${chosen.layers.map(input.plan)}
        </ul>
        <ul class="thumbs">
            ${chosen.photos.map(input.photo)}
        </ul>`;
}
