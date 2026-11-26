/**
 * The admin's own web address (the owner's decision of 2026-11-13, `docs/research/M6-interfaces.md` addendum "The admin on
 * its own site", `DECISIONS-for-review.md` §73a and §210): a second Firebase Hosting site of the same project,
 * `<project>-admin`, serves the admin, so its origin holds nothing a public map page could read and the sign-in may live
 * in the origin's IndexedDB (one sign-in for every tab, kept when Chrome closes). The public map stays on the project's
 * default site. Every part derives the same id from the project's (`adminSiteId`); the pipeline's worker has its twin
 * (`hcm_pipeline/worker/args.py` `admin_site_id`), pinned to the same cases by both test suites.
 */

/** The suffix of the admin's site id. */
export const ADMIN_SITE_SUFFIX = '-admin';

/**
 * The longest site id the installer asks Hosting for: Hosting's own limit is not documented in its REST reference
 * (**UNVERIFIED**), and the console's new-site form refuses more than 30 characters, the same as a project id's.
 */
export const ADMIN_SITE_MAX_LENGTH = 30;

/** A Hosting site id: lowercase letters, digits and hyphens, a letter first, no hyphen last. */
export const SITE_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * The admin's site id for `projectId`: `<project>-admin`, or, for a project id longer than 24 characters, its first 24
 * (trailing hyphens dropped) and the suffix, so the id stays within {@link ADMIN_SITE_MAX_LENGTH}.
 */
export function adminSiteId(projectId: string): string {
    const head = projectId.slice(0, ADMIN_SITE_MAX_LENGTH - ADMIN_SITE_SUFFIX.length);
    let end = head.length;
    while (end > 0 && head[end - 1] === '-') {
        end -= 1;
    }
    return `${head.slice(0, end)}${ADMIN_SITE_SUFFIX}`;
}

/** The two addresses Hosting gives a site: `https://<site>.web.app` first, then `https://<site>.firebaseapp.com`. */
export function siteOrigins(siteId: string): readonly [string, string] {
    return [`https://${siteId}.web.app`, `https://${siteId}.firebaseapp.com`];
}

/** The host names of a site's two addresses, as Firebase Auth's authorised domains and reCAPTCHA name them. */
export function siteDomains(siteId: string): readonly [string, string] {
    return [`${siteId}.web.app`, `${siteId}.firebaseapp.com`];
}

/** The admin's address on its own site: the admin keeps its folder there, so every hash route is the same. */
export function adminSiteUrl(siteId: string): string {
    return `${siteOrigins(siteId)[0]}/admin/`;
}
