import { parseArgs } from 'node:util';

import { z } from 'zod';

import { validate, type Logger } from '@hcm/shared';

import { DEFAULT_ADMIN_DIR } from '../admin/build.js';
import { DEFAULT_PROJECT_FILE } from '../admin/project.js';
import { startUpDeploy, type BuildEnvironment } from '../admin/runtime.js';
import { buildSite } from '../build.js';
import { PLACEHOLDER_TOKEN, defaultSites } from '../cli.js';
import { SiteBuildError, issuesText } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { pagesPathOf, parseSiteSpec } from '../site-spec.js';
import { subresourceIntegrity } from '../sri.js';
import { planCityPage } from './city-page.js';
import { assembleHostingTree, type HostingSite, type HostingTreeInputs } from './tree.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-hosting.ts [--out dist/hosting]
 * [--public-out dist/hosting-public] [--admin packages/admin/dist]` (`npm run build:hosting`, Hosting's `predeploy`;
 * docs/research/M6-interfaces.md §2.1, §2.5): after the admin's build (`build:admin`) and the engine's, builds every
 * committed city site for Hosting into `dist/hosting-sites/<folder>` (each reading the public bucket's manifest, the root
 * one with `admin-redirect.js`), the generic city page, and assembles two trees (`tree.ts`):
 *
 * - `--public-out` (default `dist/hosting-public`): the **public** variant, always; the installer's `hosting.tgz` is made
 *   from it (`build:install`, CR-M6-5), and the in-app **Publish the map** releases it;
 * - `--out` (default `dist/hosting`, `firebase.json` → `hosting.public`): the variant this deploy publishes, **start-up**
 *   with `HCM_ADMIN_START_UP=1` (the first deploy of a new map, D1), else **public** (a CI or terminal deploy).
 *
 * The public bucket is `HCM_PUBLIC_BUCKET` when set, else the project's (`<projectId>-public`, `infra/project.json`): the
 * public map never reads anything else. A city site that bundles a seed manifest instead (no `publicManifest`) takes the
 * Mapbox public token from `MAPBOX_PUBLIC_TOKEN` (never from argv), else the e2e placeholder.
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

const DEFAULT_HOSTING_DIR = 'dist/hosting';
/** The public tree: the installer's `hosting.tgz` is made from it (`build:install`, CR-M6-5, CR-M6-16). */
const DEFAULT_PUBLIC_TREE_DIR = 'dist/hosting-public';
/** Where the city sites are built for Hosting before the trees are assembled. */
const SITES_OUT = 'dist/hosting-sites';
const DEFAULT_MAPBOX_GL_DIR = 'node_modules/mapbox-gl/dist';
const KIT_SITE = 'starter-kit';

export interface HostingCliContext {
    readonly env: BuildEnvironment;
    readonly files: SiteFileSystem;
    readonly log: Logger;
}

interface HostingCliOptions {
    readonly out: string;
    readonly publicOut: string;
    readonly admin: string;
}

function readOptions(argv: readonly string[]): HostingCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            out: { type: 'string', default: DEFAULT_HOSTING_DIR },
            'public-out': { type: 'string', default: DEFAULT_PUBLIC_TREE_DIR },
            admin: { type: 'string', default: DEFAULT_ADMIN_DIR },
        },
        strict: true,
        allowPositionals: false,
    });
    return { out: values.out, publicOut: values['public-out'], admin: values.admin };
}

const projectSchema = z.looseObject({ projectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/) });

/** The project's id, from the committed `infra/project.json`. */
export function projectIdOf(files: SiteFileSystem, path = DEFAULT_PROJECT_FILE): string {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: the Hosting site is the project's`);
    }
    let input: unknown;
    try {
        input = JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
    const result = validate(projectSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid project file\n${issuesText(result.issues)}`);
    }
    return result.value.projectId;
}

/** The public bucket every Hosting page reads: `HCM_PUBLIC_BUCKET`, else `<projectId>-public`. */
function bucketOf(context: HostingCliContext): string {
    const named = context.env['HCM_PUBLIC_BUCKET'] ?? '';
    return named === '' ? `${projectIdOf(context.files)}-public` : named;
}

function folderOf(siteDir: string): string {
    return siteDir.slice(siteDir.lastIndexOf('/') + 1);
}

/** Builds every committed city site for Hosting; the one at the root gets `admin-redirect.js`. */
function buildSites(context: HostingCliContext, bucket: string): { sites: HostingSite[]; themeColor: string } {
    const token = context.env['MAPBOX_PUBLIC_TOKEN'] ?? '';
    const sites: HostingSite[] = [];
    let themeColor = '#8B5E3C';
    for (const siteDir of defaultSites(context.files).filter((site) => site !== KIT_SITE)) {
        const spec = parseSiteSpec(context.files.readText(`${siteDir}/site.json`), `${siteDir}/site.json`);
        const path = pagesPathOf(spec, folderOf(siteDir));
        const outDir = `${SITES_OUT}/${folderOf(siteDir)}`;
        const options = { siteDir, outDir, token: token === '' ? PLACEHOLDER_TOKEN : token, publicBucket: bucket };
        context.log.info('hosting site built', { ...buildSite({ ...options, adminRedirect: path === '' }, context.files) });
        sites.push({ outDir, path });
        themeColor = path === '' ? spec.themeColor : themeColor;
    }
    return { sites, themeColor };
}

function mapboxGlIntegrity(files: SiteFileSystem): { script: string } {
    const read = (name: string): Uint8Array => {
        const path = `${DEFAULT_MAPBOX_GL_DIR}/${name}`;
        if (!files.isFile(path)) {
            throw new SiteBuildError(`${path} is missing: install the dependencies (mapbox-gl is a pinned devDependency of @hcm/e2e)`);
        }
        return files.readBytes(path);
    };
    return { script: subresourceIntegrity(read('mapbox-gl.js')) };
}

function build(options: HostingCliOptions, context: HostingCliContext): number {
    const bucket = bucketOf(context);
    const built = buildSites(context, bucket);
    const cityPage = planCityPage(
        { bucket, mapboxGlIntegrity: mapboxGlIntegrity(context.files), themeColor: built.themeColor },
        context.files,
    );
    const inputs: HostingTreeInputs = { adminDir: options.admin, sites: built.sites, cityPage };
    context.log.info('hosting public tree assembled', { ...assembleHostingTree(inputs, 'public', options.publicOut, context.files) });
    const variant = startUpDeploy(context.env) ? 'start-up' : 'public';
    context.log.info('hosting tree assembled', { ...assembleHostingTree(inputs, variant, options.out, context.files) });
    return EXIT_OK;
}

/** Runs the CLI: an input problem is logged with exit status 1; anything else is a bug and propagates with its stack. */
export function runHostingCli(argv: readonly string[], context: HostingCliContext): number {
    let options: HostingCliOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error('usage: build-hosting.ts [--out dist/hosting] [--public-out dist/hosting-public] [--admin packages/admin/dist]', {
            reason: String(error),
        });
        return EXIT_USAGE;
    }
    try {
        return build(options, context);
    } catch (error: unknown) {
        if (error instanceof SiteBuildError) {
            context.log.error(error.message);
            return EXIT_INVALID;
        }
        throw error;
    }
}
