import { SITE_ID_PATTERN, adminSiteId, adminSiteUrl, createLogger, httpsOriginSchema, siteOrigins, type Logger } from '@hcm/shared';
import { initializeApp, type App, type AppOptions } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { write } from 'firebase-functions/logger';
import { GoogleAuth } from 'google-auth-library';

import { createAuthAdmin } from './adapters/auth-admin.js';
import { createCloudRunJobs } from './adapters/cloud-run.js';
import { createCloudTaskQueue } from './adapters/cloud-tasks.js';
import { createDocumentStore } from './adapters/documents.js';
import { createEmulatorFetch } from './adapters/emulator-fetch.js';
import { createErrorReporter } from './adapters/error-reporting.js';
import { createDiskExportKit } from './adapters/export-kit.js';
import { createDiskStarterTemplates } from './adapters/starter-templates.js';
import { createFcm } from './adapters/fcm.js';
import { createFirebaseManagement } from './adapters/firebase-management.js';
import { firestoreAdminDirectory, firestoreSetupRecords } from './adapters/firestore.js';
import { createFunctionsLogSink } from './adapters/functions-log-sink.js';
import { createGoogleTokenProvider } from './adapters/google-token-provider.js';
import { createSharpImageProcessor } from './adapters/image.js';
import { createMapboxTilesets } from './adapters/mapbox-tilesets.js';
import { createMapboxUploads } from './adapters/mapbox-uploads.js';
import { createMapboxApi } from './adapters/mapbox.js';
import { createNominatim } from './adapters/nominatim.js';
import { createRemoteFiles, fetchPinnedGet, httpsPinnedGet, systemResolver } from './adapters/remote-files.js';
import { createGoogleIam } from './adapters/resource-manager.js';
import { createSecretManagerStore, secretsRevision } from './adapters/secret-manager.js';
import { createMemorySecretStore } from './adapters/secret-store-memory.js';
import { createStorageBlobReader } from './adapters/storage-reader.js';
import { createStorageBlobStore } from './adapters/storage.js';
import { createStorageBlobWriter } from './adapters/storage-writer.js';
import { systemClock } from './adapters/system-clock.js';
import type { Fetch } from './adapters/upstream-http.js';
import { createStandInUrlSigner, createStorageUrlSigner } from './adapters/url-signer.js';
import { createUsgsApi, createUsgsScenes } from './adapters/usgs.js';
import { createVertexAi } from './adapters/vertex-ai.js';
import type { Ports } from './ports/index.js';
import type { RemoteFiles } from './ports/remote-files.js';
import type { RuntimeConfig } from './ports/runtime-config.js';
import type { SecretStore } from './ports/secret-store.js';
import type { SetupRecords } from './ports/setup-records.js';
import type { TokenProvider } from './ports/token-provider.js';
import type { UrlSigner } from './ports/url-signer.js';

/**
 * Every port of `docs/research/M2-interfaces.md` §4, `docs/research/M3-interfaces.md` §9.3 and the three of
 * `docs/research/M4-interfaces.md` §4, §5 (Nominatim, Vertex AI Gemini, FCM web push).
 */
export type Deps = Ports;

export type Env = Readonly<Record<string, string | undefined>>;

/** Secrets are re-read at most every five minutes per instance (or at once after `setup/status.secretsRev` moves). */
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const REGION = 'us-central1';

/**
 * The project's Firebase Hosting origins: the admin's, and since M6 the public map's too (the viewer at the root, the
 * admin under `/admin/`: `docs/research/M6-interfaces.md` §2). They are the city sites' when `HCM_VIEWER_ORIGINS` is unset.
 */
