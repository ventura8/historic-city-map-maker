/**
 * The language picker's states of the tour inventory (docs/I18N.md; `ADMIN_STATES` of e2e/tour/states.ts spreads them through
 * e2e/tour/admin-sections.ts), each reached by e2e/admin/specs/shell/languages.spec.ts.
 */
export const LANGUAGE_PICKER_STATES = {
    'shell.language-rtl': {
        title: 'The admin in Arabic, right to left: the shell mirrored, the texts no Arabic file has yet in English',
        visit: 'specs/shell/languages.spec.ts',
    },
} as const;
