/**
 * Scripted fakes of the services `ops.tick` talks to (Firebase Auth, the Mapbox Tokens API, USGS M2M), recording
 * their calls; failures are scripted with `recorder.failNext`. Secrets live in the in-memory `SecretStore` the
 * Functions emulator uses. Every value is a generated test value.
 */
import { timestampFromDate } from '@hcm/shared';

import { createMemorySecretStore } from '../../src/adapters/secret-store-memory.js';
import type { AuthAdmin, AuthUser } from '../../src/ports/auth-admin.js';
import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import type { Geocoder } from '../../src/ports/geocoder.js';
import type { MapboxApi } from '../../src/ports/mapbox-api.js';
import type { SecretStore } from '../../src/ports/secret-store.js';
import type { UsgsApi } from '../../src/ports/usgs-api.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import { createFakeRemoteFiles } from '../support/imagery-fakes.js';
import { PortRecorder } from '../support/recorder.js';
import { createFakeErrorReporter } from '../support/services.js';

interface FakeAuth extends AuthAdmin {
    readonly recorder: PortRecorder<'listUsers' | 'deleteUser'>;
    readonly deleted: string[];
}

/** Accounts listed `pageSize` at a time (the real page holds 1000), so pagination is exercised. */
function fakeAuth(users: readonly AuthUser[], pageSize = 2): FakeAuth {
    const recorder = new PortRecorder<'listUsers' | 'deleteUser'>();
    const deleted: string[] = [];
    const unused = () => Promise.reject(new Error('not used by ops.tick'));
    return {
        recorder,
        deleted,
        getUser: unused,
        setAdminClaim: unused,
        revokeSessions: unused,
        createCustomToken: unused,
        listUsers: (pageToken) =>
            Promise.resolve().then(() => {
                recorder.enter('listUsers', [pageToken]);
                const start = Number(pageToken ?? '0');
                const next = start + pageSize;
                return { users: users.slice(start, next), ...(next < users.length ? { nextPageToken: String(next) } : {}) };
            }),
        deleteUser: (uid) =>
            Promise.resolve().then(() => {
                recorder.enter('deleteUser', [uid]);
                deleted.push(uid);
            }),
    };
}

export function account(uid: string, createdAt: string, email?: string): AuthUser {
    return {
        uid,
        emailVerified: true,
        providers: ['google.com'],
        createdAt: new Date(createdAt),
        customClaims: {},
        ...(email === undefined ? {} : { email }),
    };
}

type MapboxMethod = 'retrieveToken' | 'deleteToken';

interface FakeMapbox extends MapboxApi {
    readonly recorder: PortRecorder<MapboxMethod>;
}

function fakeMapbox(): FakeMapbox {
    const recorder = new PortRecorder<MapboxMethod>();
    const unused = () => Promise.reject(new Error('not used by ops.tick'));
    return {
        recorder,
        retrieveToken: () =>
            Promise.resolve().then(() => {
                recorder.enter('retrieveToken', []);
                return { user: 'hcm-test', usage: 'sk' as const, tokenId: 'bootstrap1' };
            }),
        listTokens: unused,
        createToken: unused,
        updateToken: unused,
        deleteToken: (user, _secret, tokenId) =>
            Promise.resolve().then(() => {
                recorder.enter('deleteToken', [user, tokenId]);
            }),
    };
}

type UsgsMethod = 'login' | 'permissions' | 'logout' | 'request';

interface FakeUsgs extends UsgsApi {
    readonly recorder: PortRecorder<UsgsMethod>;
}

function fakeUsgs(permissions: readonly string[]): FakeUsgs {
    const recorder = new PortRecorder<UsgsMethod>();
    return {
        recorder,
        login: (username) =>
            Promise.resolve().then(() => {
                recorder.enter('login', [username]);
                return 'usgs-api-key-test';
            }),
        permissions: (apiKey) =>
            Promise.resolve().then(() => {
                recorder.enter('permissions', [apiKey]);
                return permissions;
            }),
        logout: (apiKey) =>
            Promise.resolve().then(() => {
                recorder.enter('logout', [apiKey]);
            }),
        // M7's worker proxy: the ops checks never call M2M's other endpoints, so the fake answers nothing.
        request: (apiKey, endpoint) =>
            Promise.resolve().then(() => {
                recorder.enter('request', [apiKey, endpoint]);
                return null;
            }),
    };
}

type CrashGroup = Awaited<ReturnType<ErrorReporter['listGroups']>>['groups'][number];

export interface OpsTestDeps extends ContentDeps {
    readonly auth: FakeAuth;
    readonly secrets: SecretStore;
    readonly mapbox: FakeMapbox;
    readonly usgs: FakeUsgs;
    /** M4's crash-spike check reads Error Reporting's groups: `crashGroups` is what it lists (none by default). */
    readonly errors: ReturnType<typeof createFakeErrorReporter>['errors'];
    readonly errorsRecorder: ReturnType<typeof createFakeErrorReporter>['recorder'];
    readonly crashGroups: CrashGroup[];
    /** M28: the websites and Wikidata the country lists read (`serve` an address to make it answer), and Nominatim's country. */
    readonly remote: ReturnType<typeof createFakeRemoteFiles>['remote'];
    readonly sites: ReturnType<typeof createFakeRemoteFiles>;
    readonly geocoder: Geocoder;
    /** The country Nominatim answers for every place (`RO` by default; undefined: none). */
    country: string | undefined;
}

export function opsDeps(now: string, options: { users?: readonly AuthUser[]; permissions?: readonly string[] } = {}): OpsTestDeps {
    const sites = createFakeRemoteFiles();
    const deps: OpsTestDeps = {
        ...contentDeps(now),
        auth: fakeAuth(options.users ?? []),
        secrets: createMemorySecretStore(),
        mapbox: fakeMapbox(),
        usgs: fakeUsgs(options.permissions ?? ['search', 'download']),
        ...crashReporting(),
        remote: sites.remote,
        sites,
        country: 'RO',
        geocoder: {
            reverse: () => Promise.resolve({ licence: 'Data © OpenStreetMap contributors, ODbL 1.0', ...countryOf(deps.country) }),
            search: () => Promise.reject(new Error('not used by ops.tick')),
        },
    };
    return deps;
}

function countryOf(country: string | undefined): { readonly countryCode?: string } {
    return country === undefined ? {} : { countryCode: country };
}

/** An Error Reporting whose groups a test sets (`crashGroups`), for the crash-spike check. */
function crashReporting(): Pick<OpsTestDeps, 'errors' | 'errorsRecorder' | 'crashGroups'> {
    const crashGroups: CrashGroup[] = [];
    const { errors, recorder } = createFakeErrorReporter(crashGroups);
    return { errors, errorsRecorder: recorder, crashGroups };
}

/** A timestamp `hours` before `iso`. */
export function hoursBefore(iso: string, hours: number) {
    return timestampFromDate(new Date(Date.parse(iso) - hours * 3_600_000));
}