function hostingOrigins(projectId: string): string[] {
    return [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`];
}

/**
 * The admin's own Hosting site (`HCM_ADMIN_SITE`, `DECISIONS-for-review.md` §210): `none` for a project without one (the
 * admin stays under the public map's `/admin/`), a site id once the installer saw the admin served from it (the server
 * build writes it: the site is then this project's own), unset before that. Unset, the admin's derived site
 * (`<project>-admin`) joins the allow-lists (its Mapbox token, the crash endpoint), because the admin may already run
 * there, while links keep the public map's `/admin/`, which Hosting forwards to the admin's site with the same route: a
 * link never names a site this project was not seen to own.
 */
interface AdminSite {
    readonly origins: readonly string[];
    readonly url: string;
}

/** `HCM_ADMIN_SITE` as a site id, `none`, or '' when unset; anything else is refused. */
function adminSiteSetting(value: string | undefined): string {
    const setting = value ?? '';
    if (setting !== '' && setting !== 'none' && !SITE_ID_PATTERN.test(setting)) {
        throw new Error(`HCM_ADMIN_SITE must be a Hosting site id or none: ${setting}`);
    }
    return setting;
}

function adminSiteOf(projectId: string, value: string | undefined): AdminSite {
    const main = hostingOrigins(projectId);
    const fallback = `https://${projectId}.web.app/admin/`;
    const setting = adminSiteSetting(value);
    if (setting === 'none') {
        return { origins: main, url: fallback };
    }
    const site = setting === '' ? adminSiteId(projectId) : setting;
    return { origins: [...main, ...siteOrigins(site)], url: setting === '' ? fallback : adminSiteUrl(setting) };
}

/** The Functions emulator's stand-in for Application Default Credentials: the fake upstreams accept any bearer token. */
const EMULATOR_TOKENS: TokenProvider = { accessToken: () => Promise.resolve('emulator-access-token') };

function requireProjectId(env: Env): string {
    const projectId = env['GCLOUD_PROJECT'];
    if (!projectId) {
        throw new Error('GCLOUD_PROJECT is not set: the Functions runtime and the emulators always set it');
    }
    return projectId;
}

/** A comma-separated list (`HCM_VIEWER_ORIGINS`, `HCM_OAUTH_CLIENT_IDS`), blanks dropped. */
function listOf(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}

/** The `storageBucket` of a parsed `FIREBASE_CONFIG`, or undefined when it names none. */
function bucketIn(config: unknown): string | undefined {
    const bucket: unknown = (config as { readonly storageBucket?: unknown } | null)?.storageBucket;
    return typeof bucket === 'string' && bucket !== '' ? bucket : undefined;
}

/** The bucket a `FIREBASE_CONFIG` value names, or undefined (none, or no JSON at all). */
function configuredBucket(config: string | undefined): string | undefined {
    try {
        return bucketIn(JSON.parse(config ?? '{}'));
    } catch {
        return undefined;
    }
}

/**
 * The project's default bucket, which the Storage rules, the admin's uploads and `photos.onUpload` share: the
 * `storageBucket` of `FIREBASE_CONFIG` (set by the runtime, the deploy and the emulators), else
 * `<project>.firebasestorage.app`, the default bucket of every project created since October 2024.
 */
export function privateBucket(env: Env): string {
    return configuredBucket(env['FIREBASE_CONFIG']) ?? `${requireProjectId(env)}.firebasestorage.app`;
}

/** A URL-restricted Mapbox token allows at most this many addresses (the city's `mapbox.allowedUrls`). */
const MAX_VIEWER_ORIGINS = 10;

/**
 * `HCM_VIEWER_ORIGINS` as the city's `mapbox.allowedUrls` holds them (https origins, no path, at most 10): anything else
 * is refused here, before a token is minted for addresses the city's schema would refuse to record (finding 3 of the M6
 * security review). `functions/build.mjs` refuses to build the same values, so a deploy never carries them.
 */
function viewerOriginsOf(value: string | undefined): string[] {
    const origins = listOf(value);
    const invalid = origins.filter((origin) => !httpsOriginSchema.safeParse(origin).success);
    if (invalid.length > 0 || origins.length > MAX_VIEWER_ORIGINS) {
        throw new Error(
            `HCM_VIEWER_ORIGINS must be at most ${String(MAX_VIEWER_ORIGINS)} https origins without a path: ${invalid.join(', ')}`,
        );
    }
    return origins;
}

/** `RuntimeConfig` (M2-interfaces §4.2) from the environment: values only, nothing secret. */
export function runtimeConfig(env: Env): RuntimeConfig {
    const projectId = requireProjectId(env);
    const viewerOrigins = viewerOriginsOf(env['HCM_VIEWER_ORIGINS']);
    const admin = adminSiteOf(projectId, env['HCM_ADMIN_SITE']);
    return {
        projectId,
        region: REGION,
        buckets: { private: privateBucket(env), public: `${projectId}-public` },
        viewerOrigins: viewerOrigins.length > 0 ? viewerOrigins : hostingOrigins(projectId),
        adminOrigins: admin.origins,
        // M6 (§2.3): the admin's folder on Hosting; invitations and the inbox's and push's links (`adminUrl + #/…`) open it.
        // §210: on the admin's own site once the installer saw it served there, else the public map's `/admin/` (forwarded).
        adminUrl: admin.url,
        oauthClientIds: listOf(env['HCM_OAUTH_CLIENT_IDS']),
        errorEndpoint: `https://${REGION}-${projectId}.cloudfunctions.net/telemetry-reportError`,
        appCheck: env['HCM_APP_CHECK'] === 'enforce' ? 'enforce' : 'monitor',
    };
}

interface Upstream {
    readonly fetch: Fetch;
    readonly tokens: TokenProvider;
}

/**
 * How the REST adapters reach the outside: in production the global `fetch` with the runtime service account's tokens
 * (Application Default Credentials); in the Functions emulator only the fake upstreams at `HCM_UPSTREAM_BASE`, with a
 * placeholder token, so no local run can call Google, Mapbox or USGS (CR-M2-14, CR-M2-22).
 */
function upstreamOf(env: Env): Upstream {
    if (env['FUNCTIONS_EMULATOR'] === 'true') {
        return { fetch: createEmulatorFetch(env['HCM_UPSTREAM_BASE'], globalThis.fetch), tokens: EMULATOR_TOKENS };
    }
    return { fetch: globalThis.fetch, tokens: createGoogleTokenProvider(new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })) };
}

