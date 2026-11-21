import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, route, type Route, type RouteParams } from './routes.js';
import type { PolicyStore } from './google-policies.js';
import { MAPBOX_TOKENS } from './mapbox-state.js';
import type { ServiceFake } from './service.js';
import { USGS_CREDENTIALS } from './usgs.js';

/**
 * Secret Manager v1 (security review §1.2): secrets, versions added by `setup.saveMapbox` / `setup.saveUsgs`, read with
 * `versions/latest:access`, destroyed after a rotation. A secret must exist before a version is added (the provisioner
 * creates the four of `PROVISIONED_SECRETS`); a fresh project has none. Values are kept decoded, so a test asserts what
 * was stored with `latestSecretValue`.
 */

/** The secrets the provisioner creates (`SecretName` of functions/src/ports/secret-store.ts). */
export const PROVISIONED_SECRETS = ['mapbox-sk-bootstrap', 'mapbox-sk-tiles', 'usgs-username', 'usgs-app-token'] as const;

/**
 * What a project whose USGS and Mapbox cards are green holds (`secret-manager.imagerySecrets`, M3): the approved USGS
 * account's credentials (search and downloads) and the tiles token the M3 publisher uses (`docs/research/M3-interfaces.md`
 * §3.1, §7.3), so the Functions emulator's harvest, import and publish run without the Setup Assistant first.
 */
export const IMAGERY_SECRET_VALUES: Readonly<Record<(typeof PROVISIONED_SECRETS)[number], string>> = {
    'mapbox-sk-bootstrap': MAPBOX_TOKENS.bootstrap,
    'mapbox-sk-tiles': MAPBOX_TOKENS.tiles,
    'usgs-username': USGS_CREDENTIALS.approved.username,
    'usgs-app-token': USGS_CREDENTIALS.approved.applicationToken,
};

interface SecretVersion {
    readonly number: number;
    readonly value: string;
    state: 'ENABLED' | 'DISABLED' | 'DESTROYED';
}

export interface SecretsState {
    /** Project id → secret id → its versions, oldest first. */
    readonly projects: Map<string, Map<string, SecretVersion[]>>;
    /** `<project id>/<secret id>` → the secret's IAM policy (the provisioner's `iam` item). */
    readonly policies: PolicyStore;
}

const SECRET_MANAGER: GoogleApi = {
    service: 'secretmanager.googleapis.com',
    title: 'Secret Manager API',
    permission: 'secretmanager.versions.access',
};
const SECRET_ID = /^[\w-]{1,255}$/;

