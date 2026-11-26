// Builds the sites the e2e tiers serve (`npm run build:site:e2e`, which gate `e2e-build` runs through scripts/ci/e2e_build.py
// unless nothing changed since the last build) into dist/e2e-site:
// Bucharest with the e2e fixture manifest (e2e/fixtures/manifest.ts), so its meta CSP names the e2e tile and telemetry
// hosts exactly as a production build names its own; the same site reading the public bucket's manifest instead
// (`bucharest-bucket`, the build's `publicBucket`: DECISIONS-for-review.md §51e); and the starter kit as committed. All
// carry the e2e token. M5 (docs/research/M5-interfaces.md §1.10): the second public city `e2e-second` (its own fixture
// manifest) and `e2e-unpublished` (the public bucket only), then the GitHub Pages tree `pages/` the production build's
// `--pages` makes: Bucharest at its root, each other city in its folder (e2e/fixtures/second-city.ts).
// The same build code as production (scripts/site/src/build.ts); only the manifest and the token differ.
// Then the admin's Hosting folder: its page and the legacy import bundle next to the admin's e2e-mode Vite build in
// packages/admin/dist (scripts/site/src/admin/).
// M6 (docs/research/M6-interfaces.md §2): the e2e Firebase Hosting tree the production `build:hosting` makes
// (scripts/site/src/hosting/), its public variant in dist/e2e-hosting and its start-up variant in dist/e2e-hosting-start-up:
// the three cities built for Hosting (each reading the public bucket `e2e-hcm-public`, which the specs answer; Bucharest at
// the root with admin-redirect.js), the generic city page and the admin under /admin/; and the GitHub Pages redirect tree
// in dist/e2e-site/pages-redirect/, which sends the visitor to the e2e Hosting server.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { buildAdminSite } from '../../scripts/site/src/admin/build.js';
import { buildSite, type SiteBuildOptions } from '../../scripts/site/src/build.js';
import { SiteBuildError } from '../../scripts/site/src/errors.js';
import { nodeFileSystem, type SiteFileSystem } from '../../scripts/site/src/files.js';
import { planCityPage } from '../../scripts/site/src/hosting/city-page.js';
import { buildPagesRedirect } from '../../scripts/site/src/hosting/pages-redirect.js';
import { assembleHostingTree, type HostingTreeInputs } from '../../scripts/site/src/hosting/tree.js';
import { assemblePages } from '../../scripts/site/src/pages.js';
import { buildStartSite } from '../../scripts/site/src/start/build.js';
import { bundleSteps } from '../../scripts/site/src/install/steps-bundle.js';
import { subresourceIntegrity } from '../../scripts/site/src/sri.js';
import {
    ADMIN_DIST_DIR,
    ADMIN_ORIGIN,
    E2E_HOSTING_DIR,
    E2E_HOSTING_START_UP_DIR,
    E2E_START_CLIENT_ID,
    E2E_START_DIR,
    E2E_START_SITE_VERIFICATION,
    PAGES_REDIRECT_FOLDER,
} from '../admin/world.js';
import { buildFixtureManifest } from '../fixtures/manifest.js';
import { PAGES_FOLDER, SECOND_CITY, UNPUBLISHED_CITY, buildSecondCityManifest } from '../fixtures/second-city.js';
import { E2E_PUBLIC_BUCKET, E2E_SITE_DIR, E2E_TOKEN } from '../fixtures/world.js';

const log = createLogger('e2e-site-build');
const files = nodeFileSystem(process.cwd());

/** Where the cities are built for the e2e Hosting tree before it is assembled. */
const HOSTING_SITES_DIR = 'dist/e2e-hosting-sites';

const SECOND_SITE = `e2e/fixtures/sites/${SECOND_CITY}`;
const UNPUBLISHED_SITE = `e2e/fixtures/sites/${UNPUBLISHED_CITY}`;

/** The sites of the Pages world and of the viewer specs (dist/e2e-site). */
function pagesSites(): SiteBuildOptions[] {
    return [
        { siteDir: 'sites/bucharest', outDir: `${E2E_SITE_DIR}/bucharest`, token: E2E_TOKEN, manifest: buildFixtureManifest() },
        {
            siteDir: 'sites/bucharest',
            outDir: `${E2E_SITE_DIR}/bucharest-bucket`,
            token: E2E_TOKEN,
            manifest: buildFixtureManifest(),
            publicBucket: E2E_PUBLIC_BUCKET,
        },
        { siteDir: 'starter-kit', outDir: `${E2E_SITE_DIR}/starter-kit`, token: E2E_TOKEN },
        { siteDir: SECOND_SITE, outDir: `${E2E_SITE_DIR}/${SECOND_CITY}`, token: E2E_TOKEN, manifest: buildSecondCityManifest() },
        { siteDir: UNPUBLISHED_SITE, outDir: `${E2E_SITE_DIR}/${UNPUBLISHED_CITY}`, token: E2E_TOKEN, publicBucket: E2E_PUBLIC_BUCKET },
    ];
}

