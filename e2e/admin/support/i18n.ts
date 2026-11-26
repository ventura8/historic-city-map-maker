import {
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminSetupKey,
    type AdminShellKey,
    type ApiErrorCode,
} from '@hcm/shared';
import { translateAdminSources, type AdminSourcesKey } from '@hcm/shared/admin-sources';

/**
 * The admin's texts as the user reads them (docs/research/M2b-interfaces.md §1.6): specs find controls by role and
 * their catalogue text, in the project's language, never by a hard-coded string.
 */

/** A shell text (`adminShell.*`): navigation, sign-in, the claim, Google's permissions. */
export function shellText(lang: 'ro' | 'en', key: AdminShellKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminShell(lang, key, params);
}

/** A Setup Assistant text (`adminSetup.*`). */
export function setupText(lang: 'ro' | 'en', key: AdminSetupKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminSetup(lang, key, params);
}

/** M28: a text of the Platform and Sources cards (`adminSources.*`). */
export function sourcesText(lang: 'ro' | 'en', key: AdminSourcesKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminSources(lang, key, params);
}

/** A server error's message (`apiError.*`), as a card shows the reason a callable gave. */
export function apiText(lang: 'ro' | 'en', code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return translateApiError(lang, code, params);
}

/**
 * A catalogue text as a pattern: each `{param}` of the template matches any text (a date, a percentage), the rest
 * literally. `text` is the template translated with every parameter set to `\u0000`.
 */
export function templatePattern(text: string): RegExp {
    const escape = (part: string): string => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${text.split('\u0000').map(escape).join('.+')}$`);
}
