/**
 * The store's language switch (V11; docs/ENGINE_API.md → Language, docs/research/DECISIONS-for-review.md §218): the
 * visitor's language shows once its texts are here (at once when they are); the latest choice wins over one still
 * loading; a language that cannot be fetched leaves the page as it was, with `language.unavailable` in its language.
 */
import { hasCatalogue, type ViewerLocale } from '@hcm/shared';

import type { BootHost } from './boot.js';

export class LocaleSwitch {
    readonly #host: BootHost;
    readonly #fetch: (locale: ViewerLocale) => Promise<boolean>;
    /** The language the visitor chose last, while its texts may still be loading. */
    #wanted: ViewerLocale | null = null;

    constructor(host: BootHost, fetch: (locale: ViewerLocale) => Promise<boolean>) {
        this.#host = host;
        this.#fetch = fetch;
    }

    choose(locale: ViewerLocale): void {
        this.#wanted = locale;
        if (hasCatalogue(locale)) {
            this.#commit(locale, true);
            return;
        }
        void this.#fetch(locale).then((ok) => {
            this.#commit(locale, ok);
        });
    }

    /** The latest choice shows once its texts are here, or a toast says they could not be fetched. */
    #commit(locale: ViewerLocale, ok: boolean): void {
        if (this.#wanted !== locale) {
            return;
        }
        if (!ok) {
            this.#host.showToast('language.unavailable');
        } else if (locale !== this.#host.getState().locale) {
            this.#switchTo(locale);
        }
    }

    /** The language changes: the state, `locale_change`, the city's stored choice, the hash. */
    #switchTo(locale: ViewerLocale): void {
        const host = this.#host;
        host.set({ ...host.getState(), locale });
        host.deps.telemetry.logEvent({ name: 'locale_change', locale });
        host.preferences.set(host.getState().manifest?.city.id ?? host.deps.config.cityId, 'lang', locale);
        host.hash.schedule();
    }
}
