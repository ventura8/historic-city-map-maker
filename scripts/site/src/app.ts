import { createHash } from 'node:crypto';

import {
    APP_BUILD_FILE,
    APP_WORKER_FILE,
    WEB_APP_MANIFEST_FILE,
    appPageSource,
    appWorkerSource,
    webAppManifestText,
} from '@hcm/shared/app';

import { appIconFiles } from './app-icons.js';

/**
 * The installable app of a page the site build writes (`docs/ENGINE_API.md` → *Installable app*; lesson 711: Chrome and
 * Edge give the device's accent colour only to an installed web app): the files beside the page, and the lines of the
 * page's own script that start it.
 *
 * - `app.webmanifest`: named after the page's title, in its theme colour, its folder the app's start, scope and id;
 * - `app-icon-192.png`, `app-icon-512.png`, `app-icon-maskable-512.png` (`app-icons.ts`);
 * - `sw.js` for a city site (`appWorkerSource`: network first, a copy of the page and its shell only for a visit with no
 *   network); the admin appends its lines to its push worker instead (`admin/build.ts`), since a scope has one worker;
 * - `app-build.json` for a city site: the build Hosting serves, which the page script compares with its own to reload an
 *   open or installed map into a new deploy (`app-update.ts` of `@hcm/shared/app`).
 */

/** One file the app adds: generated text or bytes. */
export interface AppFile {
    readonly to: string;
    readonly content: string | Uint8Array;
}

/** What the app of a page is made of. */
export interface AppInputs {
    /** The page's title: the app's name. */
    readonly title: string;
    readonly lang: string;
    /** `#RRGGBB`: the page's theme colour (the app's title bar and its icons). */
    readonly themeColor: string;
}

/** The manifest and the icons beside a page. */
export function appFiles(inputs: AppInputs): AppFile[] {
    const manifest = webAppManifestText({ name: inputs.title, folder: './', lang: inputs.lang, themeColor: inputs.themeColor });
    return [{ to: WEB_APP_MANIFEST_FILE, content: manifest }, ...appIconFiles(inputs.themeColor)];
}

/** A release name for the worker's offline copy and the page's build: a digest of what the page is made of. */
export function appRelease(...parts: readonly (string | Uint8Array)[]): string {
    const hash = createHash('sha256');
    parts.forEach((part) => hash.update(part).update('\0'));
    return hash.digest('hex').slice(0, 16);
}

/** A city site's worker beside its page (`sw.js`). */
export function siteWorkerFile(release: string): AppFile {
    return { to: APP_WORKER_FILE, content: appWorkerSource({ release, offline: true }) };
}

/** A city site's `app-build.json`: the build Hosting serves now. */
export function siteBuildFile(build: string): AppFile {
    return { to: APP_BUILD_FILE, content: `${JSON.stringify({ build })}\n` };
}

/**
 * The lines of a city site's page script that register `sw.js` for the page's folder, keep the install prompt and reload
 * the page into a newer build than `build` (read from `app-build.json`).
 */
export function siteAppLines(build: string): string {
    return appPageSource({ worker: APP_WORKER_FILE, scope: './' }, { build, version: APP_BUILD_FILE });
}
