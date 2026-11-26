import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { STANDARD_LICENCE_TEXTS } from './licence-texts.js';

/**
 * The third-party notices of a Vite build (the user's decision of 2026-10-23, `DECISIONS-for-review.md` §52d;
 * `docs/research/M4-interfaces.md` §6.4): `THIRD_PARTY_NOTICES.txt` beside the build's entry (`engine.mjs`,
 * `admin.mjs`), listing every npm package whose code the bundle carries, with its exact version, its licence id and the
 * licence's full text, so whoever receives the files receives the licences with them.
 *
 * - A package is bundled when a module of it renders code into an output chunk (Rolldown's `modules` of each chunk with a
 *   `renderedLength` above zero): a module the bundler shook out entirely carries nothing. Its package is the folder
 *   under the last `node_modules/` of the module's path, and its `package.json` names it.
 * - Files the build copies from npm packages (the self-hosted fonts, `assets`) list their package too, with the files.
 * - The licence text is the package's own `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*` files. A package that ships
 *   none (the Firebase JS SDK's, Terra Draw's) gets the copyright lines of its bundled files (else its `author`) and the
 *   standard text of the licence it declares (`licence-texts.ts`); a licence without a standard text stops the build.
 * - The bundler's own helpers (Rolldown's runtime, Vite's preload helper) are generated code, not a package's files.
 *   Mapbox GL JS is external (pages load it from api.mapbox.com) and never appears.
 *
 * The output is sorted and carries no date, so the same install builds the same file. Its frame (a rule of `=` opens an
 * entry, `Package:`, `Version:`, `Licence:`, `File:`, `Licence text:` and `Notice:` lines, a rule of `-` ends the header)
 * is what the `notices` gate (`scripts/ci/check_notices.py`) parses to check the file against the build's source maps.
 */

/**
 * A package the notices cannot describe: the build stops. Its own class, not the site build's `SiteBuildError`: the Vite
 * configs load this module through Node, where `errors.ts`'s import of `@hcm/shared` (TypeScript sources) cannot load.
 */
export class NoticesError extends Error {
    override readonly name = 'NoticesError';
}

/** The notices file's name, beside the build's entry script. */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

