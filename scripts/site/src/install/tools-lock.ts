/**
 * The install bundle's `tools/` folder (`docs/research/M6-interfaces.md` §1.3): a `package.json` that pins
 * `firebase-tools` and the `package-lock.json` of its tree, cut offline from the repository's own lockfile (no registry
 * call): every package Node would resolve from `node_modules/firebase-tools`, through its dependencies, optional
 * dependencies and required peers, at the same paths. `npm ci` in the build then installs exactly that tree, each
 * package checked against its integrity.
 *
 * `npm ci` installs the lock only when `package.json` asks for the same tree, so `tools/package.json` carries the root
 * `package.json`'s advisory `overrides` too (an overridden version is outside its dependant's range, and without the
 * override npm would resolve that dependency again). A package the root installs from a vendored copy
 * (`vendor/npm/<name>`, linked through `"<name>": "$<name>"`) is linked the same way in `tools/`: the bundle carries the
 * copy's files under `tools/vendor/npm/<name>/` (`vendored`), and `tools/package.json` names it as a `file:` dependency.
 */
import { FIREBASE_TOOLS_VERSION } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';

interface LockPackage {
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
    readonly dev?: boolean;
    readonly devOptional?: boolean;
    readonly optional?: boolean;
    readonly link?: boolean;
    readonly resolved?: string;
    readonly [key: string]: unknown;
}

export interface Lockfile {
    readonly lockfileVersion?: number;
    readonly packages: Readonly<Record<string, LockPackage>>;
}

/** What `toolsFolder` reads of the root `package.json`: its `overrides`. */
export interface RootManifest {
    readonly overrides?: Readonly<Record<string, unknown>>;
}

/** `tools/package.json`, `tools/package-lock.json` and the vendored folders the lock links to. */
export interface ToolsFolder {
    readonly packageJson: string;
    readonly packageLock: string;
    /** Repository folders (`vendor/npm/<name>`) the bundle carries under `tools/` at the same path. */
    readonly vendored: readonly string[];
}

const TOOL = 'firebase-tools';
const TOOLS_NAME = 'hcm-install-tools';
/** The only folder a link of the tools' tree may point into: the vendored advisory fixes. */
const VENDOR = 'vendor/npm/';

/** The package at `from` and every package it sits in, innermost first, then the root (''). */
function ancestors(from: string): string[] {
    const bases = [from];
    let base = from;
    while (base !== '') {
        const parent = base.lastIndexOf('/node_modules/');
        base = parent === -1 ? '' : base.slice(0, parent);
        bases.push(base);
    }
    return bases;
}

