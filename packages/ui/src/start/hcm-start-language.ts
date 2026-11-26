import { isUiLocale, translateStart, UI_LANGUAGE_NAMES, UI_LOCALES_BY_NAME, type UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { defineOnce } from '../components/internal.js';
import { startStyles } from './start-styles.js';

const HCM_START_LANGUAGE_TAG = 'hcm-start-language';

/**
 * The start page's language picker, an element of its own (the header is a component beside the page's content): a native
 * list of the interface's languages (`docs/I18N.md` → The pickers), each by its own name and in its own `lang`. It shows
 * the page's language until the page has switched (`live`): a language whose texts cannot be fetched leaves it as it was.
 */
class HcmStartLanguage extends LitElement {
    static override readonly properties = { locale: { attribute: false }, choose: { attribute: false } };
    static override readonly styles = startStyles;

    declare locale: UiLocale;
    declare choose: ((locale: UiLocale) => void) | undefined;

    override render(): TemplateResult {
        const change = (event: Event): void => {
            const select = event.currentTarget as HTMLSelectElement;
            const chosen = select.value;
            select.value = this.locale;
            if (isUiLocale(chosen)) {
                this.choose?.(chosen);
            }
        };
        return html`<label class="language">
            <span>${translateStart(this.locale, 'start.language')}</span>
            <select .value=${live(this.locale)} @change=${change}>
                ${UI_LOCALES_BY_NAME.map(
                    (locale) =>
                        html`<option value=${locale} lang=${locale} ?selected=${locale === this.locale}>
                            ${UI_LANGUAGE_NAMES[locale]}
                        </option>`,
                )}
            </select>
        </label>`;
    }
}

export function defineHcmStartLanguage(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_START_LANGUAGE_TAG, HcmStartLanguage);
}
