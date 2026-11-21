/** The note under a city's text that the visitor's language does not have yet (docs/ENGINE_API.md → Language). */
import { LANGUAGE_NAMES, shownLanguage, translate, type CityText, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';

/** "Text language: English (not translated yet)" when `text` falls back from `locale`, else nothing. */
export function fallbackNote(text: CityText, locale: ViewerLocale): TemplateResult {
    const shown = shownLanguage(text, locale);
    return shown === locale
        ? EMPTY
        : html`<p class="supporting fallback-note">${translate(locale, 'content.fallback', { language: LANGUAGE_NAMES[shown] })}</p>`;
}
