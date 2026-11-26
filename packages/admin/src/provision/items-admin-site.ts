import { adminSiteId, siteDomains } from '@hcm/shared';

import { googleFailureOf } from '../google/failure.js';
import { lacking, refused, type ProvisionContext, type ProvisionItemSpec } from './item.js';

/**
 * The admin's own Hosting site (the owner's decision of 2026-11-13, `DECISIONS-for-review.md` §210;
 * `docs/research/M6-interfaces.md` addendum "The admin on its own site"): the project's second site `<project>-admin`
 * (`adminSiteId`), made with the owner's token in the same consent as Update the map, then its two host names added to
 * Firebase Auth's authorised domains, so the Google sign-in can finish there. The domains are added only once the site is
 * the project's own: a site id another project holds is never trusted with a sign-in. The site build deploys the admin
 * there once the site exists (`scripts/site/src/install/steps/deploy-hosting.ts`); until then the admin stays under the
 * public map's `/admin/`.
 *
 * An id another project holds (Hosting's site ids are global) cannot be made: the item says so and how to go on
 * (`adminSetup.provision.adminSiteTaken`); the admin keeps working under the public map's `/admin/`.
 */

/** Runs whose `sites.create` found the id taken: their second look reports it instead of a plain "missing". */
const TAKEN = new WeakSet<ProvisionContext>();

/** Makes the site; false when another project holds its id. */
async function createSite(context: ProvisionContext, site: string): Promise<boolean> {
    try {
        await context.clients.hosting.createSite(context.project.projectId, site);
        return true;
    } catch (error) {
        if (googleFailureOf(error)?.kind !== 'conflict') {
            throw error;
        }
        TAKEN.add(context);
        return false;
    }
}

/** The site when it lacks, then its two host names among Firebase Auth's authorised domains (every other one kept). */
async function fixAdminSite(context: ProvisionContext, site: string, own: boolean): Promise<void> {
    const { projectId } = context.project;
    if (!own && !(await createSite(context, site))) {
        return;
    }
    const domains = await context.clients.hosting.authorizedDomains(projectId);
    const added = siteDomains(site).filter((domain) => !domains.includes(domain));
    if (added.length > 0) {
        await context.clients.hosting.setAuthorizedDomains(projectId, [...domains, ...added]);
    }
}

/** What the site lacks: itself (and so its domains), or its domains among Firebase Auth's. */
async function adminSiteLacks(context: ProvisionContext, site: string, own: boolean): Promise<string[]> {
    if (!own) {
        return ['site', 'domains'];
    }
    const domains = await context.clients.hosting.authorizedDomains(context.project.projectId);
    return siteDomains(site).every((domain) => domains.includes(domain)) ? [] : ['domains'];
}

const adminSite: ProvisionItemSpec = {
    id: 'admin-site',
    after: ['apis'],
    observe: async (context) => {
        const site = adminSiteId(context.project.projectId);
        const own = await context.clients.hosting.ownSite(context.project.projectId, site);
        if (!own && TAKEN.has(context)) {
            return refused('adminSetup.provision.adminSiteTaken', { site });
        }
        return lacking(await adminSiteLacks(context, site, own), () => fixAdminSite(context, site, own), { site });
    },
};

export const ADMIN_SITE_ITEMS: readonly ProvisionItemSpec[] = [adminSite];
