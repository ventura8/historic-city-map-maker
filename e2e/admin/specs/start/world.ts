import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { translateStart, type Locale, type StartKey } from '@hcm/shared';
import { expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { FETCH_BUNDLE_SCRIPT } from '../../../../packages/admin/src/install/fetch-script.js';
import { MOCK_API_ORIGIN, TEST_HEADER } from '../../../fixtures/world.js';
import type { Recorder } from '../../../support/network.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { ADMIN_ORIGIN, E2E_PROJECT_ID, E2E_RELEASED_DIR, E2E_START_DIR } from '../../world.js';

/**
 * The start page's world (`docs/research/M14-start-your-map.md` §11): the page at the admin server's `/start/`, Google on the
 * fake upstreams, and the fake Hosting's uploads kept here, since only the browser's route sees their bytes (the mock APIs read
 * text). Each upload's SHA-256 is checked against the address that names it, so what the page calls the gzip's hash really is
 * one; `releaseToFolder` then unpacks the live release for the admin server, which serves it to a browser with the cookie.
 */

export const PROJECT = E2E_PROJECT_ID;
/** The specs run from `e2e/`; the build's folders are named from the repository's root. */
export const REPOSITORY = resolve(import.meta.dirname, '../../../..');
export const START_URL = `${ADMIN_ORIGIN}/start/`;

/** The seeded map of the owner's question: a Fostul Bacău made from nothing. */
export const CITY = {
    nameRo: 'Fostul Bacău',
    nameEn: 'Old Bacău',
    id: 'fostul-bacau',
    west: '26.85',
    south: '46.5',
    east: '26.98',
    north: '46.62',
} as const;

export function startText(locale: Locale, key: StartKey, params?: Readonly<Record<string, string>>): string {
    return translateStart(locale, key, params);
}

export function startPage(page: Page): Locator {
    return page.locator('hcm-start-page');
}

export class FakeHostingUploads {
    readonly #uploads = new Map<string, Uint8Array>();

    /** Answers the upload host at the browser's edge: the bytes stay here, the fake hears only that the hash arrived. */
    async install(context: BrowserContext, api: APIRequestContext, testId: string, refuse: () => boolean = () => false): Promise<void> {
        await context.route('https://upload-firebasehosting.googleapis.com/**', async (route) => {
            const request = route.request();
            if (request.method() === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
                return;
            }
            if (refuse()) {
                await route.abort('failed');
                return;
            }
            const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
            const url = new URL(request.url());
            const hash = url.pathname.split('/').at(-1) ?? '';
            const real = createHash('sha256').update(bytes).digest('hex');
            this.#uploads.set(real, bytes);
            const answer = await api.fetch(`${MOCK_API_ORIGIN}/h/${url.hostname}${url.pathname}`, {
                method: 'POST',
                headers: {
                    [TEST_HEADER]: testId,
                    authorization: (await request.allHeaders())['authorization'] ?? '',
                    ...(real === hash ? { 'x-hcm-checked': hash } : {}),
                },
                failOnStatusCode: false,
            });
            await route.fulfill({ status: answer.status(), contentType: 'application/json', body: await answer.text() });
        });
    }

    /** Every file of the live release, unpacked into a folder the admin server serves; returns the folder's name and its rules. */
    async releaseToFolder(
        upstream: UpstreamControl,
        folder: string,
    ): Promise<{
        readonly files: Readonly<Record<string, string>>;
        readonly bytes: Readonly<Record<string, Uint8Array>>;
        readonly config: unknown;
    }> {
        const snapshot = (await upstream.snapshot('browser'))['firebase-hosting'] as {
            readonly live: Readonly<Record<string, string>>;
            readonly versions: Readonly<Record<string, { readonly files: Readonly<Record<string, string>>; readonly config: unknown }>>;
        };
        const live = snapshot.live[PROJECT] ?? '';
        const version = snapshot.versions[live];
        if (version === undefined) {
            throw new Error(`nothing is released on ${PROJECT}`);
        }
        const root = join(REPOSITORY, E2E_RELEASED_DIR, folder);
        rmSync(root, { recursive: true, force: true });
        const unpacked: Record<string, string> = {};
        const raw: Record<string, Uint8Array> = {};
        for (const [path, hash] of Object.entries(version.files)) {
            const gz = this.#uploads.get(hash);
            if (gz === undefined) {
                throw new Error(`the release names ${path}, whose bytes were never uploaded`);
            }
            const relative = path.replace(/^\//, '');
            const target = join(root, relative);
            mkdirSync(dirname(target), { recursive: true });
            const bytes = gunzipSync(gz);
            writeFileSync(target, bytes);
            unpacked[relative] = bytes.toString('utf8');
            raw[relative] = bytes;
        }
        return { files: unpacked, bytes: raw, config: version.config };
    }
}

/** What the browser sends so the admin server serves it the release of this test. */
export async function serveReleased(context: BrowserContext, folder: string): Promise<void> {
    await context.addCookies([{ name: 'hcm-e2e-variant', value: `released:${folder}`, url: ADMIN_ORIGIN }]);
}

/** Google's consent page, in this tab: Allow, and back. */
export async function allowConsent(page: Page): Promise<void> {
    await page.waitForURL(/\/__oauth\/authorize/);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/start\//);
}

export async function cancelConsent(page: Page): Promise<void> {
    await page.waitForURL(/\/__oauth\/authorize/);
    await page.locator('#cancel').click();
    await page.waitForURL(/\/start\//);
}

/** The form: the city's names, its id, its rectangle, and the new project's id (the emulators' own project). */
export async function fillPlan(page: Page, lang: Locale, projectId: string = PROJECT): Promise<void> {
    const form = startPage(page);
    await form.getByLabel(startText(lang, 'start.plan.cityName'), { exact: true }).fill(CITY.nameRo);
    await form.getByLabel(startText(lang, 'start.plan.cityNameEn'), { exact: true }).fill(CITY.nameEn);
    await form.getByLabel(startText(lang, 'start.plan.cityId'), { exact: true }).fill(CITY.id);
    await form.getByLabel(startText(lang, 'start.plan.west'), { exact: true }).fill(CITY.west);
    await form.getByLabel(startText(lang, 'start.plan.south'), { exact: true }).fill(CITY.south);
    await form.getByLabel(startText(lang, 'start.plan.east'), { exact: true }).fill(CITY.east);
    await form.getByLabel(startText(lang, 'start.plan.north'), { exact: true }).fill(CITY.north);
    await form.getByLabel(startText(lang, 'start.plan.projectId'), { exact: true }).fill(projectId);
}

/** Google's answer to a project nobody can see yet (AIP-193): the look before the create, in the console of every new project. */
export async function claimProjectRead(consoleErrors: Recorder): Promise<void> {
    await expect.poll(() => consoleErrors.takeMatching(/status of 403.*\/v3\/projects\//).length).toBeGreaterThan(0);
}

function bundleServer(folder: string, projectFile: string): Promise<{ readonly origin: string; readonly close: () => void }> {
    const server = createServer((request, response) => {
        const name = (request.url ?? '').split('/').pop() ?? '';
        response.writeHead(200);
        response.end(readFileSync(name === 'project.json' ? projectFile : join(folder, name)));
    });
    return new Promise((done) => {
        server.listen(0, '127.0.0.1', () => {
            done({
                origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
                close: () => {
                    server.close();
                },
            });
        });
    });
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Publish the map's site build as far as the files go: the real `fetch` step over the real generic bundle of the start tree,
 * as Cloud Build runs it, its project's file from what was released. The build's deploy is Firebase's and stays out; what it
 * would deploy goes where the admin server serves it. Returns the folder's name for {@link serveReleased}.
 */
export async function publishedSite(released: string): Promise<string> {
    const startDir = join(REPOSITORY, E2E_START_DIR);
    const { release: slug } = JSON.parse(readFileSync(join(startDir, 'start-config.json'), 'utf8')) as { readonly release: string };
    const folder = join(startDir, 'release', slug, 'tree/admin/install', slug);
    const manifestBytes = readFileSync(join(folder, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
        readonly release: string;
        readonly releaseTime?: number | null;
        readonly files: { readonly site: { readonly sha256: string } };
    };
    const releasedRoot = join(REPOSITORY, E2E_RELEASED_DIR);
    const work = mkdtempSync(join(releasedRoot, 'publish-'));
    const served = await bundleServer(folder, join(releasedRoot, released, 'admin/project.json'));
    const env = {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HCM_WORKSPACE: work,
        HCM_BUNDLE_URL: `${served.origin}/`,
        HCM_MANIFEST_SHA256: sha256(manifestBytes),
        HCM_FILE_SHA256: manifest.files.site.sha256,
        HCM_RELEASE: manifest.release,
        HCM_RELEASE_TIME: String(manifest.releaseTime ?? ''),
        HCM_FILES: 'site',
        HCM_OUT: join(work, 'site'),
        HCM_KEEP_BUNDLE: `public/admin/install/${slug}`,
        HCM_ADOPT_PROJECT: PROJECT,
        HCM_ADOPT_FROM: `${served.origin}/project.json`,
    };
    const failure = await new Promise<string | null>((done) => {
        execFile(process.execPath, ['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT], { env }, (error, _stdout, stderr) => {
            done(error === null ? null : stderr);
        });
    });
    served.close();
    if (failure !== null) {
        throw new Error(failure);
    }
    const name = `${released}-site`;
    const target = join(releasedRoot, name);
    rmSync(target, { recursive: true, force: true });
    renameSync(join(work, 'site/public'), target);
    rmSync(work, { recursive: true, force: true });
    return name;
}

/** The files below a released folder that hold the release's token; a tarball kept for the installer is compressed. */
export function filesWithToken(folder: string): string[] {
    const root = join(REPOSITORY, E2E_RELEASED_DIR, folder);
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((path) => readFileSync(path).includes('__HCM_PROJECT_ID__'));
}