/** The cities built for the e2e Hosting tree: every one reads the public bucket, Bucharest is the root. */
function hostingSites(): (SiteBuildOptions & { readonly path: string })[] {
    const bucket = { token: E2E_TOKEN, publicBucket: E2E_PUBLIC_BUCKET };
    return [
        {
            ...bucket,
            siteDir: 'sites/bucharest',
            outDir: `${HOSTING_SITES_DIR}/bucharest`,
            manifest: buildFixtureManifest(),
            adminRedirect: true,
            path: '',
        },
        {
            ...bucket,
            siteDir: SECOND_SITE,
            outDir: `${HOSTING_SITES_DIR}/${SECOND_CITY}`,
            manifest: buildSecondCityManifest(),
            path: `${SECOND_CITY}/`,
        },
        { ...bucket, siteDir: UNPUBLISHED_SITE, outDir: `${HOSTING_SITES_DIR}/${UNPUBLISHED_CITY}`, path: `${UNPUBLISHED_CITY}/` },
    ];
}

function mapboxGlIntegrity(fs: SiteFileSystem): { script: string } {
    return { script: subresourceIntegrity(fs.readBytes('node_modules/mapbox-gl/dist/mapbox-gl.js')) };
}

/** The e2e Hosting tree, both variants, from the admin's build and the cities built for Hosting. */
function buildHosting(): void {
    const sites = hostingSites().map(({ path, ...options }) => {
        log.info('e2e hosting site built', { ...buildSite(options, files) });
        return { outDir: options.outDir, path };
    });
    const cityPage = planCityPage({ bucket: E2E_PUBLIC_BUCKET, mapboxGlIntegrity: mapboxGlIntegrity(files), themeColor: '#8B5E3C' }, files);
    const inputs: HostingTreeInputs = { adminDir: ADMIN_DIST_DIR, sites, cityPage };
    log.info('e2e hosting tree assembled', { ...assembleHostingTree(inputs, 'public', E2E_HOSTING_DIR, files) });
    log.info('e2e hosting tree assembled', { ...assembleHostingTree(inputs, 'start-up', E2E_HOSTING_START_UP_DIR, files) });
}

try {
    for (const options of pagesSites()) {
        log.info('e2e site built', { ...buildSite(options, files) });
    }
    const pages = [
        { outDir: `${E2E_SITE_DIR}/bucharest`, pagesPath: '' },
        { outDir: `${E2E_SITE_DIR}/${SECOND_CITY}`, pagesPath: `${SECOND_CITY}/` },
        { outDir: `${E2E_SITE_DIR}/${UNPUBLISHED_CITY}`, pagesPath: `${UNPUBLISHED_CITY}/` },
    ];
    log.info('e2e pages assembled', { ...assemblePages(pages, `${E2E_SITE_DIR}/${PAGES_FOLDER}`, files) });
    const redirect = { origin: ADMIN_ORIGIN, base: `/${PAGES_REDIRECT_FOLDER}/` };
    const folders = pages.map((site) => site.pagesPath);
    log.info('e2e pages redirect written', { ...buildPagesRedirect(`${E2E_SITE_DIR}/${PAGES_REDIRECT_FOLDER}`, redirect, folders, files) });
    // The admin's Hosting folder joins the e2e Hosting tree under /admin/, so every run builds it (M6).
    log.info('e2e admin built', { ...buildAdminSite({ outDir: ADMIN_DIST_DIR }, files) });
    buildHosting();
    // M14: the start site over the e2e Hosting tree, its project the e2e world's, with a client id so its road is open, and a
    // Search Console file name so the verification file is served.
    const startEnv = {
        ...process.env,
        HCM_START_OAUTH_CLIENT_ID: E2E_START_CLIENT_ID,
        HCM_START_SITE_VERIFICATION: E2E_START_SITE_VERIFICATION,
    };
    const started = buildStartSite(
        {
            publicTree: E2E_HOSTING_DIR,
            appDir: 'dist/start-app',
            outDir: E2E_START_DIR,
            functionsDir: 'functions/dist',
            project: { projectId: 'bucurestiul-disparut', publicBucket: E2E_PUBLIC_BUCKET },
        },
        { files, env: startEnv },
        await bundleSteps(process.cwd()),
    );
    log.info('e2e start site built', started);
} catch (error: unknown) {
    if (!(error instanceof SiteBuildError)) {
        throw error;
    }
    log.error(error.message);
    process.exitCode = 1;
}
