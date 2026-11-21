/**
 * The admin on its own Hosting site (the owner's decision of 2026-11-13, `docs/research/M6-interfaces.md` addendum "The
 * admin on its own site", `DECISIONS-for-review.md` §210): one built Hosting tree (`build:hosting`: the public map at the
 * root, the admin under `/admin/`) becomes two sites at deploy time, once the project's admin site exists.
 *
 * - The admin's folder moves to a tree of its own beside the public one (`<public>-admin/admin/`), with the site's
 *   `release.json` (Setup's release check reads it on the admin's own origin) and a `runtime.json` naming the admin
 *   site's origin (`adminOrigin`: the admin keeps the sign-in in its origin's IndexedDB only there).
 * - `firebase.json`'s single `hosting` entry becomes two: the public map's, whose `/admin` and `/admin/**` answer 301 to
 *   the same path on the admin's site (a browser keeps the address's `#/route` across a redirect, so bookmarks, the
 *   e-mails' and notifications' links land on the same screen; only the starter list `/admin/starter.json` stays a file
 *   there), and the admin's own: its `/admin/**` rewrite and the headers of `/admin/**` (its Content-Security-Policy among
 *   them), `/` sending to `/admin/`.
 *
 * A tree whose `hosting` is already a list was split before and is left alone. Without the admin's site (a self-hosted
 * copy, a project whose site could not be made) nothing runs, and the admin stays under the public map's `/admin/` with
 * its sign-in in the tab (`DECISIONS-for-review.md` §73a). Used by the site build's `hosting` step
 * (`../install/steps/deploy-hosting.ts`) and, for a deploy from a checkout, by `split-admin-site.ts`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { siteOrigins } from '@hcm/shared';

/** The admin's folder in a Hosting tree. */
const ADMIN_FOLDER = 'admin';

type Json = Record<string, unknown>;

export interface AdminSplitOptions {
    /** The `firebase.json` to split (its `hosting.public` is relative to its folder). */
    readonly config: string;
    /** The admin's site id (`adminSiteId` of `@hcm/shared`). */
    readonly siteId: string;
}

export interface AdminSplitResult {
    /** False when the configuration was split already (nothing changed). */
    readonly split: boolean;
    /** The admin's tree, relative to the configuration's folder. */
    readonly adminPublic: string;
    /** The admin's site's origin (`https://<site>.web.app`). */
    readonly adminOrigin: string;
}

function rules(entry: Json, key: string): Json[] {
    const value = entry[key];
    return Array.isArray(value) ? (value as Json[]) : [];
}

/** A rule of the admin's folder (`/admin`, `/admin/**`), by its `source`. */
function isAdminRule(rule: Json): boolean {
    const source = rule['source'];
    return typeof source === 'string' && (source === `/${ADMIN_FOLDER}` || source.startsWith(`/${ADMIN_FOLDER}/`));
}

/**
 * A header rule of every folder (a `source` starting with `**`, such as the pages' and scripts' glob, or a `regex` such as
 * the extension-less addresses'): both sites keep it.
 * Live 2026-11-14 (lesson 707): the admin's site lost the `no-cache` of its pages and scripts, Hosting served `admin.mjs` with
 * an hour's `max-age`, and a reload after a deploy ran the old admin beside the new `runtime.json`: Update the map built the
 * pipeline with the old build steps (no `HCM_RELEASE`), so every computer said "processing 0.0.0".
 */
function isEveryFolderRule(rule: Json): boolean {
    const source = rule['source'];
    return typeof source === 'string' ? source.startsWith('**') : typeof rule['regex'] === 'string';
}

/** The keys both sites keep as they are; `predeploy` never (the tree is built already). */
function common(entry: Json): Json {
    return Object.fromEntries(
        Object.entries(entry).filter(([key]) => !['site', 'public', 'predeploy', 'redirects', 'rewrites', 'headers'].includes(key)),
    );
}

/**
 * The file the public map keeps in the admin's folder: the starter list (`starter.ts`), which a Linux starter installed
 * before §210 fetches there with `curl` and no `-L`, so it must stay a file, never a redirect.
 */
const KEPT_ADMIN_FILE = 'starter.json';

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A character class of `chars` (each listed), or any character for none. */
function charClass(chars: string): string {
    return chars === '' ? '.' : `[${chars.replaceAll('-', '\\-')}]`;
}

/** Any character of `chars` but `char` (any character but `char` for none). */
function otherThan(char: string, chars: string): string {
    return chars === '' ? `[^${escaped(char)}]` : charClass(chars.replaceAll(char, ''));
}

/**
 * An RE2 pattern (Hosting's regex syntax: no lookahead, no class subtraction) of every string of `chars` (each character
 * listed; any character when empty) but `name`: a proper prefix of it, a string that leaves it at some character, or
 * `name` with more after it.
 */
export function everyStringBut(name: string, chars = ''): string {
    const any = charClass(chars);
    const indexes = Array.from({ length: name.length }, (_, index) => index);
    const prefixes = indexes.map((index) => escaped(name.slice(0, index)));
    const leaving = indexes.map((index) => `${escaped(name.slice(0, index))}${otherThan(name.charAt(index), chars)}${any}*`);
    return [...prefixes, ...leaving, `${escaped(name)}${any}+`].join('|');
}

/** The characters of a city id (`CITY_ID_PATTERN`'s). */
const CITY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-';