interface SecretContext {
    readonly projectId: string;
    readonly upstream: Upstream;
    readonly log: Logger;
    readonly setup: SetupRecords;
}

/**
 * No local run can reach the real Secret Manager: in the Functions emulator the secrets live in the fake Secret Manager
 * of the fake upstreams (`HCM_UPSTREAM_BASE`), which every function's worker process shares (the e2e admin tier saves a
 * token with one function and reads it with another), or in memory when no fakes are configured.
 */
function secretStoreOf(env: Env, context: SecretContext): SecretStore {
    if (env['FUNCTIONS_EMULATOR'] === 'true' && env['HCM_UPSTREAM_BASE'] === undefined) {
        return createMemorySecretStore();
    }
    return createSecretManagerStore({
        projectId: context.projectId,
        tokens: context.upstream.tokens,
        fetch: context.upstream.fetch,
        clock: systemClock,
        log: context.log,
        ttlMs: SECRET_CACHE_TTL_MS,
        revision: secretsRevision(context.setup),
    });
}

/**
 * The address guard (`RemoteFiles`): in production it resolves the host itself and connects to the address it checked;
 * in the Functions emulator it keeps its address rules and sends the request to the fake upstreams, without DNS.
 */
function remoteFilesOf(env: Env, upstream: Upstream): RemoteFiles {
    if (env['FUNCTIONS_EMULATOR'] === 'true') {
        return createRemoteFiles({ get: fetchPinnedGet(upstream.fetch), resolve: undefined });
    }
    return createRemoteFiles({ get: httpsPinnedGet(), resolve: systemResolver });
}

/**
 * Nominatim at `HCM_NOMINATIM_URL` (a mirror, set at deploy time) or its own address. In the Functions emulator only the
 * fake's address is reachable (`createEmulatorFetch`), so a configured mirror is ignored there.
 */
function nominatimOptions(env: Env, upstream: Upstream): { readonly fetch: Fetch; readonly url?: string } {
    const mirror = env['FUNCTIONS_EMULATOR'] === 'true' ? undefined : env['HCM_NOMINATIM_URL'];
    return mirror === undefined || mirror === '' ? { fetch: upstream.fetch } : { fetch: upstream.fetch, url: mirror };
}

