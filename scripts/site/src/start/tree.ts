import {
    START_CONFIG_FILE,
    START_PROJECT_TOKEN,
    START_RELEASE_FILE,
    START_RELEASE_FORMAT,
    START_TREE_FOLDER,
    installReleaseSlug,
    startConfigSchema,
    startReleaseSchema,
    type HostingServingConfig,
    type StartConfig,
    type StartFile,
    type StartRelease,
} from '@hcm/shared';
import { createHash } from 'node:crypto';

import { adminRelease, releaseTime, type BuildEnvironment, type CommitClock } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { ADMIN_REDIRECT_FILE, ADMIN_REDIRECT_SOURCE } from '../hosting/admin-redirect.js';
import { FIRST_CITY_FILE, renderFirstCityPage, renderStartUpPage } from '../hosting/static-pages.js';
import { element, renderDocument } from '../html.js';
import { iconLinks } from '../icons.js';
import { START_SITE_STYLESHEET_FILE, startFooter } from './legal.js';

/**
 * The start site (`docs/research/M14-start-your-map.md` §5, §6; `npm run build:start`), into `outDir` below `dist/`:
 *
 * ```text
 * index.html, start.mjs, start-config.json       the page: dist/start-app's build, its policy and its configuration
 * i18n/<locale>.json                             the languages beyond ro and en, fetched when chosen (docs/I18N.md)
 * privacy.html, terms.html, start-site.css       what Google's OAuth verification asks for (`legal.ts`), and its file
 * release/<slug>/start-release.json              every file below, with its SHA-256, and Hosting's rules
 * release/<slug>/tree/…                          what a new project's first Hosting release holds
 * ```
 *
 * The tree comes from the public Hosting tree: the admin (no legacy import, no project file, `runtime.json` `startUp`), the
 * generic city page and its engine, the small pages. Its root is the being-set-up page. It names no project: the repository's
 * id and public bucket become {@link START_PROJECT_TOKEN} (a *template*), which the browser replaces per project.
 */

export interface StartTreeInputs {
    /** The public Hosting tree (`build:hosting`'s `--public-out`). */
    readonly publicTree: string;
    /** The page's build (`npm run build --workspace @hcm/admin`). */
    readonly appDir: string;
    readonly outDir: string;
    /** The project id the tree was built for, and its public bucket, both replaced by the token. */
    readonly projectId: string;
    readonly publicBucket: string;
    /** `firebase.json`'s `hosting` block as Hosting's REST API takes it, the project already tokenised. */
    readonly hosting: HostingServingConfig;
    readonly env: BuildEnvironment;
    readonly commitTime?: CommitClock;
}

const ROOT_FILES = new Set(['404.html', 'hosting.css', 'site.css', 'THIRD_PARTY_NOTICES.txt']);
/** What the tree takes of the public tree's folders; the root viewer's own files and the other cities stay out. */
const TAKEN_FOLDERS = /^(?:engine|fonts|city)\//;
const ADMIN_TAKEN = /^admin\/(?!legacy\/|install\/|project\.json$|runtime\.json$)/;
const TEXT_FILE = /\.(?:html|js|mjs|css|json|txt|webmanifest)$/;

/** Whether the public tree's `path` joins the tree. */
export function takenByStartTree(path: string): boolean {
    return !path.endsWith('.map') && (ROOT_FILES.has(path) || TAKEN_FOLDERS.test(path) || ADMIN_TAKEN.test(path));
}

/**
 * The root's script (§6): the project's first city, from the project's own file, a page load away. An unreadable file leaves
 * the page's links. No text comes from the file: an id is checked, and only an address on this origin is ever opened.
 */
const FIRST_CITY_SOURCE = `'use strict';
fetch('/admin/project.json', { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((project) => {
        const city = project && Array.isArray(project.cities) ? project.cities[0] : '';
        if (typeof city === 'string' && /^[a-z0-9-]{2,32}$/.test(city)) {
            location.replace('/' + city + '/');
        }
    })
    .catch(() => undefined);
`;

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const json = (value: unknown): string => `${JSON.stringify(value, null, 4)}\n`;

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** The file with the token where it named the build's project, and whether it did. */
function tokenised(bytes: Uint8Array, path: string, inputs: StartTreeInputs): { bytes: Uint8Array; template: boolean } {
    if (!TEXT_FILE.test(path)) {
        return { bytes, template: false };
    }
    const text = decoder.decode(bytes);
    const replaced = text
        .replaceAll(inputs.publicBucket, `${START_PROJECT_TOKEN}-public`)
        .replaceAll(inputs.projectId, START_PROJECT_TOKEN);
    return replaced === text ? { bytes, template: false } : { bytes: encoder.encode(replaced), template: true };
}

export interface StartTreeFile {
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly template: boolean;
}

function textFile(path: string, content: string): StartTreeFile {
    return { path, bytes: encoder.encode(content), template: false };
}

