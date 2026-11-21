/**
 * The install bundle (`docs/research/M6-interfaces.md` §1.3), made by the site build from the same checkout as the admin
 * (`npm run build:install`, after `build:hosting` and the functions' build: CR-M6-5) into each Hosting tree it is given,
 * at `admin/install/<slug>/`:
 *
 * - `server.tgz`: `functions/dist/` (the bundle, its `package.json`, its deploy lock, `.env.<project>` with `HCM_RELEASE`
 *   and `HCM_RELEASE_TIME`,
 *   the export kit, the starter files' templates; an allowlist, so nothing else, a local secret file least of all, is ever published),
 *   a `firebase.json` of the server's parts (no `predeploy`), the Firestore and Storage rules and indexes, `.firebaserc`,
 *   `tools/` (the locked `firebase-tools`, with the vendored copies its lock links to) and `steps/`;
 * - `pipeline.tgz`: the raster pipeline's Docker context (no tests) and `steps/`;
 * - `hosting.tgz`: the public Hosting tree under `public/` without `admin/install/**` and the old photos' originals, a
 *   `firebase.json` of Hosting only, `.firebaserc`, `tools/` and `steps/`;
 * - `legacy.tgz` (§73k): the originals, `public/admin/legacy/<city>/originals/**`, which a site build fetches only while
 *   the legacy import is not complete (none when the public tree has none);
 * - `manifest.json` (`installManifestSchema`): the release and its build time (the admin's `runtime.json`'s: finding 39
 *   of 2026-11-01), the slug, the project, each tarball's size and SHA-256,
 *   the server's functions, the tools by digest and the build estimates.
 *
 * Deterministic: the same commit gives the same bytes (`tar.ts`; the entries' time is `SOURCE_DATE_EPOCH`, else 0).
 */
import { createHash } from 'node:crypto';

import {
    BACKGROUND_FUNCTIONS,
    CALLABLES,
    deployedName,
    DOCKER_BUILDER_IMAGE,
    FIREBASE_TOOLS_VERSION,
    GENERIC_INSTALL_PROJECT,
    HTTP_ENDPOINTS,
    INSTALL_BUNDLE_FILES,
    INSTALL_ESTIMATES,
    INSTALL_FOLDER,
    INSTALL_FORMAT,
    INSTALL_MANIFEST_FILE,
    LEGACY_BUNDLE_FILE,
    START_PROJECT_TOKEN,
    installManifestSchema,
    installReleaseSlug,
    type InstallManifest,
    type InstallTarget,
} from '@hcm/shared';

import { adminRelease, releaseChannelOf, releaseTime, type BuildEnvironment, type CommitClock } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { tgz, type TarEntry } from './tar.js';
import { toolsFolder, type Lockfile, type RootManifest } from './tools-lock.js';

/** The Node image of every Node step, by digest: the quality image's own pin (`docker/Dockerfile.quality`, a test keeps them equal). */
export const NODE_STEP_IMAGE = 'node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54';

/** The raster pipeline's Docker context in the bundle (its tests stay out). */
const PIPELINE_FILES = ['Dockerfile', 'pyproject.toml', 'poetry.lock', 'requirements-poetry.txt', 'README.md'] as const;
const PIPELINE_SOURCE = 'pipeline/src/hcm_pipeline';
const RULE_FILES = ['firebase/firestore.rules', 'firebase/firestore.indexes.json', 'firebase/storage.rules'] as const;

/**
 * The files of the functions' build the server's tarball may carry, and nothing else (finding 5 of the M6 security
 * review): the bundle is served to anyone, and firebase-tools' own `*.local` exclusion does not apply to it, so a
 * `.secret.local` or `.env.local` left in `functions/dist` must fail the build rather than be published.
 */
