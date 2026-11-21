import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import { buildSite } from './build.js';
import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';
import { assemblePages, type PagesSite } from './pages.js';
import { buildPagesRedirect, pagesRedirectTarget } from './hosting/pages-redirect.js';
import { pagesPathOf, parseSiteSpec } from './site-spec.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-site.ts [--out dist/site] [--site <dir> ...]
 * [--pages dist/pages] [--pages-redirect dist/pages-redirect]` (`npm run build:site`): builds every site into `<out>/<site folder name>` (`dist/site/bucharest`,
 * `dist/site/starter-kit`). Without `--site`, every `sites/<city>/` with a `site.json` (sorted), then the starter kit
 * (M5, `docs/research/M5-interfaces.md` §1.10). `--pages` then assembles the GitHub Pages tree of every city site there
 * (`pages.ts`: Bucharest at the root, each other city at its `pagesPath`); the starter kit is never in it. A city without
 * a seed manifest reads the public bucket's only, and is passed over with a notice when the build names no bucket. The Mapbox public token comes from the environment variable `MAPBOX_PUBLIC_TOKEN`, never
 * from argv; without it the sites get the e2e placeholder token, which Mapbox refuses (a warning says so). The public
 * bucket comes from `HCM_PUBLIC_BUCKET` (a repository variable in CI): a site whose `site.json` says `publicManifest` then
 * reads the manifest the admin publishes there; without it every site bundles its manifest (DECISIONS-for-review.md §51e).
 * M6 (`docs/research/M6-interfaces.md` §2.7): `--pages-redirect` writes the GitHub Pages redirect tree instead of the old
 * site's (`hosting/pages-redirect.ts`): a page for the root and each city's Pages path, sending the visitor to the same page
 * on Firebase Hosting (`https://<projectId>.web.app/`) with the same hash.
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */

/** The folder of the cities' sites, and the starter kit's site, built last and never part of the Pages tree. */
const SITES_DIR = 'sites';
const KIT_SITE = 'starter-kit';
const DEFAULT_OUT = 'dist/site';
/** A generated test value that encodes the scenario (`quality/testing_strategy_skill.md`), never a real token. */
export const PLACEHOLDER_TOKEN = 'pk.e2e-fake-token';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export interface CliContext {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly files: SiteFileSystem;
    readonly log: Logger;
}

interface CliOptions {
    readonly out: string;
    /** The sites named on the command line; none: every committed one (`defaultSites`). */
    readonly sites: readonly string[] | undefined;
    readonly pages: string | undefined;
    readonly pagesRedirect: string | undefined;
}

function readOptions(argv: readonly string[]): CliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            out: { type: 'string', default: DEFAULT_OUT },
            site: { type: 'string', multiple: true },
            pages: { type: 'string' },
            'pages-redirect': { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
    });
    return { out: values.out, sites: values.site, pages: values.pages, pagesRedirect: values['pages-redirect'] };
}

/** Every `sites/<city>/` with a `site.json`, sorted, then the starter kit: the committed sites in build order. */
export function defaultSites(files: SiteFileSystem): string[] {
    const cities = files
        .listFiles(SITES_DIR)
        .filter((path) => /^[^/]+\/site\.json$/.test(path))
        .map((path) => `${SITES_DIR}/${path.slice(0, path.indexOf('/'))}`);
    return [...cities, KIT_SITE];
}

function siteName(siteDir: string): string {
    return siteDir.slice(siteDir.lastIndexOf('/') + 1);
}

function tokenFrom(context: CliContext): string {
    const token = context.env['MAPBOX_PUBLIC_TOKEN'] ?? '';
    if (token !== '') {
        return token;
    }
    context.log.warn('MAPBOX_PUBLIC_TOKEN is not set: the sites use the e2e placeholder token, which only the mock APIs accept');
    return PLACEHOLDER_TOKEN;
}

/** The public bucket the sites may read their manifest from (`HCM_PUBLIC_BUCKET`), or nothing. */
function bucketFrom(context: CliContext): { readonly publicBucket?: string } {
    const bucket = context.env['HCM_PUBLIC_BUCKET'] ?? '';
    if (bucket === '') {
        context.log.info('HCM_PUBLIC_BUCKET is not set: every site bundles its manifest (the seed snapshot)');
        return {};
    }
    context.log.info('the sites that read the public bucket use its manifest', { bucket });
    return { publicBucket: bucket };
}

/** A city without a seed manifest needs the public bucket: without one the build passes it over and says so. */
function waitsForBucket(siteDir: string, bucket: { readonly publicBucket?: string }, context: CliContext): boolean {
    const specFile = `${siteDir}/site.json`;
    if (bucket.publicBucket !== undefined || !context.files.isFile(specFile)) {
        return false;
    }
    if (parseSiteSpec(context.files.readText(specFile), specFile).manifest !== undefined) {
        return false;
    }
    context.log.info('site not built: it reads the public bucket and HCM_PUBLIC_BUCKET is not set', { siteDir });
    return true;
}

/** The built city sites (never the starter kit) and their Pages paths. */
function pagesSiteOf(siteDir: string, outDir: string, files: SiteFileSystem): PagesSite[] {
    if (siteDir === KIT_SITE) {
        return [];
    }
    const spec = parseSiteSpec(files.readText(`${siteDir}/site.json`), `${siteDir}/site.json`);
    return [{ outDir, pagesPath: pagesPathOf(spec, siteName(siteDir)) }];
}

function build(options: CliOptions, context: CliContext): number {
    const token = tokenFrom(context);
    const bucket = bucketFrom(context);
    const pages: PagesSite[] = [];
    for (const siteDir of (options.sites ?? defaultSites(context.files)).filter((site) => !waitsForBucket(site, bucket, context))) {
        const outDir = `${options.out}/${siteName(siteDir)}`;
        const report = buildSite({ siteDir, outDir, token, ...bucket }, context.files);
        context.log.info('site built', { ...report });
        pages.push(...pagesSiteOf(siteDir, outDir, context.files));
    }
    if (options.pages !== undefined) {
        context.log.info('pages assembled', { ...assemblePages(pages, options.pages, context.files) });
    }
    if (options.pagesRedirect !== undefined) {
        const folders = pages.map((site) => site.pagesPath);
        const report = buildPagesRedirect(options.pagesRedirect, pagesRedirectTarget(context.files), folders, context.files);
        context.log.info('pages redirect written', { ...report });
    }
    return EXIT_OK;
}

/** Runs the CLI: an input problem is logged with exit status 1; anything else is a bug and propagates with its stack. */
export function runCli(argv: readonly string[], context: CliContext): number {
    let options: CliOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error('usage: build-site.ts [--out dist/site] [--site <dir> ...] [--pages dist/pages] [--pages-redirect <dir>]', {
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
