import { CITIES_STATES } from '../admin/specs/cities/states.js';
import { ARCHIVE_STATES } from '../admin/specs/imagery/archive-states.js';
import { ROLES_STATES } from '../admin/specs/roles/states.js';
import { EXPORT_STATES } from '../admin/specs/export/states.js';
import { JOIN_STATES } from '../admin/specs/imagery/join-states.js';
import { ORDERS_STATES } from '../admin/specs/imagery/orders-states.js';
import { SUGGESTIONS_STATES } from '../admin/specs/imagery/suggestions-states.js';
import { UNUSABLE_STATES } from '../admin/specs/imagery/unusable-states.js';
import { INSTALL_STATES } from '../admin/specs/install/states.js';
import { NOTIFY_STATES } from '../admin/specs/notify/states.js';
import { SETTINGS_ICON_STATES, SETTINGS_STARTER_STATES } from '../admin/specs/settings/states.js';
import { SETUP_UX_STATES } from '../admin/specs/shell/setup-ux-states.js';
import { START_STATES } from '../admin/specs/start/states.js';
import { LANGUAGE_PICKER_STATES } from '../admin/specs/shell/language-states.js';
import { STORIES_STATES } from '../admin/specs/stories/states.js';
import { TILES_STATES } from '../admin/specs/imagery/tiles-states.js';
import { WORKER_STATES } from '../admin/specs/imagery/worker-states.js';

/**
 * The admin states of the M4 and M5 workstreams in the tour inventory (`ADMIN_STATES` of ./states.ts spreads them; moved
 * here when ./states.ts reached its 600-line limit, docs/research/M5-interfaces.md → Change requests, CR-M5-15). Shared by
 * every workstream: one marked section each; a workstream adds its spread (and its import) inside its own section only.
 */
export const ADMIN_SECTION_STATES = {
    // M14 (docs/research/M14-start-your-map.md §11): ids 'start.<state>', the public start page.
    ...START_STATES,
    // The interface's 25 languages (docs/I18N.md): the admin right to left.
    ...LANGUAGE_PICKER_STATES,
    // M4 (docs/research/M4-interfaces.md §7.3): ids 'orders.<state>', 'georef.<state>' (the suggestions), 'notify.<state>'
    // and 'assist.<state>'; each workstream appends inside its own section as each state's journey lands (a spread from a
    // file of its own once a section grows, as the imagery section did).
    // [section orders] owner: orders
    ...ORDERS_STATES,
    // [end orders]
    // [section autogcp] owner: autogcp
    ...SUGGESTIONS_STATES,
    // [end autogcp]
    // [section notify] owner: assists-notify (the inbox, push on a device, the editors' assists)
    ...NOTIFY_STATES,
    // [end notify]
    // M5 (docs/research/M5-interfaces.md §7.3): ids 'cities.<state>' (the switcher, New city, the per-city admins, the city's
    // budget) and 'export.<state>'; each workstream appends inside its own section as each state's journey lands (a spread
    // from a file of its own, as the M4 sections are).
    // [section cities] owner: multi-city
    ...CITIES_STATES,
    ...ROLES_STATES,
    // [end cities]
    // [section stories] owner: stories (docs/research/M17-stories.md §6)
    ...STORIES_STATES,
    // [end stories]
    // [section export] owner: export (Settings → Export the city: docs/research/M5-interfaces.md §5.6)
    ...EXPORT_STATES,
    // [end export]
    // M6 (docs/research/M6-interfaces.md §6.3): one section per workstream (`install`, `site`, `setupUx`), each a spread.
    // [section setupUx] owner: setup-ux (the shell, the sign-in, the billing wait, USGS later, Home's reminders)
    ...SETUP_UX_STATES,
    // [end setupUx]
    // [section install] owner: installer (Install the server, the imagery pipeline, Publish the map, Home's update tile)
    ...INSTALL_STATES,
    // [end install]
    // [section starters] owner: settings (Settings → Place categories, Add the starter categories: finding 41 of 2026-11-01)
    ...SETTINGS_STARTER_STATES,
    // Settings → Browser tab icon (behaviour A101).
    ...SETTINGS_ICON_STATES,
    // [end starters]
    // M7 (docs/research/M7-local-worker.md §7): ids 'worker.<state>', the local worker's panel and a version's place.
    // [section worker] owner: admin (M7)
    ...WORKER_STATES,
    // [end worker]
    // M8 (docs/research/M8-join-interfaces.md §8): the join's date rows, offer and page, ids 'imagery.date-rows', 'imagery.join-<state>'.
    // [section join] owner: e2e (M8)
    ...JOIN_STATES,
    ...UNUSABLE_STATES,
    // [end join]
    // M20 (docs/research/M20-import-local.md §8): Import local files, an archive's report and progress, Settings' drawn maps, ids 'archive.<state>'.
    // [section archive] owner: archive (M20)
    ...ARCHIVE_STATES,
    // [end archive]
    // The tile-import wizard (docs/research/M20-import-local.md §19.11), ids 'tiles.<state>'.
    // [section tiles] owner: tilewizard
    ...TILES_STATES,
    // [end tiles]
} as const;
