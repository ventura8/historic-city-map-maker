import { RELEASE_TAG_PATTERN } from '@hcm/shared';

import { ReleaseError, isJsonObject, jsonText, readJsonObject, type JsonObject, type ReleaseFiles } from './files.js';

/**
 * One version everywhere (`docs/research/M5-interfaces.md` §2.2): a release `X.Y.Z` is written into the root
 * `package.json`, every workspace's `package.json` (and each dependency of a workspace on another workspace, since npm
 * resolves a workspace only at its exact version), the lockfile's entries for them, `ENGINE_VERSION`, and the Cloud
 * Functions deploy artifact's own manifest and lock (`functions/deploy-lock/`, which `functions/build.mjs` requires to
 * equal the artifact's `package.json`, version included). Only versions change: no dependency is resolved, so nothing
 * is downloaded, and `npm ci` accepts the result as it is. `scripts/ci/check_release.py` checks every one of them.
 */

const ROOT_MANIFEST = 'package.json';
export const LOCKFILE = 'package-lock.json';
export const ENGINE_INDEX = 'packages/engine/src/index.ts';
export const DEPLOY_MANIFEST = 'functions/deploy-lock/package.json';
export const DEPLOY_LOCKFILE = 'functions/deploy-lock/package-lock.json';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const ENGINE_VERSION_LINE = /^export const ENGINE_VERSION = '[^'\n]*';$/gm;

/** A file the bump rewrites, with its new text. */
export interface FileChange {
    readonly path: string;
    readonly text: string;
}

/**
 * `1.0.0`, or a pre-release `1.0.0-beta.1` / `1.0.0-rc.2`: a release version without a `v`, another pre-release or a
 * build suffix (`docs/releases/README.md`).
 */
export function isReleaseVersion(version: string): boolean {
    return RELEASE_TAG_PATTERN.test(`v${version}`);
}

/** The folders the root manifest's `workspaces` name that hold a `package.json` (`packages/*` is one level deep). */
export function workspaceFolders(files: ReleaseFiles, patterns: unknown): string[] {
    if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === 'string')) {
        throw new ReleaseError(`${ROOT_MANIFEST}: \`workspaces\` must be an array of folder globs`);
    }
    const folders = patterns.flatMap((pattern) => expandPattern(files, pattern));
    return folders.filter((folder) => files.isFile(`${folder}/package.json`)).sort((a, b) => a.localeCompare(b));
}

function expandPattern(files: ReleaseFiles, pattern: string): string[] {
    const parent = pattern.endsWith('/*') ? pattern.slice(0, -2) : null;
    const plain = parent ?? pattern;
    if (/[*?[\]{}!]/.test(plain)) {
        throw new ReleaseError(`${ROOT_MANIFEST}: the workspace pattern ${JSON.stringify(pattern)} is not a folder or <folder>/*`);
    }
    return parent === null ? [pattern] : files.listDirs(parent).map((name) => `${parent}/${name}`);
}

function pinWorkspaces(dependencies: unknown, workspaces: ReadonlySet<string>, version: string): unknown {
    if (!isJsonObject(dependencies)) {
        return dependencies;
    }
    return Object.fromEntries(Object.entries(dependencies).map(([name, spec]) => [name, workspaces.has(name) ? version : spec]));
}

/** A manifest (or a lockfile entry) at `version`, each dependency on a workspace pinned to it; key order is kept. */
export function bumpManifest(manifest: JsonObject, version: string, workspaces: ReadonlySet<string>): JsonObject {
    const bumped: JsonObject = { ...manifest, version };
    for (const field of DEPENDENCY_FIELDS) {
        if (field in manifest) {
            bumped[field] = pinWorkspaces(manifest[field], workspaces, version);
        }
    }
    return bumped;
}

/** A lockfile at `version`: its own version, its root entry and the entries of the workspace folders. */
export function bumpLockfile(lock: JsonObject, version: string, folders: readonly string[], workspaces: ReadonlySet<string>): JsonObject {
    const packages = lock['packages'];
    if (!isJsonObject(packages)) {
        throw new ReleaseError('the lockfile has no `packages` object (lockfileVersion 3)');
    }
    const bumped = Object.entries(packages).map(([key, entry]) => {
        const ours = key === '' || folders.includes(key);
        return [key, ours && isJsonObject(entry) ? bumpManifest(entry, version, workspaces) : entry];
    });
    return { ...lock, version, packages: Object.fromEntries(bumped) };
}

