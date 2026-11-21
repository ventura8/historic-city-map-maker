/**
 * The admin's language (`docs/research/M2b-interfaces.md` §1.6, `docs/I18N.md`): `?lang=fr` (any of the interface's
 * languages), then the stored choice (`localStorage` `hcm:admin:lang`), then the browser's first language, then Romanian.
 * Switching keeps every form's state (the shell only re-renders its texts); `<html lang>` and `dir` follow it.
 */
import { DEFAULT_LOCALE, isUiLocale, uiLocaleOf, type UiLocale } from '@hcm/shared';

export const LANGUAGE_KEY = 'hcm:admin:lang';

/** The `lang` parameter of `search` when it names a supported language. */
function queryLocale(search: string): UiLocale | null {
    const value = new URLSearchParams(search).get('lang');
    return isUiLocale(value) ? value : null;
}

export function resolveAdminLocale(search: string, stored: string | null, languages: readonly string[]): UiLocale {
    return queryLocale(search) ?? (isUiLocale(stored) ? stored : (uiLocaleOf(languages[0]) ?? DEFAULT_LOCALE));
}
