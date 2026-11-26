import { z } from 'zod';

import { validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import { e2eContentSecurityPolicy } from './csp.js';

/**
 * What Firebase Hosting does with a request (`firebase.json` → `hosting`), read from the file itself so the e2e Hosting
 * server (`e2e/mock-apis/admin-server.ts`) and the probe-path tests behave like Hosting without the Hosting emulator,
 * which would apply the admin's `upgrade-insecure-requests` to the http emulators (docs/research/M2b-interfaces.md §6.2).
 * The order is superstatic's (the Hosting emulator's engine, `superstatic/lib/middleware`), as M6 needs it for the public
 * map at the root and the admin under `/admin/` (docs/research/M6-interfaces.md §2.2):
 *
 * 1. `redirects`: the first rule whose `source` glob or `regex` matches the path answers with its status and destination;
 * 2. `headers`: every rule whose `source` glob or `regex` matches the request path adds its headers, in file order (a
 *    later rule's header of the same name wins);
 * 3. the files (`resolveHostingPath`): an exact file (with `cleanUrls`, a `.html` file's address redirects to its clean
 *    one), else a folder's `index.html`, else `<path>.html`; `trailingSlash` adds (true) or removes (false) the slash of a
 *    folder or a clean address with a redirect;
 * 4. `rewrites`: a path with no file is served the first matching rule's destination;
 * 5. `/404.html` with status 404 (and its own headers too), else a plain 404.
 *
 * `ignore`d files (source maps, dot files) are never deployed, so they count as missing. Globs follow Hosting's syntax as far
 * as `firebase.json` uses it: `**` (any path), `*` (one segment), `?` and `@(a|b)`; a `regex` is an ECMAScript expression
 * with the `u` flag over the path (Hosting's RE2 reads the same expressions as long as they hold no lookaround).
 */

const headerSchema = z.object({ key: z.string().min(1), value: z.string() });

/** A rule's path matcher: a glob `source` or a `regex`, exactly one (Hosting refuses a rule with both or neither). */
const matcherFields = { source: z.string().min(1).optional(), regex: z.string().min(1).optional() };

function oneMatcher(rule: { readonly source?: string | undefined; readonly regex?: string | undefined }): boolean {
    return (rule.source === undefined) !== (rule.regex === undefined);
}

const ONE_MATCHER = { message: 'validation.format', path: ['source'] };

const rewriteSchema = z.object({ ...matcherFields, destination: z.string().startsWith('/') }).refine(oneMatcher, ONE_MATCHER);
const redirectSchema = z
    .object({ ...matcherFields, destination: z.string().startsWith('/'), type: z.union([z.literal(301), z.literal(302)]).default(301) })
    .refine(oneMatcher, ONE_MATCHER);
const headerRuleSchema = z.object({ ...matcherFields, headers: z.array(headerSchema) }).refine(oneMatcher, ONE_MATCHER);

const hostingSchema = z.object({
    public: z.string().min(1),
    cleanUrls: z.boolean().default(false),
    /** Unset: the slash only for a folder's index; true: added; false: removed (superstatic's three behaviours). */
    trailingSlash: z.boolean().optional(),
    ignore: z.array(z.string()).default([]),
    redirects: z.array(redirectSchema).default([]),
    rewrites: z.array(rewriteSchema).default([]),
    headers: z.array(headerRuleSchema).default([]),
});

const firebaseJsonSchema = z.object({ hosting: hostingSchema });

export type HostingConfig = z.infer<typeof hostingSchema>;

/** A rule's matcher: a glob `source` or a `regex` (the schema keeps exactly one). */
export interface PathMatcher {
    readonly source?: string | undefined;
    readonly regex?: string | undefined;
}

/** The header that `e2eHostingHeaders` rewrites. */
export const CSP_HEADER = 'Content-Security-Policy';

/** The page Hosting answers a missing path with (status 404), when the site has one. */
export const NOT_FOUND_PAGE = '/404.html';

/** The `hosting` block of a `firebase.json` text; throws SiteBuildError when it is not JSON or has no valid block. */
export function parseHostingConfig(firebaseJson: string, filename = 'firebase.json'): HostingConfig {
    let input: unknown;
    try {
        input = JSON.parse(firebaseJson);
    } catch (error: unknown) {
        throw new SiteBuildError(`${filename}: not JSON: ${String(error)}`);
    }
    const result = validate(firebaseJsonSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${filename}: invalid hosting block\n${issuesText(result.issues)}`);
    }
    return result.value.hosting;
}

const GLOB_TOKENS: readonly (readonly [pattern: RegExp, source: string])[] = [
    [/^\*\*\//, '(?:.*/)?'],
    [/^\*\*/, '.*'],
    [/^\*/, '[^/]*'],
    [/^\?/, '[^/]'],
    [/^@\(([^)]*)\)/, ''],
];

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface GlobToken {
    readonly source: string;
    readonly length: number;
}

/** The regular expression of one glob token at the start of `rest`, and its length; null for a literal character. */
function globToken(rest: string): GlobToken | null {
    for (const [pattern, source] of GLOB_TOKENS) {
        const match = pattern.exec(rest);
        if (match !== null) {
            const alternatives = match[1]?.split('|').map(escapeRegExp).join('|');
            return { source: alternatives === undefined ? source : `(?:${alternatives})`, length: match[0].length };
        }
    }
    return null;
}

/** The token at the start of `rest`: a glob token, else its first character, escaped. */
function nextToken(rest: string): GlobToken {
    return globToken(rest) ?? { source: escapeRegExp(rest.charAt(0)), length: 1 };
}

/** A Hosting glob as an anchored expression over a path with its leading `/` removed. */
export function globToRegExp(glob: string): RegExp {
    let source = '';
    let rest = glob.replace(/^\//, '');
    while (rest !== '') {
        const token = nextToken(rest);
        source += token.source;
        rest = rest.slice(token.length);
    }
    return new RegExp(`^${source}$`);
}

/** Whether a rule's glob or regular expression matches `path` (an absolute request path). */
export function ruleMatches(rule: PathMatcher, path: string): boolean {
    if (rule.regex !== undefined) {
        return new RegExp(rule.regex, 'u').test(path);
    }
    return globToRegExp(rule.source ?? '').test(path.replace(/^\//, ''));
}

/** The headers Hosting adds to a response for `path` (a later rule overrides an earlier one's header of the same name). */
export function hostingHeaders(config: HostingConfig, path: string): Record<string, string> {
    const applied = config.headers.filter((rule) => ruleMatches(rule, path)).flatMap((rule) => rule.headers);
    return Object.fromEntries(applied.map((header) => [header.key, header.value]));
}

/** True when `path` names a file Hosting never deploys (`ignore`). */
export function isIgnored(config: HostingConfig, path: string): boolean {
    return config.ignore.some((glob) => ruleMatches({ source: glob }, path));
}

/** The destination of the first rewrite whose source matches `path`, or undefined. */
export function rewriteOf(config: HostingConfig, path: string): string | undefined {
    return config.rewrites.find((rule) => ruleMatches(rule, path))?.destination;
}

/** A configured redirect of `path`: its status and destination (the request's query kept), or undefined. */
export function redirectOf(config: HostingConfig, path: string, search = ''): HostingRedirect | undefined {
    const rule = config.redirects.find((candidate) => ruleMatches(candidate, path));
    return rule === undefined ? undefined : { kind: 'redirect', status: rule.type, location: `${rule.destination}${search}` };
}

/** What Hosting answers for a path: a redirect, or a deployed file with its status (404 for the not-found page). */
export interface HostingRedirect {
    readonly kind: 'redirect';
    readonly status: number;
    readonly location: string;
}
export type HostingAnswer =
    HostingRedirect | { readonly kind: 'file'; readonly file: string; readonly status: 200 | 404 } | { readonly kind: 'missing' };

/** Whether a deployed file exists at an absolute site path (`/admin/index.html`); the caller applies `ignore`. */
export type DeployedFile = (path: string) => boolean;

function withSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

function withoutSlash(path: string): string {
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function withoutSuffix(path: string, suffix: string): string {
    return path.endsWith(suffix) ? path.slice(0, -suffix.length) : path;
}

function redirect(location: string, search: string): HostingRedirect {
    return { kind: 'redirect', status: 301, location: `${location === '' ? '/' : location}${search}` };
}

/** What the trailing-slash behaviour does to an address: add the slash, remove it, or serve the address as it is. */
type SlashMove = 'add' | 'remove' | 'keep';

/** The address of `config`'s `trailingSlash`, `slashed` and `cleanUrls`, as the tables below read it. */
function slashKey(trailingSlash: boolean | undefined, slashed: boolean, cleanUrls?: boolean): string {
    return [trailingSlash, slashed, cleanUrls].map(String).join(':');
}

/** superstatic's moves for a folder's address (its `index.html` exists); anything else is served as it is. */
const FOLDER_SLASH: Readonly<Record<string, SlashMove>> = {
    [slashKey(true, false, true)]: 'add',
    [slashKey(true, false, false)]: 'add',
    [slashKey(false, true, true)]: 'remove',
    [slashKey(false, true, false)]: 'remove',
    [slashKey(undefined, false, false)]: 'add',
};

/** superstatic's moves for a clean address (`<path>.html` exists). */
const CLEAN_SLASH: Readonly<Record<string, SlashMove>> = {
    [slashKey(true, false)]: 'add',
    [slashKey(false, true)]: 'remove',
};

/** An exact file: served, or with `cleanUrls` a `.html` address redirected to its clean one. */
function exactFile(config: HostingConfig, path: string, search: string): HostingAnswer {
    if (!config.cleanUrls || !path.endsWith('.html')) {
        return { kind: 'file', file: path, status: 200 };
    }
    const clean = withoutSuffix(withoutSuffix(path, '.html'), '/index');
    return redirect(config.trailingSlash === true ? withSlash(clean) : clean, search);
}

/** Where a move sends a folder's address, or null when it is served as it is (the root never loses its slash). */
function moved(path: string, move: SlashMove): string | null {
    if (move === 'add') {
        return withSlash(path);
    }
    return move === 'remove' && path !== '/' ? withoutSlash(path) : null;
}

/** A folder's `index.html`, after the trailing-slash redirect its behaviour asks for. */
function folderIndex(config: HostingConfig, path: string, search: string): HostingAnswer {
    const target = moved(path, FOLDER_SLASH[slashKey(config.trailingSlash, path.endsWith('/'), config.cleanUrls)] ?? 'keep');
    return target === null ? { kind: 'file', file: `${withSlash(path)}index.html`, status: 200 } : redirect(target, search);
}

/** The `.html` file a clean address names, or null (a slashed address without a trailing-slash behaviour names none). */
function cleanCandidate(config: HostingConfig, path: string): string | null {
    if (!path.endsWith('/')) {
        return `${path}.html`;
    }
    return config.trailingSlash === undefined ? null : `${withoutSlash(path)}.html`;
}

/** Where a clean address goes instead of being served: its trailing-slash move, or its `/index` dropped; null: nowhere. */
function cleanRedirect(config: HostingConfig, path: string, file: string): string | null {
    const move = CLEAN_SLASH[slashKey(config.trailingSlash, path.endsWith('/'))] ?? 'keep';
    if (move === 'add') {
        return withSlash(withoutSuffix(withoutSuffix(file, '.html'), '/index'));
    }
    if (move === 'remove') {
        return withoutSlash(path);
    }
    return file.endsWith('/index.html') ? withoutSuffix(file, '/index.html') : null;
}

/** The clean address's `.html` file, served or redirected, or null when there is none. */
function cleanFile(config: HostingConfig, path: string, search: string, exists: DeployedFile): HostingAnswer | null {
    const file = cleanCandidate(config, path);
    if (file === null || !exists(file)) {
        return null;
    }
    const target = cleanRedirect(config, path, file);
    return target === null ? { kind: 'file', file, status: 200 } : redirect(target, search);
}

/** Steps 3 to 5 of the order above for a path no configured redirect took. */
function servedFile(config: HostingConfig, path: string, search: string, exists: DeployedFile): HostingAnswer {
    if (exists(path)) {
        return exactFile(config, path, search);
    }
    if (exists(`${withSlash(path)}index.html`)) {
        return folderIndex(config, path, search);
    }
    const clean = config.cleanUrls ? cleanFile(config, path, search, exists) : null;
    return clean ?? rewrittenOrMissing(config, path, exists);
}

function rewrittenOrMissing(config: HostingConfig, path: string, exists: DeployedFile): HostingAnswer {
    const destination = rewriteOf(config, path);
    if (destination !== undefined && exists(destination)) {
        return { kind: 'file', file: destination, status: 200 };
    }
    return exists(NOT_FOUND_PAGE) ? { kind: 'file', file: NOT_FOUND_PAGE, status: 404 } : { kind: 'missing' };
}

/**
 * What Hosting answers for the request path `path` (absolute, decoded) with the query `search` (`?…` or empty), given
 * which files the site deployed (`exists`, `ignore` already applied): the order of this module's header comment.
 */
export function resolveHostingPath(config: HostingConfig, path: string, search: string, exists: DeployedFile): HostingAnswer {
    const normalized = path.replace(/\/{2,}/g, '/');
    return redirectOf(config, normalized, search) ?? servedFile(config, normalized, search, exists);
}

/** The headers of the answer to `path`: the path's, and for the not-found page also its own (superstatic's `missing`). */
export function answerHeaders(config: HostingConfig, path: string, answer: HostingAnswer): Record<string, string> {
    if (answer.kind === 'redirect' && redirectOf(config, path) !== undefined) {
        return {};
    }
    const own = hostingHeaders(config, path);
    return answer.kind === 'file' && answer.status === 404 ? { ...own, ...hostingHeaders(config, NOT_FOUND_PAGE) } : own;
}

/**
 * `headers` as the e2e Hosting server sends them: Hosting's, with the CSP's `upgrade-insecure-requests` dropped and
 * `connect` added to its `connect-src`; nothing else differs (`scripts/site/test/admin-hosting.test.ts`).
 */
export function e2eHeaders(headers: Readonly<Record<string, string>>, connect: readonly string[]): Record<string, string> {
    const policy = headers[CSP_HEADER];
    return policy === undefined ? { ...headers } : { ...headers, [CSP_HEADER]: e2eContentSecurityPolicy(policy, connect) };
}

/** The headers of `path` as the e2e Hosting server sends them (`e2eHeaders` of `hostingHeaders`). */
export function e2eHostingHeaders(config: HostingConfig, path: string, connect: readonly string[]): Record<string, string> {
    return e2eHeaders(hostingHeaders(config, path), connect);
}
