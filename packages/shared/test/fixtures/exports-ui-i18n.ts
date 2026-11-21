/** The interface's twenty-five languages (`docs/I18N.md`): the public API of the locale list and the fallback, for `index.test.ts`. */
export const UI_I18N_EXPORTS = [
    'BUNDLED_LOCALES',
    'FALLBACK_LOCALE',
    'UI_LANGUAGE_NAMES',
    'UI_LOCALES',
    'UI_LOCALES_BY_NAME',
    'contentLocale',
    'directionOf',
    'familyLanguage',
    'fillPlaceholders',
    'hasRegisteredCatalogue',
    'isUiLocale',
    'textLanguage',
    'uiLocaleOf',
    'uiText',
];

/** Romanian and English (`LOCALES`, `translate`) and the logger, for `index.test.ts`. */
export const I18N_AND_LOGGING_EXPORTS = [
    'DEFAULT_LOCALE',
    'LOCALES',
    'REDACTED',
    'consoleSink',
    'createLogger',
    'pluralOf',
    'redact',
    'resolveLocale',
    'translate',
];

/** The viewer's languages (DECISIONS-for-review.md §218), for `index.test.ts`. */
export const VIEWER_I18N_EXPORTS = [
    'LANGUAGE_NAMES',
    'VIEWER_LOCALES',
    'catalogueText',
    'hasCatalogue',
    'intlTag',
    'isRtl',
    'localized',
    'registerCatalogue',
    'resolveViewerLocale',
    'shownLanguage',
    'viewerLocaleOf',
];