const RULE = '='.repeat(80);
const DIVIDER = '-'.repeat(80);
const NODE_MODULES = '/node_modules/';
/** A package's own licence files: LICENSE, LICENCE, COPYING and NOTICE, with any extension or suffix. */
const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-][\w.-]*)?$/i;
/** The comment marks a copyright line starts with (`/*!`, ` * `, `// `, `# `). */
const COMMENT_START = /^[/*!#]+\s*/;

/** A file the build copies from an npm package into its output. */
interface NoticeAsset {
    /** The npm package the file comes from. */
    readonly package: string;
    /** The file's path in the build's output folder (`fonts/roboto-flex-latin-wght.woff2`). */
    readonly file: string;
}

export interface NoticesOptions {
    /** What the files are, for the first line (`the Historic City Map Maker engine`). */
    readonly product: string;
    /** Files copied into the output from npm packages (the self-hosted fonts), each listed under its package. */
    readonly assets?: readonly NoticeAsset[];
    /**
     * Modules the build's files carry besides its own chunks: the engine's extras, built apart and emitted as assets
     * (`engine-extras.ts`), read when each output is generated.
     */
    readonly moreModules?: () => Iterable<string>;
    /** Where the assets' packages are looked up from (Node's way: `node_modules` here and upwards); default the working directory. */
    readonly from?: string;
}

/** The part of an output chunk the notices read (Rolldown's `OutputChunk`). */
interface BundleChunk {
    readonly type: 'chunk';
    readonly modules: Readonly<Record<string, { readonly renderedLength: number }>>;
}

interface BundleAsset {
    readonly type: 'asset';
}

type Bundle = Readonly<Record<string, BundleChunk | BundleAsset>>;

/** The part of the plugin context the notices use. */
interface EmitContext {
    emitFile(file: { readonly type: 'asset'; readonly fileName: string; readonly source: string }): string;
}

interface NoticesPlugin {
    readonly name: string;
    generateBundle(this: EmitContext, output: unknown, bundle: Bundle): void;
}

interface Manifest {
    readonly name: string;
    readonly version: string;
    readonly licence: string;
    readonly author: string | null;
}

/** One package: where it is installed, what it says of itself, its bundled modules and its copied files. */
interface Gathered {
    readonly root: string;
    readonly manifest: Manifest;
    readonly modules: string[];
    readonly files: string[];
}

interface PackageNotice {
    readonly manifest: Manifest;
    readonly files: readonly string[];
    readonly licenceFiles: readonly string[];
    readonly notices: readonly string[];
    readonly text: string;
}

/** A fixed order, whatever the machine's locale. */
function byText(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

function stringField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** `Jane Doe <jane@example.org> (https://example.org)` or `{ name: 'Jane Doe' }` -> `Jane Doe`; null when absent. */
function authorName(author: unknown): string | null {
    const text = stringField(isRecord(author) ? author['name'] : author);
    const cut = text.search(/[<(]/);
    const name = (cut < 0 ? text : text.slice(0, cut)).trim();
    return name === '' ? null : name;
}

function readManifest(root: string): Manifest {
    const data = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    const name = stringField(data['name']);
    const version = stringField(data['version']);
    if (name === '' || version === '') {
        throw new NoticesError(`${root}/package.json names no package or no version`);
    }
    return { name, version, licence: stringField(data['license']) || 'UNKNOWN', author: authorName(data['author']) };
}

/** A module id without its query (`x.js?commonjs-proxy` -> `x.js`). */
function withoutQuery(id: string): string {
    const query = id.indexOf('?');
    return query < 0 ? id : id.slice(0, query);
}

/** `/r/node_modules/a/node_modules/@s/b/x.js` -> `/r/node_modules/a/node_modules/@s/b`; null outside `node_modules`. */
function packageRoot(file: string): string | null {
    const path = file.replaceAll('\\', '/');
    const at = path.lastIndexOf(NODE_MODULES);
    if (at < 0) {
        return null;
    }
    const start = at + NODE_MODULES.length;
    const rest = path.slice(start);
    const length = rest.startsWith('@') ? 2 : 1;
    return path.slice(0, start) + rest.split('/').slice(0, length).join('/');
}

/** The files of the modules that render code into `output` (none for an asset). */
function renderedFiles(output: BundleChunk | BundleAsset): string[] {
    if (output.type !== 'chunk') {
        return [];
    }
    return Object.entries(output.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => withoutQuery(id));
}

/** Module files that render code, by their package folder (added to `found`). */
function addBundledModules(found: Map<string, Set<string>>, files: Iterable<string>): void {
    for (const file of files) {
        const root = packageRoot(file);
        if (root !== null) {
            found.set(root, (found.get(root) ?? new Set<string>()).add(file));
        }
    }
}

function isFile(path: string): boolean {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

/** The folder of `name` as Node finds it from `from`: `node_modules/<name>` there or in a folder above. */
function findPackage(name: string, from: string): string {
    for (let dir = from; ; dir = dirname(dir)) {
        const candidate = join(dir, 'node_modules', name);
        if (isFile(join(candidate, 'package.json'))) {
            return candidate.replaceAll('\\', '/');
        }
        if (dirname(dir) === dir) {
            throw new NoticesError(`the package ${name} of a copied file is not installed (looked up from ${from})`);
        }
    }
}

/** The copied files by their package's folder. */
function assetFiles(options: NoticesOptions): Map<string, string[]> {
    const from = options.from ?? process.cwd();
    const files = new Map<string, string[]>();
    for (const asset of options.assets ?? []) {
        const root = findPackage(asset.package, from);
        files.set(root, [...(files.get(root) ?? []), asset.file]);
    }
    return files;
}

/** Every package folder with its bundled modules and its copied files, one per name and version. */
function gather(bundled: ReadonlyMap<string, ReadonlySet<string>>, options: NoticesOptions): Gathered[] {
    const files = assetFiles(options);
    const byKey = new Map<string, Gathered>();
    for (const root of new Set([...bundled.keys(), ...files.keys()])) {
        const manifest = readManifest(root);
        const key = `${manifest.name}@${manifest.version}`;
        const entry = byKey.get(key) ?? { root, manifest, modules: [], files: [] };
        entry.modules.push(...(bundled.get(root) ?? []));
        entry.files.push(...(files.get(root) ?? []));
        byKey.set(key, entry);
    }
    return [...byKey.values()];
}

function normalised(text: string): string {
    return text
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();
}

function licenceFilesOf(root: string): string[] {
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort(byText);
}

/** `Copyright 2019 Google LLC` from ` * Copyright 2019 Google LLC.`; null for a line that is not a copyright line. */
function copyrightOf(line: string): string | null {
    const text = line.trim().replace(COMMENT_START, '');
    if (!text.startsWith('Copyright')) {
        return null;
    }
    let end = text.length;
    while (' */.'.includes(text.charAt(end - 1))) {
        end -= 1;
    }
    return text.slice(0, end);
}

function readable(path: string): string {
    return isFile(path) ? readFileSync(path, 'utf8') : '';
}

/** The copyright lines of the package's bundled files, else a line naming its author. */
function copyrightNotices(gathered: Gathered): string[] {
    const lines = gathered.modules.flatMap((module) => readable(module).split('\n'));
    const found = [...new Set(lines.map(copyrightOf).filter((line) => line !== null))].sort(byText);
    if (found.length > 0) {
        return found;
    }
    const author = gathered.manifest.author;
    return [
        author === null ? "the package's authors (it ships no copyright notice)" : `${author} (its author; it ships no copyright notice)`,
    ];
}

function noticeOf(gathered: Gathered): PackageNotice {
    const { root, manifest } = gathered;
    const files = [...gathered.files].sort(byText);
    const licenceFiles = licenceFilesOf(root);
    if (licenceFiles.length > 0) {
        const texts = licenceFiles.map((name) => {
            const body = normalised(readFileSync(join(root, name), 'utf8'));
            return licenceFiles.length > 1 ? `${name}:\n\n${body}` : body;
        });
        return { manifest, files, licenceFiles, notices: [], text: texts.join('\n\n') };
    }
    const standard = STANDARD_LICENCE_TEXTS[manifest.licence];
    if (standard === undefined) {
        throw new NoticesError(
            `${manifest.name}@${manifest.version} ships no licence file and declares "${manifest.licence}", ` +
                'which has no standard text in scripts/site/src/licence-texts.ts',
        );
    }
    return { manifest, files, licenceFiles, notices: copyrightNotices(gathered), text: standard };
}

function entryOf(notice: PackageNotice): string {
    const { manifest } = notice;
    const source =
        notice.licenceFiles.length > 0
            ? `${notice.licenceFiles.join(', ')} of the package`
            : `the standard ${manifest.licence} text (the package ships no licence file)`;
    return [
        RULE,
        `Package: ${manifest.name}`,
        `Version: ${manifest.version}`,
        `Licence: ${manifest.licence}`,
        ...notice.files.map((file) => `File: ${file}`),
        `Licence text: ${source}`,
        ...notice.notices.map((line) => `Notice: ${line}`),
        DIVIDER,
        '',
        notice.text,
        '',
    ].join('\n');
}

/** The whole file: the introduction, then one entry per package, sorted by name and version. */
function noticesText(options: NoticesOptions, bundled: ReadonlyMap<string, ReadonlySet<string>>): string {
    const notices = gather(bundled, options)
        .map(noticeOf)
        .sort((a, b) => byText(a.manifest.name, b.manifest.name) || byText(a.manifest.version, b.manifest.version));
    const intro = [
        `Third-party notices for ${options.product}`,
        '',
        'Every npm package whose code these files carry, and every package a copied file (a font) comes from, is listed',
        'below with its exact version, its licence and the licence text. Generated at build time from the installed',
        'packages (scripts/site/src/notices.ts); Mapbox GL JS is not part of these files: pages load it from',
        'api.mapbox.com under its own terms.',
        '',
        `Packages: ${String(notices.length)}`,
        '',
    ].join('\n');
    return [intro, ...notices.map(entryOf)].join('\n');
}

/**
 * The Vite (Rolldown) plugin: after each output is generated, it emits `THIRD_PARTY_NOTICES.txt` for every package
 * bundled so far by this plugin instance, which lives for one `vite build` (a library build with two formats writes the
 * file twice, the second time complete). It never clears between outputs: Vite starts one build per library format
 * (`buildStart` runs twice), and the IIFE may carry a package the ES build does not (`lit`, since swipe compare's lazy
 * chunk is inlined there; docs/research/M4-interfaces.md CR-M4-19).
 */
export function thirdPartyNoticesPlugin(options: NoticesOptions): NoticesPlugin {
    const bundled = new Map<string, Set<string>>();
    return {
        name: 'hcm-third-party-notices',
        generateBundle(_output, bundle) {
            addBundledModules(bundled, Object.values(bundle).flatMap(renderedFiles));
            addBundledModules(bundled, options.moreModules?.() ?? []);
            this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: noticesText(options, bundled) });
        },
    };
}
