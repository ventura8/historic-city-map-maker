import { join, normalize, resolve, sep } from 'node:path';

import { createLogger } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { addSite, type NewSite } from '../../scripts/site/src/add-site.js';
import { buildSite } from '../../scripts/site/src/build.js';
import { nodeFileSystem, type SiteFileSystem } from '../../scripts/site/src/files.js';
import { E2E_TOKEN, SITE_ORIGIN } from '../fixtures/world.js';
import { isFile } from '../mock-apis/server.js';

/**
 * A new city's public site as the repository makes it (M5, `docs/research/M5-interfaces.md` §1.10; the integrator's
 * cross-app journey, behaviour A54): `npm run site:add`'s own writer (`addSite`) writes the city's `sites/<id>/`, here into
 * a folder of the test's own instead of the repository, and `npm run build:site`'s own builder (`buildSite`) builds it
 * with the project's public bucket named (`HCM_PUBLIC_BUCKET`), so the page reads the manifest the admin published.
 * The built folder is served at the site server's origin as GitHub Pages serves a city's folder (`serveCitySites`).
 */

const ROOT = resolve(import.meta.dirname, '../..');
/** Below `dist/` (the site build writes nowhere else), outside the e2e build's outputs (a run never makes it look stale). */
const SITES_DIR = 'dist/e2e-city-sites';
const SITES_PATH = '/city-sites/';
const log = createLogger('e2e-city-site');

export interface CitySite {
    /** The site server's path of the built site (`/city-sites/<name>/`). */
    readonly path: string;
    /** The files `site:add` wrote, relative to the city's site folder. */
    readonly sources: readonly string[];
}

/** The repository's file system, with the city's `sites/<id>/` moved into `<folder>/sites/<id>/`. */
function redirected(files: SiteFileSystem, cityId: string, folder: string): SiteFileSystem {
    const from = `sites/${cityId}`;
    const at = (path: string): string => (path === from || path.startsWith(`${from}/`) ? `${folder}/${path}` : path);
    return {
        readText: (path) => files.readText(at(path)),
        readBytes: (path) => files.readBytes(at(path)),
        isFile: (path) => files.isFile(at(path)),
        listFiles: (dir) => files.listFiles(at(dir)),
        write: (path, content) => {
            files.write(at(path), content);
        },
        copy: (source, target) => {
            files.copy(at(source), at(target));
        },
        remove: (dir) => {
            files.remove(at(dir));
        },
    };
}

/** Adds the city's site and builds it reading `publicBucket`, into `dist/e2e-city-sites/<name>/` (replacing an older one). */
export function citySite(name: string, site: NewSite, publicBucket: string): CitySite {
    const folder = `${SITES_DIR}/${name}`;
    const repository = nodeFileSystem(ROOT);
    repository.remove(folder);
    const files = redirected(repository, site.cityId, folder);
    const siteDir = addSite(site, files);
    const report = buildSite({ siteDir, outDir: `${folder}/site`, token: E2E_TOKEN, publicBucket }, files);
    log.info('city site built', { ...report });
    return { path: `${SITES_PATH}${name}/`, sources: files.listFiles(siteDir) };
}

/** The built file an address of `/city-sites/` names (a folder: its index.html), or null outside the built sites. */
function builtFile(url: URL): string | null {
    const [name = '', ...rest] = decodeURIComponent(url.pathname.slice(SITES_PATH.length)).split('/');
    const relativePath = rest.join('/');
    const sites = join(ROOT, SITES_DIR);
    const file = normalize(
        join(sites, name, 'site', relativePath === '' || relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath),
    );
    return file.startsWith(`${sites}${sep}`) ? file : null;
}

/** The site server's origin serves the built city sites at `/city-sites/<name>/`, each file as it is, 404 for anything else. */
export async function serveCitySites(page: Page): Promise<void> {
    await page.route(`${SITE_ORIGIN}${SITES_PATH}**`, async (route) => {
        const file = builtFile(new URL(route.request().url()));
        if (file === null || !(await isFile(file))) {
            await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
            return;
        }
        await route.fulfill({ path: file });
    });
}