/** The public map's entry: the admin's rules gone, its addresses forwarded to the admin's site with their path. */
function publicEntry(entry: Json, adminOrigin: string): Json {
    const forward: Json[] = [
        { source: `/${ADMIN_FOLDER}`, destination: `${adminOrigin}/${ADMIN_FOLDER}/`, type: 301 },
        {
            regex: `^/${ADMIN_FOLDER}/(?P<rest>${everyStringBut(KEPT_ADMIN_FILE)})$`,
            destination: `${adminOrigin}/${ADMIN_FOLDER}/:rest`,
            type: 301,
        },
    ];
    return {
        ...common(entry),
        site: entry['site'],
        public: entry['public'],
        redirects: [...forward, ...rules(entry, 'redirects').filter((rule) => !isAdminRule(rule))],
        rewrites: rules(entry, 'rewrites').filter((rule) => !isAdminRule(rule)),
        headers: rules(entry, 'headers').filter((rule) => !isAdminRule(rule)),
    };
}

/**
 * The admin's entry: its folder's rules and headers, every folder's headers (`isEveryFolderRule`: the pages' and scripts'
 * `no-cache`), `/` to `/admin/`, and a city's address
 * (`/<id>/`, which the admin's links build from its own origin) to the same address on the public map.
 */
function adminEntry(entry: Json, siteId: string, adminPublic: string, publicOrigin: string): Json {
    return {
        ...common(entry),
        site: siteId,
        public: adminPublic,
        redirects: [
            { regex: '^/(?:index\\.html)?$', destination: `/${ADMIN_FOLDER}/`, type: 301 },
            ...rules(entry, 'redirects').filter(isAdminRule),
            {
                regex: `^/(?P<city>${everyStringBut(ADMIN_FOLDER, CITY_CHARS)})/?$`,
                destination: `${publicOrigin}/:city/`,
                type: 301,
            },
        ],
        rewrites: rules(entry, 'rewrites').filter(isAdminRule),
        headers: rules(entry, 'headers').filter((rule) => isAdminRule(rule) || isEveryFolderRule(rule)),
    };
}

/** `runtime.json` of the admin's tree with the site's origin (`adminOrigin`), or nothing for a tree without one. */
function markRuntime(adminTree: string, adminOrigin: string): void {
    const path = join(adminTree, ADMIN_FOLDER, 'runtime.json');
    if (!existsSync(path)) {
        return;
    }
    const runtime = JSON.parse(readFileSync(path, 'utf8')) as Json;
    writeFileSync(path, `${JSON.stringify({ ...runtime, adminOrigin }, null, 4)}\n`);
}

/** Moves the admin's folder into its own tree, with the site's `release.json`. */
function moveAdmin(publicTree: string, adminTree: string): void {
    const from = join(publicTree, ADMIN_FOLDER);
    if (!existsSync(join(from, 'index.html'))) {
        throw new Error(`the admin's site needs the admin in ${from} (npm run build:hosting)`);
    }
    rmSync(adminTree, { recursive: true, force: true });
    mkdirSync(adminTree, { recursive: true });
    renameSync(from, join(adminTree, ADMIN_FOLDER));
    const kept = join(adminTree, ADMIN_FOLDER, KEPT_ADMIN_FILE);
    if (existsSync(kept)) {
        mkdirSync(from, { recursive: true });
        cpSync(kept, join(from, KEPT_ADMIN_FILE));
    }
    const release = join(publicTree, 'release.json');
    if (existsSync(release)) {
        cpSync(release, join(adminTree, 'release.json'));
    }
}

/** The public map's own address: its site's `web.app` origin. */
function publicOriginOf(entry: Json): string {
    return `https://${String(entry['site'])}.web.app`;
}

/** The admin's entry's public folder in a configuration split before. */
function splitBefore(hosting: readonly Json[], siteId: string): string {
    const folder = hosting.find((entry) => entry['site'] === siteId)?.['public'];
    return typeof folder === 'string' ? folder : '';
}

/** The configuration's single Hosting entry with a public folder, or an error naming the file. */
function hostingEntry(hosting: unknown, config: string): Json & { readonly public: string } {
    const entry = typeof hosting === 'object' && hosting !== null ? (hosting as Json) : {};
    if (typeof entry['public'] !== 'string') {
        throw new Error(`${config} has no hosting entry with a public folder`);
    }
    return entry as Json & { readonly public: string };
}

/** Splits `options.config`'s tree into the public map's site and the admin's (see the module's comment). */
export function splitAdminSite(options: AdminSplitOptions): AdminSplitResult {
    const config = JSON.parse(readFileSync(options.config, 'utf8')) as Json;
    const [adminOrigin] = siteOrigins(options.siteId);
    const hosting = config['hosting'];
    if (Array.isArray(hosting)) {
        return { split: false, adminPublic: splitBefore(hosting as Json[], options.siteId), adminOrigin };
    }
    const entry = hostingEntry(hosting, options.config);
    const adminPublic = `${entry.public}-admin`;
    const root = dirname(options.config);
    moveAdmin(join(root, entry.public), join(root, adminPublic));
    markRuntime(join(root, adminPublic), adminOrigin);
    const split = {
        ...config,
        hosting: [publicEntry(entry, adminOrigin), adminEntry(entry, options.siteId, adminPublic, publicOriginOf(entry))],
    };
    writeFileSync(options.config, `${JSON.stringify(split, null, 4)}\n`);
    return { split: true, adminPublic, adminOrigin };
}
