/**
 * M13's states of the tour inventory (docs/research/M13-roles.md §8; `ADMIN_STATES` of e2e/tour/states.ts spreads them), ids
 * `roles.<state>`, each reached by e2e/admin/specs/roles/roles.spec.ts (the welcome: welcome.spec.ts) at the admin tier's projects.
 */
export const ROLES_STATES = {
    'roles.contribute-welcome': {
        title: "The Contribute page signed out: a contributor's welcome, never the admin's sign-in",
        visit: 'specs/roles/welcome.spec.ts',
    },
    'roles.contribute-resting': {
        title: 'The Contribute page when the server does not answer: the map rests, Try again and Back to the map',
        visit: 'specs/roles/welcome.spec.ts',
    },
    'roles.contribute-closed': {
        title: 'The Contribute page of a map nobody set up: not open to contributions yet',
        visit: 'specs/roles/welcome.spec.ts',
    },
    'roles.contribute-request': { title: 'The Contribute page: asking for a role', visit: 'specs/roles/roles.spec.ts' },
    'roles.contribute-pending': { title: 'The Contribute page: the request waits', visit: 'specs/roles/roles.spec.ts' },
    'roles.contribute-refused': {
        title: 'The Contribute page: a refused person is told, with the note',
        visit: 'specs/roles/roles.spec.ts',
    },
    'roles.contribute-place': { title: 'The Contribute page: where was this photo taken', visit: 'specs/roles/roles.spec.ts' },
    'roles.contribute-correct': {
        title: "The Contribute page: contesting a placed photo's date, place or direction",
        visit: 'specs/roles/roles.spec.ts',
    },
    'roles.review': { title: 'The review queue: contributions, suggestions, requests', visit: 'specs/roles/roles.spec.ts' },
    'roles.review-compare': { title: 'The review queue: the photo now and as proposed, on the map', visit: 'specs/roles/roles.spec.ts' },
    'roles.review-adjust': { title: 'The review queue: adjusting every value by hand', visit: 'specs/roles/roles.spec.ts' },
    'roles.review-block-question': { title: 'The review queue: blocking an account asks first', visit: 'specs/roles/roles.spec.ts' },
    'roles.review-blocked': { title: 'The review queue: blocked accounts, and the way back', visit: 'specs/roles/roles.spec.ts' },
    'roles.contribute-ask-more': { title: 'The Contribute page: a member who may ask for more', visit: 'specs/roles/roles.spec.ts' },
    'roles.moderator-nav': {
        title: "A moderator's navigation, and a page their role does not include",
        visit: 'specs/roles/roles.spec.ts',
    },
    'roles.uploader-photos': {
        title: "An uploader's photos: their own only, each saying where it stands",
        visit: 'specs/roles/roles.spec.ts',
    },
} as const;
