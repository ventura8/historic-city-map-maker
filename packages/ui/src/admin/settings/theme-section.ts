/**
 * The theme section (`docs/research/M2c-interfaces.md` §8.5; behaviour A19): the city's seed colour as a hex field, the
 * browser's colour picker and eight presets; each change makes the four M3 schemes at once and the whole admin wears
 * them (the shell's preview, CR-M2c-28) until Save or Discard. An invalid colour is said at the
 * field; a seed whose schemes fail the contrast check is moved to the nearest passing tone with a warning
 * (S-A19-BAD-LOW-CONTRAST-SEED). Below, the visitors' basemap: Standard or Standard Satellite (the admin's map always
 * stays Standard).
 */
import type { CityDoc } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';
import type { BasemapChoicePort } from './settings-port.js';

/** The same eight seeds as the store's presets (`SEED_PRESETS`). */
const PRESETS = ['#8b5e3c', '#6750a4', '#006a6a', '#3f6836', '#9c4146', '#00658f', '#7d5700', '#5b5f72'] as const;

const BASEMAPS: readonly BasemapChoicePort[] = ['standard', 'standard-satellite'];

const STYLES: Readonly<Record<BasemapChoicePort, string>> = {
    standard: 'mapbox://styles/mapbox/standard',
    'standard-satellite': 'mapbox://styles/mapbox/standard-satellite',
};

function seedFields(context: SectionContext, seed: string): TemplateResult {
    const { locale, intents } = context;
    const theme = context.view.citySection.theme;
    const typed = theme.typed === '' ? seed : theme.typed;
    const input = (event: Event): void => {
        intents?.setSeed((event.target as HTMLInputElement).value);
    };
    return html`<div class="fields">
            <div class="field" ?data-invalid=${theme.invalid}>
                <label for="seed-hex">${contentText(locale, 'adminContent.settings.seedHex')}</label>
                <input
                    id="seed-hex"
                    type="text"
                    ?readonly=${context.readOnly}
                    .value=${typed}
                    aria-invalid=${theme.invalid ? 'true' : 'false'}
                    aria-describedby=${theme.invalid ? 'seed-error' : nothing}
                    @input=${input}
                />
                ${theme.invalid ? html`<span class="error" id="seed-error">${contentText(locale, 'adminContent.settings.seedInvalid')}</span>` : nothing}
            </div>
            <div class="field">
                <label for="seed-picker">${contentText(locale, 'adminContent.settings.seedPicker')}</label>
                <input id="seed-picker" class="color" type="color" ?disabled=${context.readOnly} .value=${seed} @input=${input} />
            </div>
        </div>
        <div class="presets" role="group" aria-label=${contentText(locale, 'adminContent.settings.presets')}>
            ${PRESETS.map(
                (preset) =>
                    html`<button
                        type="button"
                        class="preset"
                        ?disabled=${context.readOnly}
                        aria-pressed=${preset === seed ? 'true' : 'false'}
                        aria-label=${contentText(locale, 'adminContent.settings.preset', { hex: preset })}
                        ${cssProperties({ '--preset': preset })}
                        @click=${() => intents?.setSeed(preset)}
                    ></button>`,
            )}
        </div>`;
}

function warnings(context: SectionContext, seed: string): TemplateResult {
    const { locale } = context;
    const theme = context.view.citySection.theme;
    return html`${
            theme.adjusted
                ? html`<p class="alert" role="alert">
                      <span>${contentText(locale, 'adminContent.settings.seedAdjusted', { hex: seed })}</span>
                  </p>`
                : nothing
        }
        <p class="note status" role="status">
            ${theme.preview === null ? '' : contentText(locale, 'adminContent.settings.themePreview')}
        </p>`;
}

function basemap(context: SectionContext, style: string): TemplateResult {
    const { locale, intents } = context;
    const custom = !BASEMAPS.some((choice) => STYLES[choice] === style);
    return html`<section class="group">
        <h3 id="basemap-heading">${contentText(locale, 'adminContent.settings.basemap')}</h3>
        <div class="choices" role="radiogroup" aria-labelledby="basemap-heading">
            ${BASEMAPS.map(
                (choice) =>
                    html`<label class="choice">
                        <input
                            class="touch-target"
                            type="radio"
                            name="basemap"
                            ?disabled=${context.readOnly}
                            .checked=${STYLES[choice] === style}
                            @change=${() => intents?.setBasemap(choice)}
                        />
                        <span>${contentText(locale, `adminContent.settings.basemap.${choice}`)}</span>
                    </label>`,
            )}
        </div>
        ${custom ? html`<p class="note">${contentText(locale, 'adminContent.settings.basemapCustom')}</p>` : nothing}
        <p class="note">${contentText(locale, 'adminContent.settings.basemapNote')}</p>
    </section>`;
}

export function themeSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    if (city === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'theme')}</h2>`;
    }
    const seed = seedOf(city);
    return html`${cityHead(context, sectionTitle(locale, 'theme'))}
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.seed')}</h3>
            ${seedFields(context, seed)} ${warnings(context, seed)}
        </section>
        ${basemap(context, city.basemap === undefined ? STYLES.standard : city.basemap.style)}`;
}

/** The city's seed colour as the fields show it (the sepia preset before it has one). */
function seedOf(city: CityDoc): string {
    return city.theme === undefined ? PRESETS[0] : city.theme.seedColor.toLowerCase();
}
