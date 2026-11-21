/**
 * The site build's `hosting` step (`docs/research/M6-interfaces.md` §1.4.3 and its addendum "The admin on its own site",
 * `DECISIONS-for-review.md` §210): when the project has the admin's own Hosting site (`<project>-admin`, made by
 * Provision's `admin-site` item with the owner's consent), the tree becomes two sites (`../../hosting/admin-site.ts`) and
 * both deploy in one `firebase deploy --only hosting`, the admin's keeping its last `--max-versions` releases too; without
 * it (Provision has not made it yet, or the id belongs to another project) the tree deploys as before, the admin under the
 * public map's `/admin/`. The site is the project's only when Hosting finds it among the project's own (`GET
 * projects/<p>/sites/<site>`; another project's answers 404 or 403), so a site someone else holds is never deployed to or
 * linked.
 *
 * `node steps/deploy-hosting.mjs --project <p> [--max-versions 10]`, in the folder holding `firebase.json`.
 */
import { parseArgs } from 'node:util';

import { adminSiteId } from '@hcm/shared';

import { splitAdminSite } from '../../hosting/admin-site.js';
import { FIREBASE_BIN } from './deploy-with-retry.js';
import { hostingConfig } from './hosting-config.js';
import { GoogleCallError, googleJson, type StepDeps } from './step-io.js';

const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';

/** What Hosting answers for a site that is not the project's own: none (404), or another project's (403). */
const NOT_OWN = new Set([403, 404]);

interface Options {
    readonly project: string;
    readonly maxVersions: number;
    /** The folder holding `firebase.json` (the step's own, `.`). */
    readonly dir: string;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: { project: { type: 'string' }, 'max-versions': { type: 'string', default: '10' }, dir: { type: 'string', default: '.' } },
        strict: true,
    });
    const maxVersions = Number(values['max-versions']);
    if (values.project === undefined || !Number.isInteger(maxVersions) || maxVersions < 1) {
        throw new Error('usage: deploy-hosting --project <p> [--max-versions <n>]');
    }
    return { project: values.project, maxVersions, dir: values.dir };
}

/** Whether `site` is one of the project's own Hosting sites. */
export async function ownSite(deps: Pick<StepDeps, 'fetch' | 'token'>, project: string, site: string): Promise<boolean> {
    const url = `${HOSTING}/projects/${encodeURIComponent(project)}/sites/${encodeURIComponent(site)}`;
    try {
        await googleJson(deps, await deps.token(), url);
        return true;
    } catch (error) {
        if (error instanceof GoogleCallError && NOT_OWN.has(error.status)) {
            return false;
        }
        throw error;
    }
}

/** Splits the tree for the admin's own site, or says why the admin stays under the public map's `/admin/`. */
async function prepare(deps: StepDeps, opts: Options, site: string): Promise<boolean> {
    if (!(await ownSite(deps, opts.project, site))) {
        deps.log(`hosting: the project has no site ${site}: the admin stays at /admin/ of the public map (Setup step c makes the site)`);
        return false;
    }
    const result = splitAdminSite({ config: `${opts.dir}/firebase.json`, siteId: site });
    deps.log(`hosting: the admin deploys to ${result.adminOrigin}/admin/, the public map's /admin/ forwards there`);
    return true;
}

/** Deploys the site (and the admin's, when the project has it); resolves to the step's exit status. */
export async function deployHosting(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    const site = adminSiteId(opts.project);
    const split = await prepare(deps, opts, site);
    const deployed = await deps.run('node', [FIREBASE_BIN, 'deploy', '--only', 'hosting', '--project', opts.project, '--non-interactive']);
    if (deployed.code !== 0 || !split) {
        return deployed.code;
    }
    return hostingConfig(['--project', opts.project, '--site', site, '--max-versions', String(opts.maxVersions)], deps);
}
