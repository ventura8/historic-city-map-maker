/**
 * Not useful's states of the tour inventory (behaviour A152; the owner's report of 2026-11-13; `ADMIN_SECTION_STATES` of
 * e2e/tour/admin-sections.ts spreads them), each reached by the spec named in `visit` at the admin tier's projects, behind the
 * tier's lock.
 */
export const UNUSABLE_STATES = {
    'imagery.scene-cloudy': {
        title: 'Historical imagery: a scan to buy its preview shows probably cloudy over the city, the warning, Not useful and its reasons',
        visit: 'specs/imagery/unusable.spec.ts',
    },
    'imagery.scene-unusable': {
        title: 'Historical imagery: a scan marked not useful (clouds), what that did and Undo',
        visit: 'specs/imagery/unusable.spec.ts',
    },
} as const;
