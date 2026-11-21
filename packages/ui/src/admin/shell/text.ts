/**
 * The admin's texts (`docs/research/M2b-interfaces.md` §1.6): a notice key may come from the shell's catalogue
 * (`adminShell.*`), the Setup Assistant's (`adminSetup.*`), the editors' (`adminContent.*`, M2c) or the API's error
 * codes (`apiError.*`). The language and
 * theme choices reuse the viewer's words (`language.*`, `theme.*`, `consent.*`, through `translate`). Elements receive no
 * free text from the app: every message shown goes through here.
 */
import {
    familyLanguage,
    isApiErrorCode,
    textLanguage,
    translateAdminContent,
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminContentKey,
    type AdminSetupKey,
    type AdminShellKey,
    type UiLocale,
} from '@hcm/shared';

import type { AdminNoticeInputPort, AdminNoticeKey, AdminRouteIdPort } from '../admin-port.js';

type Params = Readonly<Record<string, string>>;

/** A shell text. */
export function shellText(locale: UiLocale, key: AdminShellKey, params?: Params): string {
    return translateAdminShell(locale, key, params);
}

/** An editor text (`docs/research/M2c-interfaces.md` §10.1). */
export function contentText(locale: UiLocale, key: AdminContentKey, params?: Params): string {
    return translateAdminContent(locale, key, params);
}

function isSetupKey(key: AdminNoticeKey): key is AdminSetupKey {
    return key.startsWith('adminSetup.');
}

function isContentKey(key: AdminNoticeKey): key is AdminContentKey {
    return key.startsWith('adminContent.');
}

/** Any admin message key, by its family. */
export function noticeText(locale: UiLocale, key: AdminNoticeKey, params?: Params): string {
    if (isApiErrorCode(key)) {
        return translateApiError(locale, key, params);
    }
    if (isContentKey(key)) {
        return contentText(locale, key, params);
    }
    return isSetupKey(key) ? translateAdminSetup(locale, key, params) : shellText(locale, key, params);
}

/** A notice as text (none: empty). */
export function noticeOf(locale: UiLocale, notice: AdminNoticeInputPort | null): string {
    return notice === null ? '' : noticeText(locale, notice.key, notice.params);
}

/** The family of each page's texts, by its keys' prefix: `adminContent.<route>.` unless named here. */
const PAGE_FAMILIES: Readonly<Partial<Record<AdminRouteIdPort, string>>> = {
    home: 'adminShell.home.',
    setup: 'adminSetup.',
    inbox: 'adminContent.notify.',
};

/**
 * The `lang` of the page's area (`docs/I18N.md` → Fallback): the admin's language once its file holds the page's family,
 * else English, which every text of the page then shows in (WCAG 3.1.2: a screen reader reads it with an English voice).
 */
export function pageLanguage(locale: UiLocale, route: AdminRouteIdPort): UiLocale {
    return familyLanguage(locale, PAGE_FAMILIES[route] ?? `adminContent.${route}.`);
}

/** The `lang` of an element showing one shell text: the admin's language, or English when the text falls back to it. */
export function shellLanguage(locale: UiLocale, key: AdminShellKey): UiLocale {
    return textLanguage(locale, key);
}
