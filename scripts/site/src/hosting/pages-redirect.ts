import { z } from 'zod';

import { validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { isOutputDir } from '../output-dir.js';
import { HOSTING_STYLESHEET_FILE, HOSTING_STYLESHEET_SOURCE, renderRedirectPage } from './static-pages.js';

/**
 * The GitHub Pages redirect tree (docs/research/M6-interfaces.md §2.7, scenario S-V30-HAPPY-OLD-PAGES-LINK;
 * `npm run build:site -- --pages-redirect dist/pages-redirect`): once the public map lives on Firebase Hosting, the old
 * Pages site (the 2015–2022 links, `https://ventura8.github.io/bucurestiuldisparut.github.io/#15.5/44.4271/26.0853/90/!a3!p2`)
 * can be replaced by this tree, whose every page sends the visitor to the same page on Hosting with the same query and
 * hash (the viewer reads the old site's hash, V26). Its pages: the root and each city's folder (`index.html`), and
 * `404.html` (GitHub Pages answers any other address with it: the visitor goes to Hosting's root, hash kept). Without
 * script each page says, in Romanian and English, that the map moved, with the new address as a link. Publishing the tree
 * is a workflow line and a push to `master`, the user's decision (`DECISIONS-for-review.md` §67c).
 *
 * `followTheMap` is the pages' script (`pages-redirect.js`), written like `admin-redirect.ts`: typed, tested, its source
 * text the file. It reads the target from `<html data-target>`, a value of the build, never of the address.
 */

/** The script every page of the tree loads, at the tree's root. */
export const PAGES_REDIRECT_FILE = 'pages-redirect.js';

/** What the script uses of the page's `window`. */
export interface FollowScope {
    readonly document: { readonly documentElement: { getAttribute(name: string): string | null } };
    readonly location: { readonly search: string; readonly hash: string; replace(url: string): void };
}

/** Goes to the page's `data-target` (an http(s) address without query or hash) with the same query and hash. */
export function followTheMap(scope: FollowScope): boolean {
    const target = scope.document.documentElement.getAttribute('data-target') ?? '';
    if (!/^https?:\/\/[^/?#\s]+\/[^?#\s]*$/.test(target)) {
        return false;
    }
    scope.location.replace(`${target}${scope.location.search}${scope.location.hash}`);
    return true;
}

/** `pages-redirect.js`. */
export const PAGES_REDIRECT_SOURCE = [
    '// Historic City Map Maker: the map moved to Firebase Hosting (docs/research/M6-interfaces.md §2.7),',
    '// from scripts/site/src/hosting/pages-redirect.ts.',
    "'use strict';",
    `(${followTheMap.toString()})(window);`,
    '',
].join('\n');

/** An http(s) origin without a path, where the map lives now (`https://<project>.web.app`). */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;

export interface PagesRedirectReport {
    readonly dir: string;
    readonly target: string;
    readonly pages: readonly string[];
}

/** Where the tree is served from on GitHub Pages: an absolute folder (`/`, `/bucurestiuldisparut.github.io/`). */
const BASE = /^\/(?:[\w.-]+\/)*$/;

/** Where the redirect tree is and where it sends the visitor. */
export interface PagesRedirectTarget {
    /** An http(s) origin without a path, where the map lives now (`https://<project>.web.app`). */
    readonly origin: string;
    /** The tree's root on GitHub Pages (`pagesBase`). */
    readonly base: string;
}

/** One page of the tree: its folder below the tree (`''`, `bacau/`) and the matching address on Hosting. */
function pageFile(target: PagesRedirectTarget, folder: string): { readonly to: string; readonly content: string } {
    const page = renderRedirectPage({ target: `${target.origin}/${folder}`, base: target.base, script: PAGES_REDIRECT_FILE });
    return { to: `${folder}index.html`, content: page };
}

/** The Pages root of a repository: `/` for a user's own `<owner>.github.io`, else `/<repository>/`. */
export function pagesBase(github: { readonly owner: string; readonly repo: string }): string {
    return github.repo.toLowerCase() === `${github.owner.toLowerCase()}.github.io` ? '/' : `/${github.repo}/`;
}

function checkTarget(dir: string, target: PagesRedirectTarget): void {
    if (!isOutputDir(dir)) {
        throw new SiteBuildError(`the Pages redirect folder must be below dist/, got "${dir}"`);
    }
    if (!ORIGIN.test(target.origin)) {
        throw new SiteBuildError(`the map's new address must be an http(s) origin without a path, got "${target.origin}"`);
    }
    if (!BASE.test(target.base)) {
        throw new SiteBuildError(`the Pages root must be an absolute folder ending with /, got "${target.base}"`);
    }
}

/**
 * Writes the redirect tree into `dir` (below `dist/`, replaced): a page for each of `folders` (the Pages paths of the
 * committed sites: `''` for the root, `<city>/` for another city), `404.html`, the script and the stylesheet.
 */
export function buildPagesRedirect(
    dir: string,
    target: PagesRedirectTarget,
    folders: readonly string[],
    files: SiteFileSystem,
): PagesRedirectReport {
    checkTarget(dir, target);
    const pages = [...new Set(['', ...folders])].map((folder) => pageFile(target, folder));
    // GitHub Pages serves 404.html from the tree's root for every other address: it sends the visitor to Hosting's root.
    const notFound = { to: '404.html', content: pageFile(target, '').content };
    files.remove(dir);
    for (const file of [
        ...pages,
        notFound,
        { to: PAGES_REDIRECT_FILE, content: PAGES_REDIRECT_SOURCE },
        { to: HOSTING_STYLESHEET_FILE, content: HOSTING_STYLESHEET_SOURCE },
    ]) {
        files.write(`${dir}/${file.to}`, file.content);
    }
    return { dir, target: `${target.origin}/`, pages: pages.map((page) => page.to) };
}

const projectSchema = z.looseObject({
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    github: z.looseObject({ owner: z.string().regex(/^[\w.-]{1,100}$/), repo: z.string().regex(/^[\w.-]{1,100}$/) }),
});

/** The redirect tree's target from the committed project file: `https://<projectId>.web.app`, the repository's Pages root. */
export function pagesRedirectTarget(files: SiteFileSystem, path = 'infra/project.json'): PagesRedirectTarget {
    let input: unknown;
    try {
        input = JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: cannot read the project file: ${String(error)}`);
    }
    const result = validate(projectSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${path}: the Pages redirect needs the project and its repository\n${issuesText(result.issues)}`);
    }
    return { origin: `https://${result.value.projectId}.web.app`, base: pagesBase(result.value.github) };
}
