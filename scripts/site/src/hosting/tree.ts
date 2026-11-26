import { z } from 'zod';

import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { isOutputDir } from '../output-dir.js';
import { ADMIN_SCRIPT_FILE } from '../admin/page.js';
import { RUNTIME_FILE } from '../admin/runtime.js';
import { ADMIN_REDIRECT_FILE, ADMIN_REDIRECT_SOURCE } from './admin-redirect.js';
import { CITY_PAGE_FOLDER, type CityPageFiles } from './city-page.js';
import { HOSTING_STYLESHEET_FILE, HOSTING_STYLESHEET_SOURCE, renderNotFoundPage, renderStartUpPage } from './static-pages.js';

/**
 * The Firebase Hosting tree of the project's one site (docs/research/M6-interfaces.md §2.1, §2.5; `npm run build:hosting`):
 *
 * ```text
 * /                      the viewer of the project's first city (its committed site whose Pages path is the root),
 *                        with admin-redirect.js; data/ only for a site built without the public bucket
 * /<city>/               every other committed city site, at its Pages path
 * /city/                 the generic city page (city-page.ts): Hosting rewrites any other city id to it
 * /admin/                the admin's Hosting folder (its build), runtime.json per variant
 * /release.json          {release, releaseTime?, variant}: what the site's card reads back (no-cache); releaseTime is
 *                        the build time (finding 39 of 2026-11-01) that orders two builds of one version
 * /404.html, /hosting.css
 * ```
 *
 * Two variants come from the same inputs: **public** (the above; what **Publish the map** releases) and **start-up** (the
 * first deploy of a new map, D1: the admin with `runtime.json` `startUp: true`, and at `/` a bilingual "this map is being
 * set up" page with `admin-redirect.js`: no engine, no Mapbox, no city). The release is the admin build's own
 * (`runtime.json`), so the site and the admin always name the same one. `admin/install/` is never copied: the installer's
 * bundle joins the tree after this build (`build:install`, CR-M6-5). Every input is read and checked before `outDir` (below
 * `dist/`) is replaced, so a failed build leaves the previous tree alone.
 */

/** The public map (what Publish the map releases), or a new map's start-up page (its first deploy, D1). */
export type HostingVariant = 'public' | 'start-up';

/** The admin's folder on the Hosting site (a reserved city id). */
const ADMIN_FOLDER = 'admin';
const RELEASE_FILE = 'release.json';
const NOT_FOUND_FILE = '404.html';
/** The installer's bundle inside the admin's folder (`admin/install/<slug>/`), written after this build. */
const INSTALL_FOLDER = 'install';

/** One city site built for Hosting (with the public bucket) and its path on the site (`''`: the root; `<city>/`). */
export interface HostingSite {
    readonly outDir: string;
    readonly path: string;
}

export interface HostingTreeInputs {
    /** The admin's Hosting folder, built (`packages/admin/dist` after `build:admin`). */
    readonly adminDir: string;
    /** The city sites, built for Hosting: exactly one at the root. Not used by the start-up variant. */
    readonly sites: readonly HostingSite[];
    readonly cityPage: CityPageFiles;
}

export interface HostingTreeReport {
    readonly outDir: string;
    readonly variant: HostingVariant;
    readonly release: string;
    /** The site's pages: `/`, each city's, `/city/`, `/admin/`. */
    readonly paths: readonly string[];
    readonly files: number;
}

type PlannedFile = { readonly to: string; readonly content: string } | { readonly to: string; readonly from: string };

/** The admin's `runtime.json` as its build wrote it: the release, and whatever else it carries (the App Check key). */
const runtimeSchema = z.looseObject({
    release: z.string().min(1).max(64),
    /** The build time (finding 39 of 2026-11-01), when the admin's build knew one. */
    releaseTime: z.number().int().min(0).optional(),
    startUp: z.boolean().optional(),
});

/** The admin's release as `/release.json` names it: the release and, when known, its build time. */
interface ReleaseStamp {
    readonly release: string;
    readonly releaseTime?: number;
}

const BUILD_HINT = 'build the admin first (npm run build:admin)';

/** The admin's build is there: its page, its entry and its `runtime.json`. */
function requireBuiltAdmin(adminDir: string, files: SiteFileSystem): void {
    const missing = ['index.html', ADMIN_SCRIPT_FILE, RUNTIME_FILE].some((name) => !files.isFile(`${adminDir}/${name}`));
    if (missing) {
        throw new SiteBuildError(`${adminDir} holds no built admin (index.html, ${ADMIN_SCRIPT_FILE}, ${RUNTIME_FILE}): ${BUILD_HINT}`);
    }
}

