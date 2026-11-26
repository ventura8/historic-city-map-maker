import type { EngineConfig } from '@hcm/shared';
import { WEB_APP_MANIFEST_FILE } from '@hcm/shared/app';

import { joinAdditions } from './additions.js';
import { appFiles, appRelease, siteAppLines, siteBuildFile, siteWorkerFile } from './app.js';
import { readConfigJs } from './config-js.js';
import { contentSecurityPolicy, type ExtraSources } from './csp.js';
import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';
import { prepareManifest, type PreparedManifest } from './manifest.js';
import { bucketOrigins, manifestOrigins } from './origins.js';
import { isOutputDir } from './output-dir.js';
import { ADMIN_REDIRECT_FILE, ADMIN_REDIRECT_SOURCE } from './hosting/admin-redirect.js';
import { tabIconSource } from './hosting/city-page.js';
import {
    ENGINE_FOLDER,
    ENGINE_MODULE_FILE,
    ENGINE_STYLESHEET_FILE,
    RELATIVE_ASSETS,
    TAB_ICON_FILE,
    renderSitePage,
    type PageAssets,
} from './page.js';
import { publicManifest } from './public-manifest.js';
import { parseSiteSpec, type SiteSpec } from './site-spec.js';
import { subresourceIntegrity } from './sri.js';

/**
 * Assembles one static city site (PLAN → M1: the Bucharest site on GitHub Pages, the starter kit):
 *
 * ```text
 * <outDir>/index.html          generated (page.ts), with the meta CSP of this site's manifest and configuration
 * <outDir>/config.js           the site's own, validated
 * <outDir>/tab-icon.js         the tab icon in the visitor's theme, a city's own from the bucket (`tabIconSource`)
 * <outDir>/site.css            the site's own
 * <outDir>/data/manifest.json  the source manifest, photos moved to data/media/, the build's Mapbox token, the city
 *                              renamed to config.js's when the source names the site's `legacyCityId`
 * <outDir>/data/media/<id>/…   the photo derivatives
 * <outDir>/engine/…            packages/engine/dist (engine.mjs, its chunks, engine.iife.js, engine.css, source maps)
 * <outDir>/app.webmanifest     the installable app (`app.ts`, docs/ENGINE_API.md → Installable app), which the page links,
 * <outDir>/app-icon-*.png      with its three icons; `tab-icon.js` registers its worker and keeps the install prompt
 * <outDir>/sw.js               the app's worker: network first, a copy of the page and its shell only for a visit offline
 * <outDir>/app-build.json      the build (a digest of every file but the data), which an open page compares with its own
 *                              to reload into a new deploy (`tab-icon.js`, `app-update.ts` of `@hcm/shared/app`)
 * ```
 *
 * A site whose `site.json` has `publicManifest: true`, built with the public bucket named (`publicBucket`, from
 * `HCM_PUBLIC_BUCKET`), reads the manifest the admin publishes instead (`public-manifest.ts`, DECISIONS-for-review.md §51e):
 * its `config.js` is generated with the bucket's `cities/<city>/manifest.json`, and no `data/` is written; the CSP is still
 * shaped by the source manifest, plus the bucket's origin and the project's crash-report endpoint.
 *
 * M5 (`docs/research/M5-interfaces.md` §1.10): a city without a seed manifest (`npm run site:add`) is built only with the
 * public bucket named, and serves the page, `config.js` (the bucket's manifest) and the engine; its CSP names the bucket
 * and the crash endpoint (`origins.ts` → `bucketOrigins`). The Pages tree of every city is assembled by `pages.ts`.
 *
 * Every input is read and validated before `outDir` is replaced, so a failed build leaves the previous one alone.
 */

export interface SiteBuildOptions {
    /** The site's folder (`sites/bucharest`, `starter-kit`): `site.json`, `config.js`, `site.css`. */
    readonly siteDir: string;
    /** The output folder, below `dist/` (it is deleted and rewritten). */
    readonly outDir: string;
    /** The Mapbox public token (`pk.…`) written into the served manifest. */
    readonly token: string;
    /** The engine build; default `packages/engine/dist`. */
    readonly engineDir?: string;
    /** The pinned Mapbox GL JS release, for the Subresource Integrity digests; default `node_modules/mapbox-gl/dist`. */
    readonly mapboxGlDir?: string;
    /** A manifest object instead of the one `site.json` names (the e2e fixture manifest). */
    readonly manifest?: unknown;
    /**
     * The project's public bucket (`HCM_PUBLIC_BUCKET`): a site with `publicManifest: true` then reads the manifest the admin
     * publishes there instead of a bundled snapshot. Unset (the default), every site bundles its manifest.
     */
    readonly publicBucket?: string;
    /**
     * M6 (`docs/research/M6-interfaces.md` §2.7): the site is the Hosting site's root, so its page loads
     * `admin-redirect.js` first (an old admin address `/#/<route>` goes to `/admin/`) and the build writes that file.
     */
    readonly adminRedirect?: boolean;
}

