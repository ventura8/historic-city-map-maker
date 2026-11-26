// Starts one e2e server (Playwright's `webServer`, e2e/playwright.config.ts), from the repository root:
//
//     node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts mock    # the mock APIs on 127.0.0.1:4311
//     node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts site    # dist/e2e-site on 127.0.0.1:4310
//     node --import ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts admin   # dist/e2e-hosting (the admin at /admin/) on 127.0.0.1:4312
//
// It runs until Playwright stops it. Exit status 2 on a usage error.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@hcm/shared';
import { createUpstreamExtension, UpstreamPartitions } from '@hcm/test-support/fakes/http';

import { parseHostingConfig } from '../../scripts/site/src/admin/hosting.js';
import {
    ADMIN_CONNECT_ORIGINS,
    ADMIN_ORIGIN,
    ADMIN_PORT,
    ADMIN_PROJECT,
    ADMIN_RUNTIME,
    ADMIN_WEB_CONFIG,
    E2E_HOSTING_DIR,
    E2E_HOSTING_START_UP_DIR,
    E2E_RELEASED_DIR,
    E2E_START_DIR,
} from '../admin/world.js';
import { ImageryRunner, useSyntheticScenes } from '../admin/support/imagery-runner.js';
import { E2E_SITE_DIR, MOCK_API_ORIGIN, MOCK_API_PORT, SITE_ORIGIN, SITE_PORT } from '../fixtures/world.js';
import { startAdminServer } from './admin-server.js';
import { createImageryExtension } from './imagery.js';
import { createLeases } from './lease.js';
import { createOAuthStandIn } from './oauth.js';
import { startMockApis, startSiteServer } from './server.js';

const log = createLogger('e2e-servers');
const role = process.argv[2];

if (role === 'mock') {
    // The pinned devDependency of @hcm/e2e, byte for byte what api.mapbox.com serves for v3.34.1.
    const mapboxGlDist = dirname(fileURLToPath(import.meta.resolve('mapbox-gl/dist/mapbox-gl.js')));
    // The fake upstreams (Google Cloud, Mapbox's Tokens and Tilesets APIs, USGS M2M, Nominatim, and for M3 USGS's browse
    // images and downloads, STAC and Overpass) answer first, one world per test; every world's Cloud Run hands its pipeline
    // runs to the imagery runner, and its STAC search and USGS's signed downloads point at this server (the pipeline tier
    // reads them over loopback); Google's consent stand-in issues its grants into the same worlds; the leases serialize
    // the admin tier.
    const runner = new ImageryRunner();
    const upstream = createUpstreamExtension(
        new UpstreamPartitions((fakes) => {
            fakes.state.cloudRun.runner = runner;
            fakes.state.stac.cogOrigin = `${MOCK_API_ORIGIN}/h/sentinel-cogs.s3.us-west-2.amazonaws.com`;
            // The signed delivery addresses too: the real pipeline under the emulators reaches nothing off this machine.
            fakes.state.usgs.delivery.origin = `${MOCK_API_ORIGIN}/h/dds.cr.usgs.gov`;
            useSyntheticScenes(fakes);
        }),
    );
    const consent = createOAuthStandIn(upstream.partitions, { openers: [ADMIN_ORIGIN, SITE_ORIGIN] });
    const imagery = createImageryExtension(runner, upstream);
    // The pinned jsDelivr folder of a release (M5): the committed cdn/engine/ once a release made it, else the engine build.
    const cdnEngine = existsSync('cdn/engine/release.json') ? resolve('cdn/engine') : resolve('packages/engine/dist');
    await startMockApis(MOCK_API_PORT, { mapboxGlDist, engineDist: resolve('packages/engine/dist'), cdnEngine }, [
        imagery,
        upstream,
        consent,
        createLeases(),
    ]);
    log.info('mock APIs listening', { port: MOCK_API_PORT });
} else if (role === 'site') {
    await startSiteServer(SITE_PORT, E2E_SITE_DIR);
    log.info('site server listening', { port: SITE_PORT, dir: E2E_SITE_DIR });
} else if (role === 'admin') {
    await startAdminServer(ADMIN_PORT, {
        hostingDir: E2E_HOSTING_DIR,
        startUpDir: E2E_HOSTING_START_UP_DIR,
        startDir: E2E_START_DIR,
        landingDir: 'sites/landing',
        releasedDir: E2E_RELEASED_DIR,
        hosting: parseHostingConfig(readFileSync('firebase.json', 'utf8')),
        connect: ADMIN_CONNECT_ORIGINS,
        webConfig: ADMIN_WEB_CONFIG,
        runtime: ADMIN_RUNTIME,
        project: ADMIN_PROJECT,
    });
    log.info('e2e Hosting server listening', { port: ADMIN_PORT, dir: E2E_HOSTING_DIR });
} else {
    log.error('usage: main.ts mock|site|admin', { role });
    process.exitCode = 2;
}
