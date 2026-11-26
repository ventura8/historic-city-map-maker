import { UI_LANGUAGE_NAMES, UI_LOCALES_BY_NAME } from '@hcm/shared';

import type { SegmentOption } from './segmented-button.js';

/**
 * The interface's languages as the language dropdown's options (`<hcm-language-select>`) (`docs/I18N.md` → The pickers): each by its own name, marked
 * with its own `lang` (WCAG 3.1.2), in the same order in every language (`UI_LOCALES_BY_NAME`). The admin's account menu,
 * the Setup Assistant (inside the admin's shell) and the start page show it; the viewer's Settings lists its own languages.
 */
export const UI_LANGUAGE_OPTIONS: readonly SegmentOption[] = UI_LOCALES_BY_NAME.map((value) => ({
    value,
    label: UI_LANGUAGE_NAMES[value],
    lang: value,
}));