function readRuntime(adminDir: string, files: SiteFileSystem): z.infer<typeof runtimeSchema> {
    requireBuiltAdmin(adminDir, files);
    const path = `${adminDir}/${RUNTIME_FILE}`;
    let input: unknown;
    try {
        input = JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
    const parsed = runtimeSchema.safeParse(input);
    if (!parsed.success) {
        throw new SiteBuildError(`${path}: no release (${BUILD_HINT})`);
    }
    return parsed.data;
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}

/** The admin's files under `admin/`, its `runtime.json` written for the variant, its installer folder left out. */
function adminFiles(
    inputs: HostingTreeInputs,
    variant: HostingVariant,
    files: SiteFileSystem,
): { files: PlannedFile[]; stamp: ReleaseStamp } {
    const runtime = readRuntime(inputs.adminDir, files);
    const rest = Object.fromEntries(Object.entries(runtime).filter(([key]) => key !== 'startUp'));
    const written = variant === 'start-up' ? { ...rest, startUp: true } : rest;
    const copied = files
        .listFiles(inputs.adminDir)
        .filter((path) => path !== RUNTIME_FILE && !path.startsWith(`${INSTALL_FOLDER}/`))
        .map((path) => ({ from: `${inputs.adminDir}/${path}`, to: `${ADMIN_FOLDER}/${path}` }));
    const stamp =
        runtime.releaseTime === undefined ? { release: runtime.release } : { release: runtime.release, releaseTime: runtime.releaseTime };
    return { files: [...copied, { to: `${ADMIN_FOLDER}/${RUNTIME_FILE}`, content: json(written) }], stamp };
}

/** The first segment of every file of the root site (`index.html`, `engine`, `config.js`, ...). */
function rootNames(root: HostingSite, files: SiteFileSystem): ReadonlySet<string> {
    return new Set(files.listFiles(root.outDir).map((path) => path.split('/')[0] ?? path));
}

/** The root site; refuses a tree without one, with two, or whose root was built without `admin-redirect.js`. */
function rootSite(sites: readonly HostingSite[], files: SiteFileSystem): HostingSite {
    const roots = sites.filter((site) => site.path === '');
    const [root] = roots;
    if (root === undefined || roots.length > 1) {
        const count = String(roots.length);
        throw new SiteBuildError(`the Hosting site needs exactly one city site at its root (site.json → pagesPath ""), got ${count}`);
    }
    if (!files.isFile(`${root.outDir}/${ADMIN_REDIRECT_FILE}`)) {
        throw new SiteBuildError(`${root.outDir} has no ${ADMIN_REDIRECT_FILE}: build the root site for Hosting (adminRedirect)`);
    }
    return root;
}

/** Two sites on one path, or a city folder that the root site, the admin or the city page already uses, refuse the tree. */
function checkPaths(sites: readonly HostingSite[], taken: ReadonlySet<string>): void {
    const seen = new Set<string>();
    for (const site of sites.filter((candidate) => candidate.path !== '')) {
        const folder = site.path.replace(/\/$/, '');
        if (seen.has(site.path) || taken.has(folder)) {
            throw new SiteBuildError(
                `the Hosting path "/${site.path}" of ${site.outDir} is taken (another site, the root site, the admin or the city page)`,
            );
        }
        seen.add(site.path);
    }
}

/** The public map: every site at its path, the generic city page, the 404 page and the stylesheet. */
function publicFiles(inputs: HostingTreeInputs, files: SiteFileSystem): PlannedFile[] {
    const root = rootSite(inputs.sites, files);
    checkPaths(inputs.sites, new Set([...rootNames(root, files), ADMIN_FOLDER, CITY_PAGE_FOLDER]));
    const sites = inputs.sites.flatMap((site) =>
        files.listFiles(site.outDir).map((path) => ({ from: `${site.outDir}/${path}`, to: `${site.path}${path}` })),
    );
    return [...sites, inputs.cityPage.page, inputs.cityPage.config];
}

/** The start-up root: the being-set-up page and the old admin addresses' redirect. */
function startUpFiles(): PlannedFile[] {
    return [
        { to: 'index.html', content: renderStartUpPage() },
        { to: ADMIN_REDIRECT_FILE, content: ADMIN_REDIRECT_SOURCE },
    ];
}

function pathsOf(variant: HostingVariant, sites: readonly HostingSite[]): string[] {
    const cities = variant === 'public' ? [...sites.map((site) => `/${site.path}`), `/${CITY_PAGE_FOLDER}/`] : ['/'];
    return [...cities, `/${ADMIN_FOLDER}/`];
}

function write(files: SiteFileSystem, outDir: string, file: PlannedFile): void {
    const target = `${outDir}/${file.to}`;
    if ('content' in file) {
        files.write(target, file.content);
    } else {
        files.copy(file.from, target);
    }
}

/** Assembles the `variant` tree into `outDir` (below `dist/`, replaced); throws SiteBuildError, writing nothing, on a bad input. */
export function assembleHostingTree(
    inputs: HostingTreeInputs,
    variant: HostingVariant,
    outDir: string,
    files: SiteFileSystem,
): HostingTreeReport {
    if (!isOutputDir(outDir)) {
        throw new SiteBuildError(`the Hosting tree must be below dist/, got "${outDir}"`);
    }
    const admin = adminFiles(inputs, variant, files);
    const own = variant === 'public' ? publicFiles(inputs, files) : startUpFiles();
    const planned: PlannedFile[] = [
        ...own,
        ...admin.files,
        { to: RELEASE_FILE, content: json({ ...admin.stamp, variant }) },
        { to: NOT_FOUND_FILE, content: renderNotFoundPage() },
        { to: HOSTING_STYLESHEET_FILE, content: HOSTING_STYLESHEET_SOURCE },
    ];
    files.remove(outDir);
    for (const file of planned) {
        write(files, outDir, file);
    }
    return { outDir, variant, release: admin.stamp.release, paths: pathsOf(variant, inputs.sites), files: planned.length };
}