export interface SiteBuildReport {
    readonly outDir: string;
    readonly cityId: string;
    readonly photos: number;
    readonly files: number;
}

const DEFAULT_ENGINE_DIR = 'packages/engine/dist';
const DEFAULT_MAPBOX_GL_DIR = 'node_modules/mapbox-gl/dist';

/** One output file, relative to `outDir`: generated text, or a copy of a repository file. */
type PlannedFile = { readonly to: string; readonly content: string | Uint8Array } | { readonly to: string; readonly from: string };

function readJson(files: SiteFileSystem, path: string): unknown {
    try {
        return JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: cannot read the manifest: ${String(error)}`);
    }
}

function requireFile(files: SiteFileSystem, path: string, hint: string): string {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: ${hint}`);
    }
    return path;
}

function engineFiles(files: SiteFileSystem, engineDir: string): PlannedFile[] {
    const hint = 'build the engine first (npm run build --workspace @hcm/engine)';
    requireFile(files, `${engineDir}/${ENGINE_MODULE_FILE}`, hint);
    requireFile(files, `${engineDir}/${ENGINE_STYLESHEET_FILE}`, hint);
    return files.listFiles(engineDir).map((name) => ({ from: `${engineDir}/${name}`, to: `${ENGINE_FOLDER}/${name}` }));
}

/** The page's only file from another origin is mapbox-gl.js (`page.ts`: the viewer links mapbox-gl.css itself). */
function integrity(files: SiteFileSystem, mapboxGlDir: string): { script: string } {
    const hint = 'install the dependencies (mapbox-gl is a pinned devDependency of @hcm/e2e)';
    return { script: subresourceIntegrity(files.readBytes(requireFile(files, `${mapboxGlDir}/mapbox-gl.js`, hint))) };
}

/** `value` as a plain object, or null. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** The ids of a site whose source manifest names a legacy city (site-spec.ts → `legacyCityId`), or null. */
function cityRename(legacyCityId: string | undefined, configCityId: string | undefined): { from: string; to: string } | null {
    return legacyCityId === undefined || configCityId === undefined ? null : { from: legacyCityId, to: configCityId };
}

/**
 * The source manifest with its city renamed to `config.js`'s when it names the site's `legacyCityId`; anything else is
 * returned as it is, and validated later.
 */
function withSiteCity(source: unknown, rename: { from: string; to: string } | null): unknown {
    const manifest = recordOf(source);
    const city = recordOf(manifest?.['city']);
    if (rename === null || city?.['id'] !== rename.from) {
        return source;
    }
    return { ...manifest, city: { ...city, id: rename.to } };
}

function checkCity(configCityId: string | undefined, manifestCityId: string, siteDir: string): void {
    if (configCityId !== undefined && configCityId !== manifestCityId) {
        throw new SiteBuildError(`${siteDir}/config.js: cityId "${configCityId}" does not match the manifest's city "${manifestCityId}"`);
    }
}

/** The configuration a page is served and the CSP origins it adds: the site's own, or the public bucket's (§51e). */
interface ServedConfig {
    readonly source: string;
    readonly config: EngineConfig;
    readonly connect: readonly string[];
}

function servedConfig(options: SiteBuildOptions, spec: SiteSpec, own: Omit<ServedConfig, 'connect'>, files: SiteFileSystem): ServedConfig {
    if (spec.publicManifest !== true || options.publicBucket === undefined) {
        return { ...own, connect: [] };
    }
    const remote = publicManifest(options.publicBucket, own.config, options.siteDir, files);
    return { source: remote.configSource, config: remote.config, connect: remote.connect };
}

function withConnect(sources: ExtraSources, connect: readonly string[]): ExtraSources {
    return { connect: [...new Set([...sources.connect, ...connect])].sort((a, b) => a.localeCompare(b)), images: sources.images };
}