/** The path Node resolves `name` to from the package at `from` (its own `node_modules`, then each parent's), or null. */
export function resolvePackage(packages: Lockfile['packages'], from: string, name: string): string | null {
    const candidates = ancestors(from).map((base) => (base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`));
    return candidates.find((candidate) => packages[candidate] !== undefined) ?? null;
}

/** What a package needs installed: its dependencies, optional ones (each `optional`), its peers that are not optional. */
function needs(entry: LockPackage): readonly (readonly [string, boolean])[] {
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    const peers = Object.keys(entry.peerDependencies ?? {}).filter((name) => optionalPeers[name]?.optional !== true);
    return [
        ...Object.keys(entry.dependencies ?? {}).map((name) => [name, false] as const),
        ...peers.map((name) => [name, false] as const),
        ...Object.keys(entry.optionalDependencies ?? {}).map((name) => [name, true] as const),
    ];
}

const DEV_FLAGS: ReadonlySet<string> = new Set(['dev', 'devOptional']);

/** An entry as the tools' lock keeps it: a runtime dependency (no `dev` flag; `devOptional` becomes `optional`). */
function runtimeEntry(entry: LockPackage): LockPackage {
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !DEV_FLAGS.has(key)));
    return entry.devOptional === true ? { ...rest, optional: true } : rest;
}

function entryAt(lock: Lockfile, path: string): LockPackage {
    return lock.packages[path] ?? {};
}

/** Where `name` resolves from `path`; a required package the lockfile cannot resolve stops the build. */
function resolveNeed(lock: Lockfile, path: string, name: string, optional: boolean): string | null {
    const found = resolvePackage(lock.packages, path, name);
    if (found === null && !optional) {
        throw new SiteBuildError(`the lockfile cannot resolve ${name} for ${path}`);
    }
    return found;
}

/** Where a link entry points: a vendored folder the lockfile holds; any other link stops the build. */
function linkTarget(lock: Lockfile, path: string): string | null {
    const entry = entryAt(lock, path);
    if (entry.link !== true) {
        return null;
    }
    const target = entry.resolved ?? '';
    if (!target.startsWith(VENDOR) || lock.packages[target] === undefined) {
        throw new SiteBuildError(`${path} links to '${target}', which the install bundle cannot carry`);
    }
    return target;
}

/** The lock paths a package leads to: what it needs, and for a link the folder it points to. */
function nextPaths(lock: Lockfile, path: string): string[] {
    const target = linkTarget(lock, path);
    const found = needs(entryAt(lock, path)).map(([name, optional]) => resolveNeed(lock, path, name, optional));
    return [...found, target].filter((next): next is string => next !== null);
}

/** Every lock path the tool needs, from `node_modules/firebase-tools`. */
function treeOf(lock: Lockfile, root: string): string[] {
    const seen = new Set<string>([root]);
    const queue = [root];
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        for (const found of nextPaths(lock, path).filter((next) => !seen.has(next))) {
            seen.add(found);
            queue.push(found);
        }
    }
    return [...seen].sort((left, right) => (left < right ? -1 : 1));
}

const NODE_MODULES = 'node_modules/';

/** The tree's links to vendored copies, as `tools/package.json` names them: package name → `file:` folder. */
function vendoredLinks(lock: Lockfile, tree: readonly string[]): Record<string, string> {
    const links = tree.filter((path) => entryAt(lock, path).link === true);
    const name = (path: string): string => path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    return Object.fromEntries(links.map((path) => [name(path), `file:${String(entryAt(lock, path).resolved)}`]));
}

/** The root's `overrides`, but a `$name` reference to a root dependency `tools/package.json` does not have. */
function toolsOverrides(root: RootManifest, dependencies: Readonly<Record<string, string>>): Record<string, unknown> {
    const kept = (spec: unknown): boolean =>
        typeof spec !== 'string' || !spec.startsWith('$') || Object.hasOwn(dependencies, spec.slice(1));
    return Object.fromEntries(Object.entries(root.overrides ?? {}).filter(([, spec]) => kept(spec)));
}

/**
 * `tools/package.json` and `tools/package-lock.json` for the pinned `firebase-tools`, from the repository's lockfile and
 * the root `package.json`'s `overrides`, and the vendored folders the bundle carries beside them.
 */
export function toolsFolder(lock: Lockfile, rootManifest: RootManifest): ToolsFolder {
    const root = `node_modules/${TOOL}`;
    if (lock.packages[root]?.version !== FIREBASE_TOOLS_VERSION) {
        throw new SiteBuildError(`the lockfile does not hold ${TOOL} ${FIREBASE_TOOLS_VERSION}`);
    }
    const tree = treeOf(lock, root);
    const dependencies = { [TOOL]: FIREBASE_TOOLS_VERSION, ...vendoredLinks(lock, tree) };
    const overrides = toolsOverrides(rootManifest, dependencies);
    const packages = Object.fromEntries(tree.map((path) => [path, runtimeEntry(entryAt(lock, path))]));
    const packageJson = { name: TOOLS_NAME, version: '1.0.0', private: true, dependencies, overrides };
    const packageLock = {
        name: TOOLS_NAME,
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: TOOLS_NAME, version: '1.0.0', dependencies }, ...packages },
    };
    return {
        packageJson: `${JSON.stringify(packageJson, null, 4)}\n`,
        packageLock: `${JSON.stringify(packageLock, null, 4)}\n`,
        vendored: tree.filter((path) => path.startsWith(VENDOR)),
    };
}
