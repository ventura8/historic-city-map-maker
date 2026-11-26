/**
 * The georeferencer's suggestions in the tour inventory (M4; docs/research/M4-interfaces.md §2.5, §7.3): `ADMIN_STATES`
 * of e2e/tour/states.ts spreads them inside its autogcp section, which keeps that file within its line limit. Each is
 * reached by e2e/admin/specs/imagery/suggestions.spec.ts at the admin tier's five projects, behind the tier's lock.
 */
export const SUGGESTIONS_STATES = {
    'georef.suggestions': {
        title: "Georeferencer: the matcher's suggestions, dashed on both panes, each with Accept and Reject",
        visit: 'specs/imagery/suggestions.spec.ts',
    },
    'georef.suggestions-accepted': {
        title: 'Georeferencer: every suggestion accepted into the pairs, unsaved, the fit refreshed',
        visit: 'specs/imagery/suggestions.spec.ts',
    },
    'georef.no-suggestions': {
        title: 'Georeferencer: a scan the matcher could not place, how many reliable pairs it found and no suggestion',
        visit: 'specs/imagery/suggestions.spec.ts',
    },
} as const;