/** What every site's folder holds: `site.json`, `config.js` (validated) and `site.css`. */
interface SiteInputs {
    readonly spec: SiteSpec;
    readonly configSource: string;
    readonly config: EngineConfig;
}

function readInputs(siteDir: string, files: SiteFileSystem): SiteInputs {
    const specFile = requireFile(files, `${siteDir}/site.json`, 'every site has one (scripts/site/src/site-spec.ts)');
    const spec = parseSiteSpec(files.readText(specFile), specFile);
    const configSource = files.readText(requireFile(files, `${siteDir}/config.js`, 'every site has one (docs/ENGINE_API.md → config.js)'));
    return { spec, configSource, config: readConfigJs(configSource, `${siteDir}/config.js`) };
}

/** Where the bundled manifest came from, for the build's messages. */
function manifestLabel(spec: SiteSpec): string {
    return spec.manifest ?? 'the manifest the build was given';
}

/** The bundled manifest and its photos (each from its folder: `media`, or an addition's); none for a page that reads the public bucket. */
function dataFiles(bundled: boolean, prepared: PreparedManifest, source: SourceManifest, files: SiteFileSystem): PlannedFile[] {
    if (!bundled) {
        return [];
    }
    const photos = prepared.media.map((copy) => ({
        from: requireFile(
            files,
            `${source.mediaOf.get(copy.photoId) ?? source.spec.media ?? ''}/${copy.from}`,
            `a photo derivative of ${manifestLabel(source.spec)} (site.json → media, additions)`,
        ),
        to: `data/${copy.to}`,
    }));
    return [{ to: 'data/manifest.json', content: `${JSON.stringify(prepared.manifest)}\n` }, ...photos];
}

/** What a site's page is made of: its spec, its policy and the configuration it is served. */
interface PageParts {
    readonly spec: SiteSpec;
    readonly csp: string;
    readonly configSource: string;
}

/** The root of the Hosting site's first script and its file (M6, §2.7); nothing for any other site. */
function redirectPlan(options: SiteBuildOptions): { readonly assets: PageAssets; readonly files: PlannedFile[] } {
    if (options.adminRedirect !== true) {
        return { assets: RELATIVE_ASSETS, files: [] };
    }
    return {
        assets: { ...RELATIVE_ASSETS, redirect: ADMIN_REDIRECT_FILE },
        files: [{ to: ADMIN_REDIRECT_FILE, content: ADMIN_REDIRECT_SOURCE }],
    };
}

/** The page, its configuration and its styles: what every site serves first. */
function pageFiles(options: SiteBuildOptions, parts: PageParts, files: SiteFileSystem): PlannedFile[] {
    const integrityOf = integrity(files, options.mapboxGlDir ?? DEFAULT_MAPBOX_GL_DIR);
    const redirect = redirectPlan(options);
    const assets = { ...redirect.assets, manifest: WEB_APP_MANIFEST_FILE };
    const page = renderSitePage({ spec: parts.spec, csp: parts.csp, mapboxGlIntegrity: integrityOf, assets });
    const app = { title: parts.spec.title, lang: parts.spec.lang, themeColor: parts.spec.themeColor };
    return [
        { to: 'index.html', content: page },
        { to: 'config.js', content: parts.configSource },
        { to: 'site.css', from: requireFile(files, `${options.siteDir}/site.css`, 'every site has its page styles') },
        ...redirect.files,
        ...appFiles(app),
    ];
}

/**
 * The page's script, its worker and `app-build.json`, all named after the build: a digest of every file the visitor
 * runs (the page, its configuration, styles, engine and app files; not the data, which is never kept and always read
 * again). A deploy that changes any of them is a new build, which the installed app reloads into (`app-update.ts`).
 */
function buildFiles(planned: readonly PlannedFile[], bucket: string | undefined, files: SiteFileSystem): PlannedFile[] {
    const shell = planned.filter((file) => !file.to.startsWith('data/'));
    const build = appRelease(...shell.map((file) => ('content' in file ? file.content : files.readBytes(file.from))));
    return [{ to: TAB_ICON_FILE, content: `${tabIconSource(bucket)}${siteAppLines(build)}` }, siteWorkerFile(build), siteBuildFile(build)];
}

interface Plan {
    readonly files: PlannedFile[];
    readonly cityId: string;
    readonly photos: number;
    /** The public bucket a page reads its city from (its city's own tab icon is there too: `tabIconSource`), or none. */
    readonly bucket: string | undefined;
}

