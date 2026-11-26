/**
 * The M6 setup-ux states of the tour inventory (docs/research/M6-interfaces.md §6.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them through e2e/tour/admin-sections.ts, section `setupUx`): the admin's loading screen,
 * the start-up sign-in and a refused account's card, the billing card waiting for a new account and, linked, offering
 * This account is a free trial, a step busy with its
 * indicator in the chip, USGS left for later and Setup done with USGS's approval pending, the import's end said in the
 * snackbar, Home's reminders (USGS later, a likely free trial ending), and the server checks with an optional feature
 * off. Each is reached by its spec at the admin tier's five projects (three window classes, dark, English).
 */
export const SETUP_UX_STATES = {
    'shell.loading': {
        title: 'The admin loading: the indicator in the middle of a window it fits, no page scrollbar',
        visit: 'specs/shell/setup-layout.spec.ts',
    },
    'auth.start-up-sign-in': {
        title: 'Start-up mode: the sign-in card, centred from the medium window class, with its consent note',
        visit: 'specs/shell/setup-layout.spec.ts',
    },
    'auth.not-owner': {
        title: 'Start-up mode: an account that does not own the project, told on a centred card',
        visit: 'specs/shell/setup-layout.spec.ts',
    },
    'setup.provision-busy': {
        title: 'Setup, Prepare the project running: the loading indicator in place of the chip’s icon, Working…',
        visit: 'specs/shell/setup-layout.spec.ts',
    },
    'setup.billing-waiting': {
        title: 'Setup, billing: no account yet, Create a billing account and the wait in words with its last check',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'setup.billing-mark-trial': {
        title: 'Setup, billing linked: This account is a free trial, for an account Setup could not tell was one',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'setup.usgs-later': {
        title: 'Setup, USGS left for later: its chip says Later, the header says Setup is done with USGS for later',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'setup.done-usgs-pending': {
        title: "Setup done while USGS's M2M approval is pending, the USGS card saying since when",
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'setup.checks-optional-off': {
        title: 'Setup after Check again: the translation drafts off under Optional features, quietly, Setup still done',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    // §76f (the user's decision of 2026-11-01): Create the measurement reports and what it registered.
    'setup.analytics-reports': {
        title: 'Setup, analytics: Create the measurement reports done, saying how many were created and how many were there',
        visit: 'steps/analytics.spec.ts',
    },
    'setup.import-done': {
        title: 'Setup, the legacy import ended: the snackbar saying how many photos are on the map, with Open',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'home.usgs-later': {
        title: 'Home: the reminder that USGS is not set up yet, with Set up USGS',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    'home.trial-reminder': {
        title: 'Home: the likely free trial ends soon, with the upgrade link and It is a paid account',
        visit: 'specs/shell/setup-ux-states.spec.ts',
    },
    // The live test of 2026-10-31 and 2026-11-01 (findings 29, 32 and 34 of docs/research/manual-test-2026-10-25.md).
    'setup.loading': {
        title: 'Setup right after a reload: every step Checking…, the header Checking every step… with no count',
        visit: 'specs/shell/setup-reload-states.spec.ts',
    },
    'setup.provision-last-checked': {
        title: "Setup, Prepare the project after Check again without Google's permission: still Done, when it was last checked",
        visit: 'specs/shell/setup-reload-states.spec.ts',
    },
    'shell.new-release': {
        title: 'A newer admin was published while the tab was open: the banner above the page with Reload',
        visit: 'specs/shell/setup-reload-states.spec.ts',
    },
} as const;