const SERVER_FILES: readonly RegExp[] = [
    /^index\.js$/,
    /^package\.json$/,
    /^package-lock\.json$/,
    /^\.env\.[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
    /^export-kit\/[^/].*$/,
    // Finding 73 of 2026-11-03: the starter files' templates `worker.starter` fills.
    /^starter\/hcm-worker\.(?:sh|bat)$/,
];

/** `functions/dist`'s files, refusing any the allowlist does not name. */
function serverFiles(files: SiteFileSystem, dir: string): TarEntry[] {
    const unexpected = files.listFiles(dir).filter((path) => !SERVER_FILES.some((pattern) => pattern.test(path)));
    if (unexpected.length > 0) {
        throw new SiteBuildError(`the install bundle carries only the functions' build; ${dir} also holds ${unexpected.join(', ')}`);
    }
    return folderEntries(files, dir, 'functions/dist/');
}

export interface InstallBundleOptions {
    /** The public Hosting tree (`build:hosting`'s `--public-out`): `hosting.tgz`. */
    readonly publicTree: string;
    /** The Hosting trees the bundle folder is written into (the deployed one). */
    readonly out: readonly string[];
    /** The functions' deploy artifact (`npm run build --workspace @hcm/functions`). */
    readonly functionsDir: string;
    readonly env: BuildEnvironment;
    /** Reads the build commit's time (default: git); the manifest's `releaseTime` when `SOURCE_DATE_EPOCH` says none. */
    readonly commitTime?: CommitClock;
    /**
     * M14 (`docs/research/M14-start-your-map.md` §6): a bundle for a project nobody knows yet: `manifest.projectId` names
     * none, no tarball has a `.firebaserc` (every build passes `--project`), and the functions' `.env.<project>` becomes a
     * `.env` of the release and `HCM_APP_CHECK` only; `hosting.tgz`'s `firebase.json` holds the token.
     */
    readonly generic?: boolean;
    /** With `generic`: the public tree's files that hold the token, which `hosting.tgz` lists in `templates.json` for `fetch`. */
    readonly templates?: readonly string[];
}

export interface InstallBundleReport {
    readonly release: string;
    readonly slug: string;
    /** Each tarball's size; `legacy` 0 for a public tree without the old photos' originals (§73k). */
    readonly bytes: Readonly<Record<InstallTarget | 'legacy', number>>;
}

/** The step scripts as the bundle carries them (`steps-bundle.ts`): path → bytes. */
export type StepFiles = ReadonlyMap<string, Uint8Array>;

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
    return encoder.encode(`${JSON.stringify(value, null, 4)}\n`);
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** The registry's deployed function names, sorted: the server's expected set. */
export function expectedFunctionNames(): string[] {
    return [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)]
        .map(deployedName)
        .sort((left, right) => (left < right ? -1 : 1));
}

/** The entries' time: `SOURCE_DATE_EPOCH` when it is a whole number of seconds, else 0. */
export function entryTime(env: BuildEnvironment): number {
    const value = env['SOURCE_DATE_EPOCH'] ?? '';
    return /^\d{1,12}$/.test(value) ? Number(value) : 0;
}

/** Every file below `dir` as entries under `prefix`, but those `skip` refuses. */
function folderEntries(files: SiteFileSystem, dir: string, prefix: string, skip: (path: string) => boolean = () => false): TarEntry[] {
    return files
        .listFiles(dir)
        .filter((path) => !skip(path))
        .map((path) => ({ path: `${prefix}${path}`, content: files.readBytes(`${dir}/${path}`) }));
}

function fileEntry(files: SiteFileSystem, path: string, to: string = path): TarEntry {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`the install bundle needs ${path}`);
    }
    return { path: to, content: files.readBytes(path) };
}

/** A `firebase.json` part without its `predeploy` (the bundle's parts are built already), arrays item by item. */
function withoutPredeploy(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(withoutPredeploy);
    }
    return Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).filter(([key]) => key !== 'predeploy'));
}

/** The repository's `firebase.json` reduced to `keep` (no `predeploy`, the Hosting tree under `public/`). */
function firebaseConfig(files: SiteFileSystem, keep: readonly string[]): Uint8Array {
    const config = JSON.parse(files.readText('firebase.json')) as Record<string, unknown>;
    const kept = Object.fromEntries(keep.filter((key) => config[key] !== undefined).map((key) => [key, withoutPredeploy(config[key])]));
    const hosting = kept['hosting'];
    return json(hosting === undefined ? kept : { ...kept, hosting: { ...(hosting as Record<string, unknown>), public: 'public' } });
}

/** What every tarball that runs `firebase-tools` or a step carries. */
function sharedEntries(files: SiteFileSystem, projectId: string | null, steps: StepFiles, tools: boolean): TarEntry[] {
    const step = [...steps].map(([path, content]) => ({ path, content }));
    if (!tools) {
        return step;
    }
    const folder = toolsFolder(
        JSON.parse(files.readText('package-lock.json')) as Lockfile,
        JSON.parse(files.readText('package.json')) as RootManifest,
    );
    // A vendored copy's own install folder, if npm ever made one, is not part of the copy.
    const nested = (path: string): boolean => path.split('/').includes('node_modules');
    return [
        ...step,
        ...(projectId === null ? [] : [{ path: '.firebaserc', content: json({ projects: { default: projectId } }) }]),
        { path: 'tools/package.json', content: encoder.encode(folder.packageJson) },
        { path: 'tools/package-lock.json', content: encoder.encode(folder.packageLock) },
        ...folder.vendored.flatMap((dir) => folderEntries(files, dir, `tools/${dir}/`, nested)),
    ];
}

