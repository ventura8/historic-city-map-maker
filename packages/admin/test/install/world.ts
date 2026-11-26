// The installer's test world (docs/research/M6-interfaces.md §1.10): the fake upstreams of @hcm/test-support (Cloud
// Build, Cloud Logging, Cloud Functions, Cloud Run, Artifact Registry, IAM) behind the admin's own origin, which serves
// the install bundle's manifest and the site's `release.json`, and the Cloud Build installer over both.
import { createLogger, DOCKER_BUILDER_IMAGE } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { createUpstreamFakes, GOOGLE_TOKENS, jsonResponse, type UpstreamFakes } from '@hcm/test-support/fakes';

import { createIamClient } from '../../src/google/iam.js';
import { ensureBindings } from '../../src/google/iam-policy.js';
import { createGoogleTransport } from '../../src/google/transport.js';
import { bundleOnce, hostingOrigins, loadInstallBundle, sha256Hex } from '../../src/install/bundle.js';
import { createCloudBuildInstaller } from '../../src/install/cloud-build-installer.js';
import type { InstallerPort } from '../../src/install/ports.js';

export const RELEASE = '1.0.0+abc1234';
/** The admin's build time (finding 39 of 2026-11-01): `runtime.json`'s and the manifest's. */
export const RELEASE_TIME = 1_761_955_200;
const ORIGIN = 'https://demo-hcm.web.app';
const BASE = `${ORIGIN}/admin/`;
const NODE_IMAGE = `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`;
export const ACCESS = { token: GOOGLE_TOKENS.owner };

/** A manifest of the admin's own release (with the docker builder pinned unless `changes` says otherwise). */
export function installManifest(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    const file = (name: string, char: string) => ({ name, bytes: 10, sha256: char.repeat(64) });
    return {
        format: 1,
        release: RELEASE,
        releaseTime: RELEASE_TIME,
        slug: '1-0-0-abc1234',
        projectId: 'demo-hcm',
        files: { server: file('server.tgz', 'a'), pipeline: file('pipeline.tgz', 'b'), site: file('hosting.tgz', 'c') },
        functions: ['admin-session'],
        tools: { firebaseTools: '15.36.0', node: NODE_IMAGE, docker: DOCKER_BUILDER_IMAGE },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
        ...changes,
    };
}

export interface InstallWorld {
    readonly fakes: UpstreamFakes;
    readonly installer: InstallerPort;
    readonly sink: RecordingSink;
    /** What the admin's origin serves: the manifest (null: none) and `/release.json` (null: none). */
    manifest: Record<string, unknown> | null;
    release: Record<string, unknown> | null;
    /** Whether the first city has a published manifest. */
    published: boolean;
    /** Finding 29 of 2026-10-31: the admin release Hosting serves instead of this one (null: still this one). */
    newerAdmin: string | null;
    /** §73k: whether step (h)'s legacy import is complete. */
    legacyImported: boolean;
    /** §210: the public map's `/admin/` answers 301 to the admin's own site (this tab is on the old address). */
    moved: boolean;
}

function ownOrigin(world: InstallWorld, url: URL): Response {
    if (url.pathname === '/admin/runtime.json' && world.moved) {
        // What `fetch` gives for a redirect it was told not to follow (`redirect: 'manual'`).
        return { type: 'opaqueredirect', status: 0, ok: false } as Response;
    }
    if (url.pathname.endsWith('/manifest.json')) {
        return world.manifest === null ? new Response('missing', { status: 404 }) : jsonResponse(world.manifest);
    }
    if (url.pathname === '/release.json') {
        return world.release === null ? new Response('missing', { status: 404 }) : jsonResponse(world.release);
    }
    return new Response('missing', { status: 404 });
}

/** A fresh world: a provisioned project on Blaze whose installer account and repository exist, unless told otherwise. */
export async function installWorld(options: { readonly provisioned?: boolean } = {}): Promise<InstallWorld> {
    const fakes = createUpstreamFakes();
    fakes.scenario('google.provisioned');
    const sink = createRecordingSink();
    const log = createLogger('test', { sink: sink.sink, minLevel: 'debug' });
    const world: InstallWorld = {
        fakes,
        installer: undefined as unknown as InstallerPort,
        sink,
        manifest: installManifest(),
        release: null,
        published: true,
        newerAdmin: null,
        moved: false,
        legacyImported: false,
    };
    const fetcher: typeof fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return url.origin === ORIGIN ? Promise.resolve(ownOrigin(world, url)) : fakes.fetch(input, init);
    };
    const bundle = bundleOnce(() =>
        loadInstallBundle({
            fetch: fetcher,
            baseUrl: BASE,
            release: RELEASE,
            releaseTime: RELEASE_TIME,
            projectId: 'demo-hcm',
            origins: hostingOrigins('demo-hcm'),
            digest: sha256Hex,
        }),
    );
    const installer = createCloudBuildInstaller({
        ...{ fetch: fetcher, sleep: () => Promise.resolve(), log, projectId: 'demo-hcm', region: 'us-central1', bundle },
        origin: ORIGIN,
        hasPublishedMap: () => Promise.resolve(world.published),
        newerAdmin: () => Promise.resolve(world.newerAdmin),
        legacyImported: () => Promise.resolve(world.legacyImported),
    });
    if (options.provisioned !== false) {
        fakes.scenario('artifact-registry.provisioned');
        // Prepare the project's `service-accounts` item makes the installer's account (CR-M6-2): through IAM's own API here.
        const iam = createIamClient(
            createGoogleTransport({ fetch: fakes.fetch, token: () => ACCESS.token, sleep: () => Promise.resolve(), log }),
        );
        await iam.createServiceAccount('demo-hcm', 'hcm-installer', 'Cloud Build: the in-app installer');
        // Its `iam` item lets it act as the App Engine default account, which firebase-tools requires (finding 28), and as the
        // Compute Engine default account, the functions' build account, which the Cloud Functions API requires (finding 33).
        for (const account of ['demo-hcm@appspot.gserviceaccount.com', '123456789012-compute@developer.gserviceaccount.com']) {
            await ensureBindings(iam.serviceAccountPolicy('demo-hcm', account), [
                { role: 'roles/iam.serviceAccountUser', member: 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com' },
            ]);
        }
    }
    return Object.assign(world, { installer });
}
