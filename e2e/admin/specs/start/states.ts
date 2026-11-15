/**
 * The start page's states of the tour inventory (M14, `docs/research/M14-start-your-map.md` §11; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them), ids `start.<state>`, each reached by a spec of `specs/start/`.
 */
export const START_STATES = {
    'start.intro': {
        title: 'Start your map: what you get, the cost, the accounts, Google’s consent explained',
        visit: 'specs/start/start.spec.ts',
    },
    'start.closed': {
        title: 'Start your map before its client exists: the explanation and the terminal road, no button',
        visit: 'specs/start/start.spec.ts',
    },
    'start.plan': { title: 'Start your map: the city, its rectangle and the project', visit: 'specs/start/start.spec.ts' },
    'start.census': {
        title: 'Start your map: the city’s old images from above, counted, with the estimate, the price and a preview per decade',
        visit: 'specs/start/census.spec.ts',
    },
    'start.census-failed': {
        title: 'Start your map: the Landsat catalogue refused the search, the reason, what to do and Search again',
        visit: 'specs/start/census.spec.ts',
    },
    'start.plan-invalid': {
        title: 'Start your map: a rectangle too large and an id no project may take, said at their fields',
        visit: 'specs/start/start.spec.ts',
    },
    'start.work-failed': {
        title: 'Start your map: a step refused (Firebase’s terms), the link and Try again',
        visit: 'specs/start/start.spec.ts',
    },
    'start.provider': { title: 'Start your map: the one console click, its link and Check again', visit: 'specs/start/start.spec.ts' },
    'start.provider-unreadable': {
        title: 'Start your map: the provider could not be read, said apart from not yet, and the admin’s address',
        visit: 'specs/start/start.spec.ts',
    },
    'start.privacy': {
        title: 'Start your map: the privacy policy, Romanian then English, linked from the home page',
        visit: 'specs/start/legal.spec.ts',
    },
    'start.terms': { title: 'Start your map: the terms of service, Romanian then English', visit: 'specs/start/legal.spec.ts' },
    'start.landing': {
        title: 'The project’s landing page: what it is, Start your map, the terminal road and the example, in English',
        visit: 'specs/start/landing.spec.ts',
    },
    'start.landing-ro': {
        title: 'The project’s landing page in Romanian, reached from the English page’s language switch',
        visit: 'specs/start/landing.spec.ts',
    },
    'start.language-rtl': {
        title: 'Start your map in Urdu, right to left: the language list, the texts no Urdu file has yet in English',
        visit: 'specs/start/language.spec.ts',
    },
    'start.done': { title: 'Start your map: the admin is published, the address and what comes next', visit: 'specs/start/start.spec.ts' },
} as const;
