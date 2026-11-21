/**
 * Where the admin runs (the owner's decision of 2026-11-13, `DECISIONS-for-review.md` §210): on the project's own admin
 * site (`https://<project>-admin.web.app/admin/`), whose origin no public map page shares, or under the public map's
 * `/admin/` (a project without that site: a self-hosted copy, a first deploy, a site the installer could not create). The
 * site build writes the admin site's origin into the `runtime.json` it deploys there (`adminOrigin`), so the admin is on
 * its own site exactly when the page's origin is that one: nothing a viewer page serves can make an admin think so.
 */
import { adminSiteId } from '@hcm/shared';

import { hostingOrigins } from '../install/bundle.js';
import type { AdminRuntime } from './config.js';

/** Whether the page runs on the admin's own site: `runtime.json` names this very origin. */
export function onOwnSite(runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): boolean {
    return runtime.adminOrigin !== undefined && runtime.adminOrigin === origin;
}

/** The admin's own Hosting site id (`<project>-admin`) when the page runs on it, else null. */
export function ownSiteId(projectId: string, runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): string | null {
    return onOwnSite(runtime, origin) ? adminSiteId(projectId) : null;
}

/** `runtime.json`'s release and build time, as the Setup Assistant installs them (M6; finding 39 of 2026-11-01). */
export function adminReleaseFields(runtime: Pick<AdminRuntime, 'release' | 'releaseTime'>): {
    readonly release: string;
    readonly releaseTime: number | null;
} {
    return { release: runtime.release, releaseTime: runtime.releaseTime ?? null };
}

/**
 * Where the admin may install from (the project's Hosting origins, the admin's own site's among them; the e2e world's own
 * origin in its build) and the admin's own site when the page runs on it, which the server build then names to the
 * functions (`HCM_ADMIN_SITE`): only a page served from that site proves the site is this project's.
 */
export function installPlace(
    projectId: string,
    runtime: Pick<AdminRuntime, 'adminOrigin'>,
    origin: string,
    production: boolean,
): { readonly installOrigins: readonly string[]; readonly adminSite: string | null } {
    return { installOrigins: production ? hostingOrigins(projectId) : [origin], adminSite: ownSiteId(projectId, runtime, origin) };
}
