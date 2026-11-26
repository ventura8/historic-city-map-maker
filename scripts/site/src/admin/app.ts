import { appPageSource, appWorkerLines } from '@hcm/shared/app';

import { appFiles, appRelease, type AppFile } from '../app.js';
import { ADMIN_APP_SCRIPT_FILE, ADMIN_PAGE } from './page.js';
import { PUSH_SERVICE_WORKER_FILE, PUSH_SERVICE_WORKER_SOURCE } from './service-worker.js';

/**
 * The admin's installable app (`docs/ENGINE_API.md` → *Installable app*): one app at the admin's folder (`/admin/`: its
 * `start_url`, `scope` and `id`, apart from the public map's app at the site's root), named after the admin's page title in
 * its theme colour.
 *
 * - `app.webmanifest` and the three icons beside the page (`../app.ts`);
 * - `app.js`, the page's script that registers the worker and keeps the install prompt, which the account menu's **Install
 *   app** reads (`appPageSource`);
 * - the worker: a scope has one service worker, so the app's lines join the push worker, `firebase-messaging-sw.js`, whose
 *   name stays (existing push subscriptions survive). They keep nothing and answer nothing (`offline: false`): every
 *   `admin.mjs`, `runtime.json` and screen comes from the network as Hosting's `no-cache` says (lesson 707).
 */
const WORKER_LINES = appWorkerLines({ release: appRelease(PUSH_SERVICE_WORKER_SOURCE), offline: false });

/** The admin app's files: the push worker with the app's lines, the manifest, the icons and the page script. */
export const ADMIN_APP_FILES: readonly AppFile[] = [
    { to: PUSH_SERVICE_WORKER_FILE, content: `${PUSH_SERVICE_WORKER_SOURCE}${WORKER_LINES}` },
    ...appFiles({ title: ADMIN_PAGE.title, lang: ADMIN_PAGE.lang, themeColor: ADMIN_PAGE.themeColor }),
    { to: ADMIN_APP_SCRIPT_FILE, content: appPageSource({ worker: PUSH_SERVICE_WORKER_FILE, scope: './' }) },
];
