/**
 * The M6 installer's states of the tour inventory (docs/research/M6-interfaces.md §6.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them through e2e/tour/admin-sections.ts, section `install`): Install the server (d) ready,
 * at work with its steps and the functions' count, waiting on a retry, stopped with its log, offering an update and
 * newer than the admin with the confirmation of its override (the live finding of 2026-11-12), stopped at a permission of step c (finding 28 of 2026-10-31); a server record older than the
 * admin (finding 27); an older build of the same version recorded installed, offered as an update, and the admin's own
 * release with nothing to do and no consent note (findings 39 and 40 of 2026-11-01); the imagery pipeline (d3) at work,
 * stopped, installing on its own and not available from this admin's bundle (finding 43); Publish the map (i) off with its reason, ready and published; Home's tile of an
 * update. Each is reached by e2e/admin/specs/install/states.spec.ts at the admin tier's
 * five projects (three window classes, dark, English).
 */
const VISIT = 'specs/install/states.spec.ts';

export const INSTALL_STATES = {
    'setup.install-ready': { title: 'Setup, Install the server: why, the build minutes and the one button', visit: VISIT },
    'setup.install-working': {
        title: "Setup, the server's installation at work: its steps, the one under way and the functions' count",
        visit: VISIT,
    },
    'setup.install-retrying': { title: 'Setup, the server waiting for Google: what it waits for and when it tries again', visit: VISIT },
    'setup.install-failed': {
        title: 'Setup, the server stopped: the step, the last lines of its log redacted, the console link and Try again',
        visit: VISIT,
    },
    'setup.install-update': {
        title: "Setup, a server older than the admin's release: An update is ready, with Update the map",
        visit: VISIT,
    },
    'setup.install-newer': {
        title: "Setup, a server newer than this admin: reload the page, no Update, Install this admin's version anyway",
        visit: VISIT,
    },
    // The live finding of 2026-11-12: the owner's override over a newer server asks first.
    'setup.install-over-dialog': {
        title: 'Setup, the confirmation before installing over a newer server: what it replaces, Keep or Install',
        visit: VISIT,
    },
    // Findings 39 and 40 of 2026-11-01.
    'setup.install-update-recorded': {
        title: 'Setup, an older build of the same version recorded installed: Update the map, with the consent note',
        visit: VISIT,
    },
    'setup.install-nothing-to-do': {
        title: "Setup, the admin's own release installed: nothing offered and no consent note, Check again only",
        visit: VISIT,
    },
    'setup.pipeline-working': { title: "Setup, the imagery pipeline's installation at work with its steps", visit: VISIT },
    'setup.pipeline-failed': { title: 'Setup, the imagery pipeline stopped: its step, its log and Try again', visit: VISIT },
    'setup.pipeline-install': {
        title: 'Setup, the imagery pipeline missing beside an installed server: its own Install the pipeline',
        visit: VISIT,
    },
    // Finding 43 of 2026-11-01.
    'setup.pipeline-not-available': {
        title: "Setup, the imagery pipeline this admin's bundle cannot install: Not available yet, and no button",
        visit: VISIT,
    },
    // Finding 47 of 2026-11-01, reached by the functional spec of the pipeline (S-A56-HAPPY-JOBS-RATE-LIMITED, S-A56-BAD-JOBS-QUOTA).
    'setup.pipeline-retrying': {
        title: "Setup, the imagery pipeline waiting out Cloud Run's request rate: what it waits for and when it tries again",
        visit: 'steps/install/pipeline.spec.ts',
    },
    'setup.pipeline-quota': {
        title: 'Setup, the imagery pipeline stopped at a quota: the quota named, the Quotas page linked, the log and Try again',
        visit: 'steps/install/pipeline.spec.ts',
    },
    'setup.site-blocked': { title: 'Setup, Publish the map off: nothing published to show yet, and why', visit: VISIT },
    'setup.site-ready': { title: 'Setup, Publish the map: the address, what visitors see, the cost and the button', visit: VISIT },
    'setup.site-published': { title: 'Setup, the map published: the public address as a link and the release', visit: VISIT },
    'setup.install-failed-provision': {
        title: 'Setup, the server stopped at a permission step c grants: the fix with Retry what failed in step c, the log and Try again',
        visit: VISIT,
    },
    'setup.older-server-status': {
        title: 'Setup, a server record older than the admin: the steps it records read Update the server to check',
        visit: VISIT,
    },
    'home.update-tile': { title: 'Home: an update of the map is ready, with the link to its step in Setup', visit: VISIT },
    // Finding 65 of 2026-11-02, reached by the functional spec of updates (S-A04-HAPPY-UPDATE-PROVISION).
    'setup.install-update-provision': {
        title: 'Setup, a server in place on a project prepared before Provision changed: the settings the update applies, Update the map',
        visit: 'steps/install/update.spec.ts',
    },
    // Finding 70 and 59 of 2026-11-02: a build under way offers no update, and the card never says Not installed meanwhile.
    'setup.install-update-building': {
        title: "Setup, Install the server: the update's build under way, no Update the map and no Provision line beside it",
        visit: 'steps/install/update.spec.ts',
    },
    // The live finding of 2026-11-08 and the review of 6858f8a: a build recorded at work, before a look, says when it was
    // last seen and to check again, never that it runs or is being checked.
    'setup.install-last-seen': {
        title: 'Setup, Install the server: a build recorded at work, when it was last seen and Check again, no steps',
        visit: 'steps/install/checking.spec.ts',
    },
} as const;
