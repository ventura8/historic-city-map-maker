/**
 * The starter categories' states of the tour inventory (the live manual test of 2026-11-01, finding 41; `ADMIN_STATES`
 * of e2e/tour/states.ts spreads them through e2e/tour/admin-sections.ts, since states.ts is at its line limit), ids
 * `settings.<state>`: Settings → Place categories after **Add the starter categories** added the missing ones, and with
 * every starter already there, the action off with its reason. Both are reached by e2e/tour/admin-settings.tour.ts.
 */
export const SETTINGS_STARTER_STATES = {
    'settings.categories-starters-added': {
        title: 'Settings: the missing starter categories added, the snackbar says how many',
        visit: 'tour/admin-settings.tour.ts',
    },
    'settings.categories-starters-present': {
        title: 'Settings: every starter category there, Add the starter categories off with the reason',
        visit: 'tour/admin-settings.tour.ts',
    },
} as const;

/**
 * Settings → Browser tab icon (behaviour A101), ids `settings.icon-<state>`: the default the build drew, an upload, and a
 * refusal beside the buttons. All three are reached by e2e/admin/specs/settings/icon.spec.ts.
 */
export const SETTINGS_ICON_STATES = {
    'settings.icon-default': {
        title: 'Settings → Browser tab icon: the default (the map glyph in the city colour), Upload an image',
        visit: 'specs/settings/icon.spec.ts',
    },
    'settings.icon-custom': {
        title: 'Settings → Browser tab icon: an uploaded icon, tagged Custom, with Use the default icon',
        visit: 'specs/settings/icon.spec.ts',
    },
    'settings.icon-refused': {
        title: 'Settings → Browser tab icon: an SVG refused with its plain message beside the buttons',
        visit: 'specs/settings/icon.spec.ts',
    },
} as const;

/**
 * Settings → Wikipedia (behaviour A230, M31), ids `settings.wikipedia-<state>`: the card with its articles, and the last fetch's
 * failure with what to do. Both are reached by e2e/admin/specs/settings/wikipedia.spec.ts.
 */
export const SETTINGS_WIKIPEDIA_STATES = {
    'settings.wikipedia-articles': {
        title: 'Settings → Wikipedia: the switch, the languages, when the articles were fetched and each article with Hide',
        visit: 'specs/settings/wikipedia.spec.ts',
    },
    'settings.wikipedia-failed': {
        title: 'Settings → Wikipedia: the last fetch failed, the card says why and to press Refresh now later',
        visit: 'specs/settings/wikipedia.spec.ts',
    },
} as const;
