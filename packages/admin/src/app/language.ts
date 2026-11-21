/**
 * The admin's language switch (`docs/I18N.md` → Loading): a language beyond Romanian and English is fetched from the
 * build's `i18n/` folder before the shell shows it; the choice is remembered (`localStorage` `hcm:admin:lang`, try/catch
 * inside the store) only once it has taken, and only while it is still the latest choice. A file that cannot be read keeps the language and says so in the snackbar.
 */
import { UI_LANGUAGE_NAMES, type UiLocale } from '@hcm/shared';

import { LANGUAGE_KEY } from '../state/locale.js';
import type { ShellStateAccess } from '../state/state.js';
import { isBundled, latestLanguage, uiCatalogueLoader, type LanguageSwitch, type UiCatalogueLoader } from '../state/ui-language.js';
import type { KeyValueStore } from './ports.js';

/** Where the admin's build writes the languages: `/admin/i18n/<locale>.json` on Hosting. */
const ADMIN_CATALOGUE_FOLDER = `${import.meta.env.BASE_URL}i18n/`;

export interface AdminLanguageDeps {
    readonly fetch: typeof fetch;
    readonly local: KeyValueStore;
    readonly shell: Pick<ShellStateAccess, 'update' | 'notice'>;
    /** The loader (tests: a stand-in); the build's folder by default. */
    readonly load?: UiCatalogueLoader;
}

export interface AdminLanguage {
    /** The admin's choice in the account menu: shown and remembered once its texts are here. */
    choose(locale: UiLocale): Promise<void>;
    /** The first language of the page (the address, the stored choice, the browser's), when it is not bundled. */
    start(wanted: UiLocale): Promise<void>;
}

export function adminLanguage(deps: AdminLanguageDeps): AdminLanguage {
    const load = deps.load ?? uiCatalogueLoader(deps.fetch, ADMIN_CATALOGUE_FOLDER);
    const unavailable = (locale: UiLocale): void => {
        const notice = deps.shell.notice({ key: 'adminShell.language.unavailable', params: { language: UI_LANGUAGE_NAMES[locale] } });
        deps.shell.update({ notice });
    };
    const show = (locale: UiLocale): void => {
        deps.shell.update({ locale });
    };
    const remembered: LanguageSwitch = {
        load,
        apply: (locale) => {
            deps.local.set(LANGUAGE_KEY, locale);
            show(locale);
        },
        unavailable,
    };
    // The boot's language and the menu's choices share one switch: the latest wins over a file still loading.
    const latest = latestLanguage();
    return {
        choose: (locale) => latest(remembered, locale),
        start: (wanted) => (isBundled(wanted) ? Promise.resolve() : latest({ load, apply: show, unavailable }, wanted)),
    };
}