/**
 * The static export's signer (M5, `docs/research/M5-interfaces.md` §5.5) and the local worker's (M7): V4 signing with the
 * runtime account in production; in the Functions emulator, which has no account to sign with, the e2e stand-in, whose
 * worker objects are addresses of the Storage emulator the emulators set (`FIREBASE_STORAGE_EMULATOR_HOST`).
 */
function urlSignerOf(env: Env, storage: ReturnType<typeof getStorage>, buckets: RuntimeConfig['buckets']): UrlSigner {
    return env['FUNCTIONS_EMULATOR'] === 'true'
        ? createStandInUrlSigner(buckets, () => systemClock.now(), env['FIREBASE_STORAGE_EMULATOR_HOST'])
        : createStorageUrlSigner(storage, buckets);
}

/** The export kit `functions/build.mjs` copies beside the bundle (`dist/export-kit/`, M5 §5.3). */
const EXPORT_KIT_FOLDER = new URL('./export-kit/', import.meta.url);
/** The starter files' templates `functions/build.mjs` copies beside the bundle (`dist/starter/`, finding 73). */
const STARTER_FOLDER = new URL('./starter/', import.meta.url);

/** The composition root: the only place that picks adapters (tests build their ports from fakes instead). */
export function createDeps(env: Env, app: App): Deps {
    const config = runtimeConfig(env);
    const db = getFirestore(app);
    const log = createLogger('functions', { sink: createFunctionsLogSink(write) });
    const upstream = upstreamOf(env);
    const setup = firestoreSetupRecords(db);
    return {
        log,
        clock: systemClock,
        config,
        documents: createDocumentStore(db),
        auth: createAuthAdmin(getAuth(app)),
        secrets: secretStoreOf(env, { projectId: config.projectId, upstream, log, setup }),
        iam: createGoogleIam({ fetch: upstream.fetch }),
        firebase: createFirebaseManagement(upstream),
        errors: createErrorReporter({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch, write }),
        tasks: createCloudTaskQueue(getFunctions(app), config.region, { named: env['FUNCTIONS_EMULATOR'] !== 'true' }),
        blobs: createStorageBlobStore(getStorage(app), config.buckets),
        images: createSharpImageProcessor(),
        mapbox: createMapboxApi({ fetch: upstream.fetch }),
        usgs: createUsgsApi({ fetch: upstream.fetch, log }),
        jobs: createCloudRunJobs({ fetch: upstream.fetch, tokens: upstream.tokens, projectId: config.projectId, region: config.region }),
        tilesets: createMapboxTilesets({ fetch: upstream.fetch }),
        uploads: createMapboxUploads({ fetch: upstream.fetch, now: () => systemClock.now() }),
        scenes: createUsgsScenes({ fetch: upstream.fetch, log }),
        remote: remoteFilesOf(env, upstream),
        reader: createStorageBlobReader(getStorage(app), config.buckets),
        geocoder: createNominatim(nominatimOptions(env, upstream)),
        translator: createVertexAi({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch }),
        push: createFcm({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch }),
        admins: firestoreAdminDirectory(db),
        setup,
        writer: createStorageBlobWriter(getStorage(app), config.buckets),
        signer: urlSignerOf(env, getStorage(app), config.buckets),
        kit: createDiskExportKit(EXPORT_KIT_FOLDER),
        starters: createDiskStarterTemplates(STARTER_FOLDER),
    };
}

/**
 * The Admin SDK's options. In the Functions emulator the task queue's service account is named, because the SDK would
 * otherwise ask the metadata server, which does not exist locally, and wait for its timeout on every enqueue (14 s per
 * manifest request in the e2e admin tier); the Cloud Tasks emulator ignores the account. Deployed, the runtime's own
 * account comes from the metadata server.
 */
export function appOptions(env: Env): AppOptions | undefined {
    return env['FUNCTIONS_EMULATOR'] === 'true'
        ? { serviceAccountId: `fn-events@${requireProjectId(env)}.iam.gserviceaccount.com` }
        : undefined;
}

let deps: Deps | undefined;

/** The instance-wide dependencies, created by the first call that needs them (not at cold start). */
export function getDeps(): Deps {
    deps ??= createDeps(process.env, initializeApp(appOptions(process.env)));
    return deps;
}