/** The tree's `variant`: start-up (the first release) or public (`hosting.tgz`), which differ in their root and `release.json`. */
export function startTreeFiles(inputs: StartTreeInputs, variant: 'start-up' | 'public', files: SiteFileSystem): StartTreeFile[] {
    const release = adminRelease(files, inputs.env);
    const time = releaseTime(files, inputs.env, inputs.commitTime);
    const stamp = time === null ? { release } : { release, releaseTime: time };
    const copied = files
        .listFiles(inputs.publicTree)
        .filter(takenByStartTree)
        .map((path) => ({ path, ...tokenised(files.readBytes(`${inputs.publicTree}/${path}`), path, inputs) }));
    return [
        ...copied,
        textFile('index.html', variant === 'start-up' ? renderStartUpPage() : renderFirstCityPage()),
        textFile(ADMIN_REDIRECT_FILE, ADMIN_REDIRECT_SOURCE),
        textFile(FIRST_CITY_FILE, FIRST_CITY_SOURCE),
        textFile('admin/runtime.json', json(variant === 'start-up' ? { ...stamp, startUp: true } : stamp)),
        textFile('release.json', json({ ...stamp, variant })),
    ];
}

function manifestEntry(file: StartTreeFile): StartFile {
    return { path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes), ...(file.template ? { template: true as const } : {}) };
}

/** The public Landsat catalogue the imagery census searches and whose previews it shows (M29, `CENSUS_ORIGIN`). */
const CENSUS_ORIGIN = 'https://planetarycomputer.microsoft.com';

/** The page's own policy: its files, Google's five API hosts (§1) and the imagery census's catalogue (M29). */
export function startPagePolicy(): string {
    return [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: ${CENSUS_ORIGIN}`,
        [
            "connect-src 'self'",
            'https://cloudresourcemanager.googleapis.com',
            'https://firebase.googleapis.com',
            'https://firebasehosting.googleapis.com',
            'https://upload-firebasehosting.googleapis.com',
            'https://identitytoolkit.googleapis.com',
            CENSUS_ORIGIN,
        ].join(' '),
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ].join('; ');
}

/** The page: the element, the script, a sentence for a browser without JavaScript, the footer with the app's name and its links. */
export function renderStartPage(): string {
    const head = element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { 'http-equiv': 'Content-Security-Policy', content: startPagePolicy() }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        element('meta', { name: 'description', content: 'Pornește-ți propria hartă istorică. Start your own historical map.' }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('title', {}, ['Pornește-ți harta / Start your map · Historic City Map Maker']),
        ...iconLinks(),
        element('link', { rel: 'stylesheet', href: `./${START_SITE_STYLESHEET_FILE}` }),
        element('script', { type: 'module', src: './start.mjs' }),
    ]);
    const noscript = element('noscript', {}, [
        element('p', {}, ['Pagina are nevoie de JavaScript.']),
        element('p', { lang: 'en' }, ['This page needs JavaScript.']),
    ]);
    return renderDocument(
        element('html', { lang: 'ro' }, [head, element('body', {}, [element('hcm-start-page', {}), noscript, startFooter()])]),
    );
}

function readApp(inputs: StartTreeInputs, files: SiteFileSystem): void {
    if (!files.isFile(`${inputs.appDir}/start.mjs`)) {
        throw new SiteBuildError(`${inputs.appDir}/start.mjs is missing: run npm run build --workspace @hcm/admin first`);
    }
}

/** The languages the page fetches when chosen (`i18n/<locale>.json`, docs/I18N.md → Loading), beside `start.mjs`. */
function copyLanguages(inputs: StartTreeInputs, files: SiteFileSystem): void {
    for (const path of files.listFiles(inputs.appDir).filter((file) => file.startsWith('i18n/'))) {
        files.copy(`${inputs.appDir}/${path}`, `${inputs.outDir}/${path}`);
    }
}

/** Writes the start site; the install bundle joins the tree first (`build.ts`), so the manifest lists it. */
export function writeStartSite(
    inputs: StartTreeInputs,
    tree: readonly StartTreeFile[],
    oauthClientId: string | undefined,
    files: SiteFileSystem,
): StartRelease {
    readApp(inputs, files);
    const release = adminRelease(files, inputs.env);
    const slug = installReleaseSlug(release);
    const folder = `${inputs.outDir}/release/${slug}`;
    for (const file of tree) {
        files.write(`${folder}/${START_TREE_FOLDER}/${file.path}`, file.bytes);
    }
    const manifest = startReleaseSchema.parse({
        format: START_RELEASE_FORMAT,
        release,
        releaseTime: releaseTime(files, inputs.env, inputs.commitTime),
        slug,
        hosting: inputs.hosting,
        files: tree.map(manifestEntry).sort((left, right) => (left.path < right.path ? -1 : 1)),
    });
    files.write(`${folder}/${START_RELEASE_FILE}`, json(manifest));
    const config: StartConfig = startConfigSchema.parse({ ...(oauthClientId === undefined ? {} : { oauthClientId }), release: slug });
    files.write(`${inputs.outDir}/${START_CONFIG_FILE}`, json(config));
    files.write(`${inputs.outDir}/index.html`, renderStartPage());
    files.copy(`${inputs.appDir}/start.mjs`, `${inputs.outDir}/start.mjs`);
    copyLanguages(inputs, files);
    return manifest;
}