/** A site with a manifest: bundled as `data/`, or read from the public bucket with the manifest shaping the CSP (§51e). */
function manifestPlan(options: SiteBuildOptions, inputs: SiteInputs, source: SourceManifest, files: SiteFileSystem): Plan {
    const { spec, config } = inputs;
    const prepared = prepareManifest(
        withSiteCity(source.manifest, cityRename(spec.legacyCityId, config.cityId)),
        options.token,
        manifestLabel(spec),
    );
    const { manifest } = prepared;
    checkCity(config.cityId, manifest.city.id, options.siteDir);
    const served = servedConfig(options, spec, { source: inputs.configSource, config }, files);
    const bundled = served.config === config;
    const csp = contentSecurityPolicy(withConnect(manifestOrigins(manifest, served.config), served.connect));
    const bucket = bundled ? undefined : options.publicBucket;
    const planned = [
        ...pageFiles(options, { spec, csp, configSource: served.source }, files),
        ...dataFiles(bundled, prepared, source, files),
        ...engineFiles(files, options.engineDir ?? DEFAULT_ENGINE_DIR),
    ];
    return { files: planned, cityId: manifest.city.id, photos: bundled ? manifest.photos.length : 0, bucket };
}

/**
 * M5 (`docs/research/M5-interfaces.md` §1.10): a city without a seed manifest reads the one the admin publishes to the
 * public bucket, and only that; its CSP names the bucket and the project's crash endpoint. Without a bucket there is
 * nothing to serve (the CLI passes such a site over with a notice).
 */
function bucketPlan(options: SiteBuildOptions, inputs: SiteInputs, files: SiteFileSystem): Plan {
    if (options.publicBucket === undefined) {
        throw new SiteBuildError(
            `${options.siteDir}/site.json names no seed manifest and the build names no public bucket (HCM_PUBLIC_BUCKET)`,
        );
    }
    const remote = publicManifest(options.publicBucket, inputs.config, options.siteDir, files);
    const csp = contentSecurityPolicy(bucketOrigins(remote.config, remote.connect));
    const planned = [
        ...pageFiles(options, { spec: inputs.spec, csp, configSource: remote.configSource }, files),
        ...engineFiles(files, options.engineDir ?? DEFAULT_ENGINE_DIR),
    ];
    return { files: planned, cityId: remote.config.cityId ?? '', photos: 0, bucket: options.publicBucket };
}

/** The manifest a site bundles, with the folder of each photo an addition brought (`additions.ts`). */
interface SourceManifest {
    readonly spec: SiteSpec;
    readonly manifest: unknown;
    readonly mediaOf: ReadonlyMap<string, string>;
}

/**
 * The manifest the site bundles or shapes its CSP from: the build's (the e2e fixture, as it is), the seed one joined by
 * its additions, or none.
 */
function sourceManifest(options: SiteBuildOptions, spec: SiteSpec, files: SiteFileSystem): SourceManifest | undefined {
    if (options.manifest !== undefined) {
        return { spec, manifest: options.manifest, mediaOf: new Map() };
    }
    if (spec.manifest === undefined) {
        return undefined;
    }
    return { spec, ...joinAdditions(readJson(files, spec.manifest), spec.media ?? '', spec.additions ?? [], files) };
}

function plan(options: SiteBuildOptions, files: SiteFileSystem): Plan {
    const inputs = readInputs(options.siteDir, files);
    const source = sourceManifest(options, inputs.spec, files);
    const planned = source === undefined ? bucketPlan(options, inputs, files) : manifestPlan(options, inputs, source, files);
    return { ...planned, files: [...planned.files, ...buildFiles(planned.files, planned.bucket, files)] };
}

function write(files: SiteFileSystem, outDir: string, file: PlannedFile): void {
    const target = `${outDir}/${file.to}`;
    if ('content' in file) {
        files.write(target, file.content);
    } else {
        files.copy(file.from, target);
    }
}

/** Builds the site into `options.outDir`; throws SiteBuildError (and writes nothing) when an input is missing or invalid. */
export function buildSite(options: SiteBuildOptions, files: SiteFileSystem): SiteBuildReport {
    if (!isOutputDir(options.outDir)) {
        throw new SiteBuildError(`the output folder must be below dist/, got "${options.outDir}"`);
    }
    const planned = plan(options, files);
    files.remove(options.outDir);
    for (const file of planned.files) {
        write(files, options.outDir, file);
    }
    return { outDir: options.outDir, cityId: planned.cityId, photos: planned.photos, files: planned.files.length };
}
