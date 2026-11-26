/**
 * The self-host bundle the package carries (`dist/self-host/`, `npm run build:self-host` at a release, which builds the
 * admin, the Hosting tree, the functions and the start site for production first; the `release` stage's `self-host-bundle` gate assembles it before
 * `release-pack`: `docs/research/M5-interfaces.md` §4.4), assembled from the repository's own builds:
 *
 * ```text
 * hosting/                    the start site's release tree (dist/start, a production build; M14 §6), which names no
 *                             project and holds no Bucharest: the admin at `admin/` (M6) with the generic install bundle
 *                             Setup's Install and Publish read at `admin/install/<slug>/`, the city page and its engine.
 *                             Without the bundle and the city page a self-hosted project cannot publish its map.
 *                             Less `admin/runtime.json`, which a project writes itself, as it does `project.json`
 * functions/                  functions/dist: index.js, package.json, package-lock.json and export-kit/ (no .env.*)
 * rules/                      firebase/firestore.rules, firestore.indexes.json, storage.rules
 * firebase.template.json      firebase.json for any project: the paths above, no build steps, no emulators, and
 *                             the repository's project id replaced by __PROJECT_ID__ (its Hosting site and CSP); the
 *                             site's root redirects to `/admin/` until the map is published (no viewer page yet)
 * bundle.json                 the release the tree was built from, and the files of `hosting/` that hold the project's
 *                             token (the manifest's templates), which `server-files.ts` fills in
 * ```
 *
 * Nothing secret is copied: the admin build and the rules are public, and the functions' `.env.<project>` files (public
 * values of the repository's own project) stay behind.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUNDLE, PROJECT_TOKEN } from './server-files.js';

/** Where the inputs and the output are, from the repository's root. */
export interface BundleLayout {
    readonly root: string;
    /** The start site (`npm run build:start`). */
    readonly startSite: string;
    readonly functionsDist: string;
    readonly firebaseConfig: string;
    readonly rules: readonly string[];
    readonly projectFile: string;
    readonly out: string;
}

export const DEFAULT_LAYOUT: Omit<BundleLayout, 'root'> = {
    startSite: 'dist/start',
    functionsDist: 'functions/dist',
    firebaseConfig: 'firebase.json',
    rules: ['firebase/firestore.rules', 'firebase/firestore.indexes.json', 'firebase/storage.rules'],
    projectFile: 'infra/project.json',
    out: 'packages/create-historic-city/dist/self-host',
};

/**
 * Only the admin's `e2e` build (`vite build --mode e2e`, which writes the same `packages/admin/dist`) carries the OAuth
 * stand-in's page (`packages/admin/src/auth/stand-in.ts`); a bundle made from it would sign owners in against a mock.
 */
export const E2E_BUILD_MARKER = '/__oauth/authorize';

/** The tree's file a self-hosted project writes itself. */
const OWN_RUNTIME = 'admin/runtime.json';
/** The functions' artifact, without its per-project `.env.*`. */
const FUNCTIONS_TAKEN = /^(?:index\.js|package\.json|package-lock\.json|export-kit)$/;

const json = (value: unknown): string => `${JSON.stringify(value, null, 4)}\n`;

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function copyEntries(from: string, to: string, keep: (name: string) => boolean): number {
    if (!existsSync(from)) {
        throw new Error(`${from} is missing: build it first (npm run build)`);
    }
    const names = readdirSync(from).filter(keep);
    for (const name of names) {
        cpSync(join(from, name), join(to, name), { recursive: true });
    }
    return names.length;
}

type Config = Record<string, unknown>;

function only(value: unknown): Config {
    return { ...(Array.isArray(value) ? (value[0] as Config) : (value as Config)) };
}

/** A self-hosted project's site before its map is published: its root is the admin (M6: the admin under `/admin/`). */
const ROOT_TO_ADMIN = { source: '/', destination: '/admin/', type: 302 } as const;