/**
 * The guides that tell a reader to run the CLI from npm: each names the release exactly
 * (`npx create-historic-city@X.Y.Z`, `npm create historic-city@X.Y.Z`), never a major line such as `@1`, which would
 * run whatever the name resolves to then (`docs/LESSONS.md` 238). The bump rewrites them; `scripts/ci/check_release.py`
 * (`PINNED_DOCS`, the same list) checks them on a tag.
 */
export const PINNED_DOCS = [
    'README.md',
    'docs/ENGINE_API.md',
    'docs/MANUAL_TEST_PLAN.md',
    'docs/SELF_HOST.md',
    'packages/create-historic-city/README.md',
    'sites/landing/index.html',
    'sites/landing/ro.html',
    'starter-kit/README.md',
    'templates/starter-kit/README.md',
] as const;

const CLI_PIN = /(?<![\w-])((?:create-)?historic-city)@\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?(?![\w.])/g;

/** `text` with every pinned CLI command at `version`. */
export function bumpDocPins(text: string, version: string): string {
    return text.replace(CLI_PIN, (_pin, name: string) => `${name}@${version}`);
}

/** `packages/engine/src/index.ts` with `ENGINE_VERSION` at `version`; the constant must be declared exactly once. */
export function bumpEngineSource(source: string, version: string): string {
    const found = source.match(ENGINE_VERSION_LINE)?.length ?? 0;
    if (found !== 1) {
        throw new ReleaseError(`${ENGINE_INDEX}: expected one \`export const ENGINE_VERSION = '…';\` line, found ${String(found)}`);
    }
    return source.replace(ENGINE_VERSION_LINE, `export const ENGINE_VERSION = '${version}';`);
}

function workspaceNames(files: ReleaseFiles, folders: readonly string[]): Set<string> {
    const names = folders.map((folder) => readJsonObject(files, `${folder}/package.json`)['name']);
    return new Set(names.filter((name): name is string => typeof name === 'string'));
}

function jsonChanges(files: ReleaseFiles, version: string): FileChange[] {
    const root = readJsonObject(files, ROOT_MANIFEST);
    const folders = workspaceFolders(files, root['workspaces']);
    const names = workspaceNames(files, folders);
    const none = new Set<string>();
    const manifests = [ROOT_MANIFEST, ...folders.map((folder) => `${folder}/package.json`)].map((path) => ({
        path,
        text: jsonText(bumpManifest(readJsonObject(files, path), version, names)),
    }));
    return [
        ...manifests,
        { path: LOCKFILE, text: jsonText(bumpLockfile(readJsonObject(files, LOCKFILE), version, folders, names)) },
        { path: DEPLOY_MANIFEST, text: jsonText(bumpManifest(readJsonObject(files, DEPLOY_MANIFEST), version, none)) },
        { path: DEPLOY_LOCKFILE, text: jsonText(bumpLockfile(readJsonObject(files, DEPLOY_LOCKFILE), version, [], none)) },
    ];
}

/** Every file the bump to `version` rewrites, with its new text; a file already at `version` is left out. */
export function planBump(files: ReleaseFiles, version: string): FileChange[] {
    if (!isReleaseVersion(version)) {
        throw new ReleaseError(
            `${JSON.stringify(version)} is not a release version MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N / -rc.N (no v, no other suffix)`,
        );
    }
    if (!files.isFile(ENGINE_INDEX)) {
        throw new ReleaseError(`${ENGINE_INDEX} is missing`);
    }
    const engine = { path: ENGINE_INDEX, text: bumpEngineSource(files.readText(ENGINE_INDEX), version) };
    const docs = PINNED_DOCS.filter((path) => files.isFile(path)).map((path) => ({
        path,
        text: bumpDocPins(files.readText(path), version),
    }));
    return [...jsonChanges(files, version), engine, ...docs].filter((change) => change.text !== files.readText(change.path));
}