function serverEntries(files: SiteFileSystem, options: InstallBundleOptions, shared: readonly TarEntry[]): TarEntry[] {
    if (!files.isFile(`${options.functionsDir}/index.js`)) {
        throw new SiteBuildError(
            `the install bundle needs the functions' build in ${options.functionsDir} (npm run build --workspace @hcm/functions)`,
        );
    }
    const functions = serverFiles(files, options.functionsDir);
    return [
        ...(options.generic === true ? genericFunctions(functions) : functions),
        { path: 'firebase.json', content: firebaseConfig(files, ['firestore', 'storage', 'functions']) },
        ...RULE_FILES.map((path) => fileEntry(files, path)),
        ...shared,
    ];
}

/** The keys of `.env.<project>` that fit any project: the release, and how App Check runs. */
const GENERIC_ENV = /^HCM_(?:RELEASE|RELEASE_TIME|APP_CHECK)=/;
const PROJECT_ENV = /^functions\/dist\/\.env\.[^/]+$/;

/** The functions without any project's `.env.<project>`: one `.env` of what fits every project (M14 §6). */
function genericFunctions(entries: readonly TarEntry[]): TarEntry[] {
    const [first] = entries.filter((entry) => PROJECT_ENV.test(entry.path));
    const lines = first === undefined ? [] : new TextDecoder().decode(first.content).split('\n');
    const env = lines.filter((line) => GENERIC_ENV.test(line));
    return [
        ...entries.filter((entry) => !PROJECT_ENV.test(entry.path)),
        { path: 'functions/dist/.env', content: encoder.encode(`${env.join('\n')}\n`) },
    ];
}

function pipelineEntries(files: SiteFileSystem, steps: readonly TarEntry[]): TarEntry[] {
    const notCache = (path: string): boolean => path.includes('__pycache__/') || path.endsWith('.pyc');
    return [
        ...PIPELINE_FILES.map((name) => fileEntry(files, `pipeline/${name}`, name)),
        ...folderEntries(files, PIPELINE_SOURCE, 'src/hcm_pipeline/', notCache),
        ...steps,
    ];
}

/** The old photos' originals in the public tree (`admin/legacy/<city>/originals/…`), which travel in `legacy.tgz` (§73k). */
const LEGACY_ORIGINAL = /^admin\/legacy\/[^/]+\/originals\//;

function hostingEntries(files: SiteFileSystem, options: InstallBundleOptions, shared: readonly TarEntry[], projectId: string): TarEntry[] {
    if (!files.isFile(`${options.publicTree}/index.html`)) {
        throw new SiteBuildError(`the install bundle needs the public Hosting tree in ${options.publicTree} (npm run build:hosting)`);
    }
    const elsewhere = (path: string): boolean => path.startsWith(`admin/${INSTALL_FOLDER}/`) || LEGACY_ORIGINAL.test(path);
    return [
        ...folderEntries(files, options.publicTree, 'public/', elsewhere),
        ...(options.generic === true ? [{ path: GENERIC_TEMPLATES_FILE, content: json(options.templates ?? []) }] : []),
        {
            path: 'firebase.json',
            content:
                options.generic === true ? tokenised(firebaseConfig(files, ['hosting']), projectId) : firebaseConfig(files, ['hosting']),
        },
        ...shared,
    ];
}

/**
 * The list of what a site build adopts (M14 §6). A list, not a search: the admin's own script holds the token as the text it looks
 * for, and replacing that would change a file the tree promises as it is, and stop the next publish from finding the token.
 */
const GENERIC_TEMPLATES_FILE = 'templates.json';

/** `firebase.json` naming no project: the token where the repository's id was (M14 §6). */
function tokenised(config: Uint8Array, projectId: string): Uint8Array {
    return encoder.encode(new TextDecoder().decode(config).replaceAll(projectId, START_PROJECT_TOKEN));
}

/** The legacy originals at their place in the public tree, or nothing for a tree without them. */
function legacyEntries(files: SiteFileSystem, options: InstallBundleOptions): TarEntry[] {
    return folderEntries(files, options.publicTree, 'public/', (path) => !LEGACY_ORIGINAL.test(path));
}