function redirectsOf(hosting: Config): unknown[] {
    const redirects = hosting['redirects'];
    return Array.isArray(redirects) ? redirects : [];
}

/** firebase.json for any project: the bundle's paths, no `predeploy`, no emulators or schema, the project tokenised. */
export function selfHostFirebaseConfig(config: Config, projectId: string): string {
    const kept: Config = Object.fromEntries(Object.entries(config).filter(([key]) => key !== '$schema' && key !== 'emulators'));
    const functions = only(kept['functions']);
    const hosting = only(kept['hosting']);
    delete functions['predeploy'];
    delete hosting['predeploy'];
    const rewritten = {
        ...kept,
        firestore: { ...only(kept['firestore']), rules: 'rules/firestore.rules', indexes: 'rules/firestore.indexes.json' },
        storage: { rules: 'rules/storage.rules' },
        functions: [{ ...functions, source: 'functions' }],
        hosting: { ...hosting, public: 'hosting', redirects: [...redirectsOf(hosting), ROOT_TO_ADMIN] },
    };
    return json(rewritten).replaceAll(projectId, PROJECT_TOKEN);
}

/** Throws unless `adminDist` is a production build: no script of it carries the e2e build's marker (`docs/LESSONS.md` 247). */
function requireProductionAdmin(adminDist: string): void {
    const scripts = existsSync(adminDist) ? readdirSync(adminDist).filter((name) => /\.m?js$/.test(name)) : [];
    const e2e = scripts.find((name) => readFileSync(join(adminDist, name), 'utf8').includes(E2E_BUILD_MARKER));
    if (e2e !== undefined) {
        throw new Error(`${adminDist}/${e2e} is the admin's e2e build: run npm run build:admin and npm run build:start first`);
    }
}

interface StartRelease {
    readonly release: string;
    readonly tree: string;
    readonly templates: readonly string[];
}

/** The start site's release: where its tree is, and which of its files hold the project's token. */
function startRelease(startSite: string): StartRelease {
    if (!existsSync(startSite)) {
        throw new Error(`${startSite} is missing: build it first (npm run build:start)`);
    }
    const { release: slug } = readJson(join(startSite, 'start-config.json')) as { readonly release: string };
    const folder = join(startSite, 'release', slug);
    const manifest = readJson(join(folder, 'start-release.json')) as {
        readonly release: string;
        readonly files: readonly { readonly path: string; readonly template?: boolean }[];
    };
    return {
        release: manifest.release,
        tree: join(folder, 'tree'),
        templates: manifest.files.filter((file) => file.template === true && file.path !== OWN_RUNTIME).map((file) => file.path),
    };
}

/** Assembles the bundle into `layout.out` (replaced); throws when an input build is missing or the admin's is not production. */
export function buildSelfHostBundle(layout: BundleLayout): { readonly hosting: number; readonly functions: number } {
    const at = (path: string): string => join(layout.root, path);
    const start = startRelease(at(layout.startSite));
    requireProductionAdmin(join(start.tree, 'admin'));
    const out = at(layout.out);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'rules'), { recursive: true });
    const hosting = copyEntries(start.tree, join(out, 'hosting'), () => true);
    rmSync(join(out, 'hosting', OWN_RUNTIME), { force: true });
    const functions = copyEntries(at(layout.functionsDist), join(out, 'functions'), (name) => FUNCTIONS_TAKEN.test(name));
    for (const rule of layout.rules) {
        cpSync(at(rule), join(out, 'rules', rule.slice(rule.lastIndexOf('/') + 1)));
    }
    const projectId = String(readJson(at(layout.projectFile))['projectId']);
    writeFileSync(join(out, BUNDLE.firebaseTemplate), selfHostFirebaseConfig(readJson(at(layout.firebaseConfig)), projectId));
    writeFileSync(join(out, BUNDLE.release), json({ release: start.release, templates: start.templates }));
    return { hosting, functions };
}