function encodeBase64(text: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function decodeBase64(data: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
}

/** The latest enabled value of a secret, or undefined. */
export function latestSecretValue(state: SecretsState, projectId: string, secretId: string): string | undefined {
    const versions = state.projects.get(projectId)?.get(secretId) ?? [];
    return versions.filter((version) => version.state === 'ENABLED').at(-1)?.value;
}

type SecretsOf = (segment: string) => { readonly number: string; readonly secrets: Map<string, SecretVersion[]> };
type SecretAnswer = (number: string, secretId: string, versions: SecretVersion[]) => Response;

const BASE = 'https://secretmanager.googleapis.com/v1/projects/{project}/secrets';

function auth(answer: Route['answer']): Route['answer'] {
    return authenticated(SECRET_MANAGER, answer);
}

function secretBody(number: string, secretId: string): unknown {
    return fixtureBody('secret-manager/secret.get', { projectNumber: number, secretId });
}

function versionBody(number: string, secretId: string, version: SecretVersion): Readonly<Record<string, unknown>> {
    const body = fixtureBody('secret-manager/add-version.ok', {
        projectNumber: number,
        secretId,
        version: String(version.number),
    }) as Record<string, unknown>;
    return { ...body, state: version.state };
}

/** `latest` (the newest enabled version) or a version number. */
function findVersion(versions: readonly SecretVersion[], wanted: string): SecretVersion | undefined {
    return wanted === 'latest'
        ? versions.filter((version) => version.state === 'ENABLED').at(-1)
        : versions.find((version) => String(version.number) === wanted);
}

/** The version routes: add, access, list, destroy and disable. */
function versionRoutes(withSecret: (params: RouteParams, answer: SecretAnswer) => Response): Route[] {
    const addVersion: Route['answer'] = (request, params) =>
        withSecret(params, (number, secretId, versions) => {
            const payload = bodyField(request, 'payload') as { data?: unknown } | undefined;
            if (typeof payload?.data !== 'string') {
                return googleError('google/error.invalid-argument', SECRET_MANAGER);
            }
            const version: SecretVersion = { number: versions.length + 1, value: decodeBase64(payload.data), state: 'ENABLED' };
            versions.push(version);
            return jsonResponse(versionBody(number, secretId, version));
        });
    const access: Route['answer'] = (_request, params) =>
        withSecret(params, (number, secretId, versions) => {
            const version = findVersion(versions, String(params['version']));
            if (version?.state !== 'ENABLED') {
                return googleError('secret-manager/access.not-found', SECRET_MANAGER, { projectNumber: number, secretId });
            }
            return jsonResponse({ name: versionBody(number, secretId, version)['name'], payload: { data: encodeBase64(version.value) } });
        });
    const setState =
        (target: 'DISABLED' | 'DESTROYED'): Route['answer'] =>
        (_request, params) =>
            withSecret(params, (number, secretId, versions) => {
                const version = findVersion(versions, String(params['version']));
                if (version === undefined) {
                    return googleError('google/error.not-found', SECRET_MANAGER);
                }
                version.state = target;
                return jsonResponse(versionBody(number, secretId, version));
            });
    // Newest first, destroyed versions included (with their state), as Secret Manager lists them; `filter=state:ENABLED`
    // (the only filter the fake reads) keeps one state.
    const list: Route['answer'] = (request, params) =>
        withSecret(params, (number, secretId, versions) => {
            const state = /^state:(ENABLED|DISABLED|DESTROYED)$/.exec(request.url.searchParams.get('filter') ?? '')?.[1];
            const listed = versions.filter((version) => state === undefined || version.state === state).reverse();
            return jsonResponse({ versions: listed.map((version) => versionBody(number, secretId, version)), totalSize: listed.length });
        });
    return [
        route('GET', `${BASE}/{secret}/versions/{version}:access`, 'secret-manager.versions.access', auth(access)),
        route('POST', `${BASE}/{secret}/versions/{version}:destroy`, 'secret-manager.versions.destroy', auth(setState('DESTROYED'))),
        route('POST', `${BASE}/{secret}/versions/{version}:disable`, 'secret-manager.versions.disable', auth(setState('DISABLED'))),
        route('GET', `${BASE}/{secret}/versions`, 'secret-manager.versions.list', auth(list)),
        route('POST', `${BASE}/{secret}:addVersion`, 'secret-manager.secrets.addVersion', auth(addVersion)),
    ];
}

/** The fake Secret Manager API. */
export function createSecretManagerFake(state: SecretsState, projects: GoogleProjects): ServiceFake {
    const secretsOf: SecretsOf = (segment) => {
        const project = projects.resolve(segment);
        const existing = state.projects.get(project.id);
        const secrets = existing ?? new Map<string, SecretVersion[]>();
        if (existing === undefined) {
            state.projects.set(project.id, secrets);
        }
        return { number: project.number, secrets };
    };
    /** Runs `answer` with the secret's versions, or answers 404 for a secret that does not exist. */
    const withSecret = (params: RouteParams, answer: SecretAnswer): Response => {
        const { number, secrets } = secretsOf(String(params['project']));
        const secretId = String(params['secret']);
        const versions = secrets.get(secretId);
        return versions === undefined ? googleError('google/error.not-found', SECRET_MANAGER) : answer(number, secretId, versions);
    };
    const create: Route['answer'] = (request, params) => {
        const { number, secrets } = secretsOf(String(params['project']));
        const secretId = request.url.searchParams.get('secretId') ?? '';
        if (!SECRET_ID.test(secretId)) {
            return googleError('google/error.invalid-argument', SECRET_MANAGER);
        }
        if (secrets.has(secretId)) {
            return googleError('secret-manager/secret.exists', SECRET_MANAGER, { projectNumber: number, secretId });
        }
        secrets.set(secretId, []);
        return jsonResponse(secretBody(number, secretId));
    };
    const policyKey = (params: RouteParams): string => `${projects.resolve(String(params['project'])).id}/${String(params['secret'])}`;
    return {
        name: 'secret-manager',
        routes: [
            ...versionRoutes(withSecret),
            route('POST', BASE, 'secret-manager.secrets.create', auth(create)),
            route(
                'GET',
                `${BASE}/{secret}:getIamPolicy`,
                'secret-manager.secrets.getIamPolicy',
                auth((_request, params) => withSecret(params, () => jsonResponse(state.policies.read(policyKey(params))))),
            ),
            route(
                'POST',
                `${BASE}/{secret}:setIamPolicy`,
                'secret-manager.secrets.setIamPolicy',
                auth((request, params) =>
                    withSecret(params, () => {
                        const stored = state.policies.write(policyKey(params), request);
                        return stored === undefined ? googleError('google/error.aborted', SECRET_MANAGER) : jsonResponse(stored);
                    }),
                ),
            ),
            route(
                'GET',
                `${BASE}/{secret}`,
                'secret-manager.secrets.get',
                auth((_request, params) => withSecret(params, (number, secretId) => jsonResponse(secretBody(number, secretId)))),
            ),
            route(
                'DELETE',
                `${BASE}/{secret}`,
                'secret-manager.secrets.delete',
                auth((_request, params) =>
                    withSecret(params, () => {
                        secretsOf(String(params['project'])).secrets.delete(String(params['secret']));
                        return jsonResponse({});
                    }),
                ),
            ),
        ],
        failure: (mode) => googleFailure(SECRET_MANAGER, mode),
        scenarios: {
            provisioned: () => {
                const { secrets } = secretsOf(String(FIXTURE_VALUES['projectId']));
                PROVISIONED_SECRETS.filter((secretId) => !secrets.has(secretId)).forEach((secretId) => secrets.set(secretId, []));
            },
            imagerySecrets: () => {
                const { secrets } = secretsOf(String(FIXTURE_VALUES['projectId']));
                Object.entries(IMAGERY_SECRET_VALUES).forEach(([secretId, value]) => {
                    const versions = secrets.get(secretId) ?? [];
                    versions.push({ number: versions.length + 1, value, state: 'ENABLED' });
                    secrets.set(secretId, versions);
                });
            },
        },
        snapshot: () => ({
            projects: Object.fromEntries([...state.projects].map(([id, secrets]) => [id, Object.fromEntries(secrets)])),
            policies: state.policies.snapshot(),
        }),
    };
}
