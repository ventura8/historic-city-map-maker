/**
 * The multi-city states of the tour inventory (M5, docs/research/M5-interfaces.md §1.5 to §1.8, §7.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them inside its cities section), ids `cities.<state>`: the city menu, an address of a city
 * the admin does not administer, the New city flow (its form, the city found by its name, an id no city may take, a
 * rectangle drawn, one too large, a taken id, the done screen), a city's admins as its owner and as an editor with the role question, Settings → the city's budget as the
 * project's owner and read-only, and Settings → Publishing (the integrator's cross-app journey). Each is reached by a
 * spec of `specs/cities/` at the admin tier's projects.
 */
export const CITIES_STATES = {
    'cities.switcher-menu': {
        title: 'The city menu: the cities of the admin, each with its role, the open one marked',
        visit: 'specs/cities/switcher.spec.ts',
    },
    'cities.not-member': {
        title: 'An address of a city the admin does not administer: their own city, the snackbar saying why',
        visit: 'specs/cities/switcher.spec.ts',
    },
    'cities.new': { title: 'New city: the names, the map to drag the area on, Create off', visit: 'specs/cities/new-city.spec.ts' },
    // The M5 UX review (docs/LESSONS.md 252): the name finds the city, its rectangle drawn for it.
    'cities.new-located': {
        title: 'New city: the city found by its name on OpenStreetMap, its rectangle drawn and named, Create on',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.new-id-invalid': {
        title: 'New city: an id no city may take, said at its field, Create off',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.new-drawing': {
        title: 'New city: the area dragged on the map, its edges in the fields, Create on',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.new-area-invalid': {
        title: 'New city: an area too large, the reason beside the map, Create off',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.new-id-taken': {
        title: 'New city: the id another city has, refused, with a free one in the field',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.created': {
        title: 'New city: created, unpublished, the first harvest under way, and what comes next',
        visit: 'specs/cities/new-city.spec.ts',
    },
    'cities.admins': {
        title: "Admins of a city, as its owner: each admin's role, Invite and the role field",
        visit: 'specs/cities/members.spec.ts',
    },
    'cities.admins-editor': {
        title: "Admins of a city, as an editor: the list only, and why (only the city's owners invite)",
        visit: 'specs/cities/members.spec.ts',
    },
    'cities.role-confirm': { title: 'Admins: "Make … owner of …?" (a dialog)', visit: 'specs/cities/members.spec.ts' },
    'cities.budget': {
        title: "Settings → the city's budget, as the project's owner, for a city held by the project's caps alone: the five fields, Save",
        visit: 'specs/cities/budgets.spec.ts',
    },
    'cities.budget-readonly': {
        title: "Settings → the city's budget, read-only: only the project's owner changes it",
        visit: 'specs/cities/budgets.spec.ts',
    },
    // The integrator (DECISIONS-for-review.md §63a): the switch that makes a new city public.
    'cities.publish': {
        title: 'Settings → Publishing: a new city not public yet, the switch and what switching it does',
        visit: 'specs/cities/city-journey.spec.ts',
    },
} as const;