function projectIdOf(files: SiteFileSystem): string {
    const projectId = (JSON.parse(files.readText('infra/project.json')) as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string') {
        throw new SiteBuildError('infra/project.json names no projectId');
    }
    return projectId;
}

/** One tarball's entry in the manifest. */
function bundleFile<Name extends string>(
    name: Name,
    bytes: Uint8Array,
): { readonly name: Name; readonly bytes: number; readonly sha256: string } {
    return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

function manifestOf(
    stamp: { readonly release: string; readonly releaseTime: number | null },
    projectId: string,
    tarballs: Readonly<Record<InstallTarget, Uint8Array>>,
    legacy: Uint8Array | null,
): InstallManifest {
    const { release } = stamp;
    const file = (target: InstallTarget) => bundleFile(INSTALL_BUNDLE_FILES[target], tarballs[target]);
    const manifest = {
        format: INSTALL_FORMAT,
        release,
        releaseTime: stamp.releaseTime,
        channel: releaseChannelOf(release),
        slug: installReleaseSlug(release),
        projectId,
        files: {
            server: file('server'),
            pipeline: file('pipeline'),
            site: file('site'),
            ...(legacy === null ? {} : { legacy: bundleFile(LEGACY_BUNDLE_FILE, legacy) }),
        },
        functions: expectedFunctionNames(),
        tools: { firebaseTools: FIREBASE_TOOLS_VERSION, node: NODE_STEP_IMAGE, docker: DOCKER_BUILDER_IMAGE },
        estimates: INSTALL_ESTIMATES,
    };
    const parsed = installManifestSchema.safeParse(manifest);
    if (!parsed.success) {
        throw new SiteBuildError(`the install manifest is not valid: ${parsed.error.message}`);
    }
    return parsed.data;
}

/** The legacy originals' tarball, or null for a public tree without them (§73k). */
function legacyTarball(files: SiteFileSystem, options: InstallBundleOptions, mtime: number): Uint8Array | null {
    const originals = legacyEntries(files, options);
    return originals.length === 0 ? null : tgz(originals, mtime);
}

/** Each file of a release's bundle folder, by name: the tarballs, the originals' when there are some, the manifest. */
function bundleFolderFiles(
    tarballs: Readonly<Record<InstallTarget, Uint8Array>>,
    legacy: Uint8Array | null,
    manifest: InstallManifest,
): readonly (readonly [string, Uint8Array])[] {
    const targets = (Object.keys(tarballs) as InstallTarget[]).map((target) => [INSTALL_BUNDLE_FILES[target], tarballs[target]] as const);
    const originals = legacy === null ? [] : [[LEGACY_BUNDLE_FILE, legacy] as const];
    return [...targets, ...originals, [INSTALL_MANIFEST_FILE, json(manifest)] as const];
}

/** Builds the bundle into every `out` tree; `steps` is `bundleSteps`' result. */
export function buildInstallBundle(options: InstallBundleOptions, files: SiteFileSystem, steps: StepFiles): InstallBundleReport {
    const release = adminRelease(files, options.env);
    const projectId = projectIdOf(files);
    const mtime = entryTime(options.env);
    const named = options.generic === true ? null : projectId;
    const stepEntries = sharedEntries(files, named, steps, false);
    const withTools = sharedEntries(files, named, steps, true);
    const tarballs: Record<InstallTarget, Uint8Array> = {
        server: tgz(serverEntries(files, options, withTools), mtime),
        pipeline: tgz(pipelineEntries(files, stepEntries), mtime),
        site: tgz(hostingEntries(files, options, withTools, projectId), mtime),
    };
    const legacy = legacyTarball(files, options, mtime);
    const stamp = { release, releaseTime: releaseTime(files, options.env, options.commitTime) };
    const manifest = manifestOf(stamp, options.generic === true ? GENERIC_INSTALL_PROJECT : projectId, tarballs, legacy);
    const written = bundleFolderFiles(tarballs, legacy, manifest);
    for (const out of options.out) {
        const folder = `${out}/admin/${INSTALL_FOLDER}/${manifest.slug}`;
        written.forEach(([name, bytes]) => {
            files.write(`${folder}/${name}`, bytes);
        });
    }
    return {
        release,
        slug: manifest.slug,
        bytes: {
            server: tarballs.server.length,
            pipeline: tarballs.pipeline.length,
            site: tarballs.site.length,
            legacy: legacy === null ? 0 : legacy.length,
        },
    };
}
