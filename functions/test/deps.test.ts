import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { write } from 'firebase-functions/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../src/adapters/system-clock.js';
import { appOptions, createDeps, getDeps, privateBucket, runtimeConfig } from '../src/deps.js';
import { UpstreamError } from '../src/ports/errors.js';

// Application Default Credentials and Cloud Logging are outside boundaries: stand-ins only.
vi.mock('google-auth-library', () => ({
    GoogleAuth: class {
        getAccessToken(): Promise<string> {
            return Promise.resolve('adc-test-access-token');
        }
    },
}));
vi.mock('firebase-functions/logger', () => ({ write: vi.fn() }));

const PROJECT = { GCLOUD_PROJECT: 'demo-hcm' } as const;
const EMULATOR = { ...PROJECT, FUNCTIONS_EMULATOR: 'true' } as const;
const FAKES = 'http://127.0.0.1:4311';

let app: App;

beforeAll(() => {
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-deps');
});

afterAll(async () => {
    await deleteApp(app);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function answering(status: number, body: unknown) {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

describe('runtimeConfig', () => {
    it('happyPath_everyValueFollowsFromTheProject', () => {
        expect(runtimeConfig(PROJECT)).toEqual({
            projectId: 'demo-hcm',
            region: 'us-central1',
            buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
            viewerOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'],
            adminOrigins: [
                'https://demo-hcm.web.app',
                'https://demo-hcm.firebaseapp.com',
                'https://demo-hcm-admin.web.app',
                'https://demo-hcm-admin.firebaseapp.com',
            ],
            adminUrl: 'https://demo-hcm.web.app/admin/',
            oauthClientIds: [],
            errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
            appCheck: 'monitor',
        });
    });

    it('happyPath_theListsAndAppCheckComeFromTheEnvironment', () => {
        const config = runtimeConfig({
            ...PROJECT,
            HCM_VIEWER_ORIGINS: ' https://city-one.example , ,https://city-two.example',
            HCM_OAUTH_CLIENT_IDS: 'client-one.apps.example,client-two.apps.example',
            HCM_APP_CHECK: 'enforce',
        });

        expect(config).toMatchObject({
            viewerOrigins: ['https://city-one.example', 'https://city-two.example'],
            oauthClientIds: ['client-one.apps.example', 'client-two.apps.example'],
            appCheck: 'enforce',
        });
    });

    it('happyPath_theAdminsOwnSiteNamedByTheInstallerIsWhereLinksGo', () => {
        const config = runtimeConfig({ ...PROJECT, HCM_ADMIN_SITE: 'demo-hcm-admin' });

        expect(config.adminUrl).toBe('https://demo-hcm-admin.web.app/admin/');
        expect(config.adminOrigins).toContain('https://demo-hcm-admin.web.app');
    });

    it('happyPath_aProjectWithoutAnAdminSiteKeepsThePublicMapsOrigins', () => {
        const config = runtimeConfig({ ...PROJECT, HCM_ADMIN_SITE: 'none' });

        expect(config.adminOrigins).toEqual(['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com']);
        expect(config.adminUrl).toBe('https://demo-hcm.web.app/admin/');
    });

    it('badPath_anAdminSiteThatIsNoSiteIdFailsFast', () => {
        expect(() => runtimeConfig({ ...PROJECT, HCM_ADMIN_SITE: 'https://elsewhere.example' })).toThrow('HCM_ADMIN_SITE');
    });

    it('badPath_withoutAProjectIdFailsFast', () => {
        expect(() => runtimeConfig({})).toThrow('GCLOUD_PROJECT is not set');
    });

    it.each([
        ['a trailing slash', 'https://city.example/'],
        ['a path', 'https://city.example/map'],
        ['plain http', 'http://city.example'],
        ['eleven origins', Array.from({ length: 11 }, (_, index) => `https://city-${String(index)}.example`).join(',')],
    ])('badPath_viewerOriginsACityCannotRecordAreRefusedBeforeAnyMint (%s) @S-A06-BAD-ORIGINS-REFUSED', (_case, origins) => {
        // A token minted for them could never be written to the city (its schema refuses them): finding 3 of the M6
        // security review, where each tick then minted another live token.
        expect(() => runtimeConfig({ ...PROJECT, HCM_VIEWER_ORIGINS: origins })).toThrow('HCM_VIEWER_ORIGINS must be');
    });
});

describe('privateBucket', () => {
    it('happyPath_theDefaultBucketOfFirebaseConfig', () => {
        expect(privateBucket({ FIREBASE_CONFIG: JSON.stringify({ storageBucket: 'demo-hcm.appspot.com' }) })).toBe('demo-hcm.appspot.com');
    });

    it.each(['not json', 'null', '42', JSON.stringify({ storageBucket: '' }), JSON.stringify({ storageBucket: 7 })])(
        'badPath_anUnusableFirebaseConfigFallsBackToTheProjectsBucket %s',
        (config) => {
            expect(privateBucket({ ...PROJECT, FIREBASE_CONFIG: config })).toBe('demo-hcm.firebasestorage.app');
        },
    );
});

describe('createDeps', () => {
    it('happyPath_wiresEveryPort', () => {
        const deps = createDeps(EMULATOR, app);

        expect(Object.keys(deps).sort((a, b) => a.localeCompare(b))).toEqual(
            [
                'admins',
                'auth',
                'blobs',
                'clock',
                'config',
                'documents',
                'errors',
                'firebase',
                'geocoder',
                'iam',
                'images',
                'jobs',
                'kit',
                'log',
                'mapbox',
                'push',
                'reader',
                'remote',
                'scenes',
                'secrets',
                'setup',
                'signer',
                'starters',
                'tasks',
                'tilesets',
                'translator',
                'uploads',
                'usgs',
                'writer',
            ].sort((a, b) => a.localeCompare(b)),
        );
        expect(deps.clock).toBe(systemClock);
        expect(deps.config.projectId).toBe('demo-hcm');
    });

    it('happyPath_theEmulatorWithTheFakesKeepsSecretsInTheFakeSecretManager', async () => {
        const fetch = answering(200, { payload: { data: Buffer.from('emulator-usgs-token').toString('base64') } });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps({ ...EMULATOR, HCM_UPSTREAM_BASE: FAKES }, app);

        await expect(deps.secrets.read('usgs-app-token')).resolves.toBe('emulator-usgs-token');
        expect(fetch).toHaveBeenCalledWith(
            `${FAKES}/h/secretmanager.googleapis.com/v1/projects/demo-hcm/secrets/usgs-app-token/versions/latest:access`,
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('happyPath_theEmulatorWithoutTheFakesKeepsSecretsInMemory', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(EMULATOR, app);

        await deps.secrets.write('usgs-app-token', 'emulator-usgs-token');

        await expect(deps.secrets.read('usgs-app-token')).resolves.toBe('emulator-usgs-token');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('happyPath_theEmulatorSendsUpstreamCallsToTheFakesWithAPlaceholderToken', async () => {
        const fetch = answering(200, { apps: [{ appId: '1:000000000000:web:e2e', state: 'ACTIVE' }] });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps({ ...EMULATOR, HCM_UPSTREAM_BASE: FAKES }, app);

        await expect(deps.firebase.listWebApps('demo-hcm')).resolves.toEqual([{ appId: '1:000000000000:web:e2e', state: 'ACTIVE' }]);
        expect(fetch).toHaveBeenCalledWith(
            `${FAKES}/h/firebase.googleapis.com/v1beta1/projects/demo-hcm/webApps?pageSize=100`,
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({ authorization: 'Bearer emulator-access-token' }) as unknown,
            }),
        );
    });

    it('badPath_theEmulatorWithoutTheFakesReachesNoUpstream', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(EMULATOR, app);

        await expect(deps.iam.tokenInfo('emulator-caller-token')).rejects.toMatchObject({
            service: 'google-oauth',
            failure: 'unavailable',
        });
        await expect(deps.mapbox.retrieveToken('sk.emulator')).rejects.toBeInstanceOf(UpstreamError);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('createDeps: the M3 ports', () => {
    it('happyPath_theEmulatorSendsCloudRunAndRemoteFilesToTheFakes', async () => {
        const fetch = answering(200, {
            name: 'projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/e1',
            succeededCount: 1,
        });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps({ ...EMULATOR, HCM_UPSTREAM_BASE: FAKES }, app);

        await expect(deps.jobs.get('projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/e1')).resolves.toEqual({
            state: 'succeeded',
        });
        await expect(
            deps.remote.get('https://api.mapbox.com/v4/e2e.tiles/1/0/0.png', { maxBytes: 10_000, timeoutMs: 1000 }),
        ).resolves.toMatchObject({
            status: 200,
        });
        expect(fetch).toHaveBeenNthCalledWith(
            1,
            `${FAKES}/h/run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/e1`,
            expect.objectContaining({ method: 'GET' }),
        );
        expect(fetch).toHaveBeenNthCalledWith(
            2,
            `${FAKES}/h/api.mapbox.com/v4/e2e.tiles/1/0/0.png`,
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('badPath_productionRemoteFilesRefuseALoopbackHostBeforeAnyRequest', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(PROJECT, app);

        await expect(deps.remote.get('https://localhost/tile.png', { maxBytes: 100, timeoutMs: 1000 })).rejects.toMatchObject({
            service: 'remote',
            failure: 'forbidden',
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('happyPath_productionReadsSecretManagerOverRestWithAdc', async () => {
        const fetch = answering(404, { error: { code: 404, status: 'NOT_FOUND' } });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(PROJECT, app);

        await expect(deps.secrets.read('mapbox-sk-tiles')).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledWith(
            'https://secretmanager.googleapis.com/v1/projects/demo-hcm/secrets/mapbox-sk-tiles/versions/latest:access',
            expect.objectContaining({
                method: 'GET',
                headers: { authorization: 'Bearer adc-test-access-token', 'content-type': 'application/json' },
            }),
        );
    });

    it('happyPath_logsGoToCloudLoggingRedacted', () => {
        const deps = createDeps(EMULATOR, app);

        deps.log.warn('mapbox rejected', { token: 'sk.e2e' });

        expect(write).toHaveBeenCalledWith({
            severity: 'WARNING',
            message: '[functions] mapbox rejected',
            scope: 'functions',
            token: '[redacted]',
        });
    });
});

describe('createDeps: the M4 ports (docs/research/M4-interfaces.md §4, §5)', () => {
    it('happyPath_theEmulatorSendsNominatimVertexAiAndFcmToTheFakes', async () => {
        const fetch = vi.fn((input: string) =>
            Promise.resolve(
                new Response(JSON.stringify(input.includes('countTokens') ? { totalTokens: 1 } : { name: 'Piața Romană', licence: 'l' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps({ ...EMULATOR, HCM_UPSTREAM_BASE: FAKES, HCM_NOMINATIM_URL: 'https://mirror.example/reverse' }, app);

        await expect(deps.geocoder.reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).resolves.toMatchObject({ name: 'Piața Romană' });
        await expect(deps.translator.countTokens('gemini-3.5-flash-lite', 'test')).resolves.toBe(1);
        await expect(deps.push.validate({ kind: 'token', value: 'e2e-fcm-token:laptop-xxxxxxxxxxxxxxxxxxxx' })).resolves.toEqual({
            ok: true,
        });
        const urls = fetch.mock.calls.map(([url]) => url.split('?')[0]);
        expect(urls).toEqual([
            `${FAKES}/h/nominatim.openstreetmap.org/reverse`,
            `${FAKES}/h/us-central1-aiplatform.googleapis.com/v1/projects/demo-hcm/locations/us-central1/publishers/google/models/gemini-3.5-flash-lite:countTokens`,
            `${FAKES}/h/fcm.googleapis.com/v1/projects/demo-hcm/messages:send`,
        ]);
    });

    it('happyPath_productionAsksAConfiguredNominatimMirror', async () => {
        const fetch = answering(200, { error: 'Unable to geocode' });
        vi.stubGlobal('fetch', fetch);

        const mirrored = createDeps({ ...PROJECT, HCM_NOMINATIM_URL: 'https://mirror.example/reverse' }, app);
        await expect(mirrored.geocoder.reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).resolves.toBeUndefined();
        await createDeps({ ...PROJECT, HCM_NOMINATIM_URL: '' }, app).geocoder.reverse({ lat: 44.4, lng: 26.1, lang: 'en' });

        const calls = fetch.mock.calls as unknown as [string][];
        expect(calls.map(([url]) => url.split('?')[0])).toEqual([
            'https://mirror.example/reverse',
            'https://nominatim.openstreetmap.org/reverse',
        ]);
    });
});

describe('appOptions', () => {
    it('happyPath_theEmulatorNamesTheTaskQueuesAccountSoNoMetadataServerIsAsked', () => {
        expect(appOptions(EMULATOR)).toEqual({ serviceAccountId: 'fn-events@demo-hcm.iam.gserviceaccount.com' });
    });

    it('badPath_deployedTheRuntimesOwnAccountIsUsed', () => {
        expect(appOptions(PROJECT)).toBeUndefined();
    });
});

describe('getDeps', () => {
    it('happyPath_createsTheDependenciesOncePerInstance', () => {
        vi.stubEnv('GCLOUD_PROJECT', 'demo-hcm');

        const first = getDeps();

        expect(getDeps()).toBe(first);
    });
});

describe('createDeps: the M5 export ports (docs/research/M5-interfaces.md §5)', () => {
    it('happyPath_theEmulatorSignsDownloadsWithTheStandIn', async () => {
        const deps = createDeps(EMULATOR, app);

        const url = new URL(
            await deps.signer.signedDownload('private', {
                path: 'exports/cluj/x-1.zip',
                expiresAt: new Date('2030-01-01T00:00:00Z'),
                fileName: 'cluj-2026-11-02.zip',
            }),
        );

        expect(`${url.origin}${url.pathname}`).toBe('https://storage.googleapis.com/demo-hcm.firebasestorage.app/exports/cluj/x-1.zip');
        expect(url.searchParams.get('X-Goog-Algorithm')).toBe('hcm-emulator-stand-in');
    });

    it('badPath_theKitIsReadFromBesideTheBundle_soTheSourceTreeHasNone', async () => {
        const deps = createDeps(PROJECT, app);

        await expect(deps.kit.engineVersion()).rejects.toThrow();
        await expect(deps.starters.read('hcm-worker.sh')).rejects.toThrow();
    });
});
