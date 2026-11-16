/**
 * The operations screens' states of the tour inventory (`ADMIN_STATES` of e2e/tour/states.ts spreads them inside its ops
 * section, which keeps that file within its line limit): ids `<screen>.<state>` (docs/research/M2c-interfaces.md §12.2),
 * each reached by the spec or tour file named in `visit`.
 */
export const OPS_STATES = {
    'home.dashboard': {
        title: "Home: the city's counts, what waits, the services' chips and the public map",
        visit: 'specs/ops/ops.spec.ts, the dashboard',
    },
    'home.skipped': {
        title: 'Home: Not on the public map, a skipped layer with its first issue and its link',
        visit: 'specs/ops/skipped.spec.ts',
    },
    'home.costs': {
        title: 'Home: Monthly costs, each paid service with its month so far, forecast and console, past the budget',
        visit: 'specs/ops/costs.spec.ts',
    },
    'jobs.empty': { title: 'Jobs: none yet', visit: 'tour/admin-jobs.tour.ts' },
    'jobs.list': { title: 'Jobs: the live list with its status chips', visit: 'tour/admin-jobs.tour.ts' },
    'jobs.detail': {
        title: "Jobs: a running job's progress, steps and log (full screen on a phone)",
        visit: 'tour/admin-jobs.tour.ts',
    },
    'jobs.cancel-confirm': { title: 'Jobs: "Cancel this job?" (a dialog)', visit: 'tour/admin-jobs.tour.ts' },
    'history.recent': { title: "History: the city's recent changes with their filters", visit: 'tour/admin-history.tour.ts' },
    'history.deleted': { title: 'History: the Deleted filter, each with Restore', visit: 'tour/admin-history.tour.ts' },
    'history.revert-confirm': {
        title: 'History: "Restore what was deleted?" (a dialog)',
        visit: 'tour/admin-history.tour.ts',
    },
    'history.document': {
        title: "History: a place's versions and the selected one's fields before and after",
        visit: 'tour/admin-history.tour.ts',
    },
    'history.revert-refused': {
        title: 'History: a refused revert, with its reason as an alert',
        visit: 'tour/admin-history.tour.ts',
    },
    'admins.list': { title: 'Admins: the admins and the pending invitations', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.detail': { title: "Admins: an admin's detail with Remove access", visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.revoke-confirm': { title: 'Admins: "Remove access for …?" (a dialog)', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.invite': { title: 'Admins: the Invite dialog with an address refused at the field', visit: 'specs/ops/ops.spec.ts, admins' },
    'admins.invite-link': { title: 'Admins: the new invitation with its sign-in link and Copy', visit: 'specs/ops/ops.spec.ts, admins' },
    'crashes.empty': { title: 'Crash reports: none in the period', visit: 'specs/ops/ops.spec.ts, crash reports' },
    'crashes.list': { title: "Crash reports: a period's error groups", visit: 'specs/ops/ops.spec.ts, crash reports' },
    'crashes.detail': {
        title: "Crash reports: a group's counts, first and last seen, and the console link",
        visit: 'specs/ops/ops.spec.ts, crash reports',
    },
    'crashes.error': {
        title: 'Crash reports: Error Reporting disabled, with the way to Setup',
        visit: 'specs/ops/ops.spec.ts, crash reports',
    },
    'crashes.statistics': {
        title: "Statistics: the guide opened (each wizard's steps and the way to its funnel in Google Analytics; statistics off: the way to Setup)",
        visit: 'specs/ops/ops.spec.ts, statistics',
    },
    'crashes.statistics-numbers': {
        title: "Statistics: Google Analytics' numbers after the read-only consent (stat cards, apps, bar lists, step bars) and Error Reporting's cards",
        visit: 'specs/ops/statistics.spec.ts, the numbers',
    },
    'crashes.statistics-problem': {
        title: 'Statistics: the Data API off, said with Setup and the console as the fix',
        visit: 'specs/ops/statistics.spec.ts, the Data API off',
    },
    'crashes.statistics-pending': {
        title: 'Statistics: numbers read with the measurement names Google Analytics cannot use yet, said with when to look again',
        visit: 'specs/ops/statistics.spec.ts, names not ready',
    },
} as const;
