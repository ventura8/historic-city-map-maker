import { FIXTURE_VALUES, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { PolicyStore } from './google-policies.js';
import type { UpstreamRequest } from './fetch.js';
import { jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Artifact Registry v1 (`docs/research/M6-interfaces.md` §1.6, §1.10): the Docker repositories of a project's region,
 * created at once (the operation reads back as done; a second create answers 409 `ALREADY_EXISTS`), and each repository's
 * IAM policy, where Prepare the project's `artifact-registry` item gives the installer `roles/artifactregistry.writer` on
 * `hcm` only (the `iam` item's before finding 31 of 2026-10-31).
 * Made by server-bugs for the `artifact-registry` item; the installer's pipeline build reads the same repositories.
 */

export interface ArtifactRegistryState {
    /** `<project id>/<region>/<repository>` → the repository as created (its spec with its name). */
    readonly repositories: Map<string, Readonly<Record<string, unknown>>>;
    readonly policies: PolicyStore;
    /** Scenario `createRefused` (finding 31): the owner's organisation refuses the repository, so a create answers 403. */
    createRefused?: boolean;
    /**
     * Scenario `publicPullRefused` (M7): an organisation policy the findings did not show refuses `allUsers` on the
     * repository, so a policy naming it answers 400 with `constraints/iam.allowedPolicyMemberDomains`.
     */
    publicPullRefused?: boolean;
}

export function defaultArtifactRegistryState(): ArtifactRegistryState {
    return { repositories: new Map(), policies: new PolicyStore() };
}

const API: GoogleApi = {
    service: 'artifactregistry.googleapis.com',
    title: 'Artifact Registry API',
    permission: 'artifactregistry.repositories.create',
};
const BASE = 'https://artifactregistry.googleapis.com/v1/projects/{project}/locations/{region}/repositories';

/** The fake Artifact Registry API. */
export function createArtifactRegistryFake(state: ArtifactRegistryState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('e2e-repository-');
    const keyOf = (params: RouteParams, repository: string): string =>
        `${projects.resolve(String(params['project'])).id}/${String(params['region'])}/${repository}`;
    const nameOf = (params: RouteParams, repository: string): string =>
        `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/repositories/${repository}`;
    const withRepository = (params: RouteParams, answer: (key: string) => Response): Response => {
        const key = keyOf(params, String(params['repository']));
        return state.repositories.has(key) ? answer(key) : googleError('google/error.not-found', API);
    };
    /** Why a create is refused: the organisation (scenario `createRefused`), no id, or a repository already there. */
    const refusal = (repository: string, key: string): Response | undefined => {
        if (state.createRefused === true) {
            return googleError('google/error.permission-denied', API, { permission: 'artifactregistry.repositories.create' });
        }
        if (repository === '' || state.repositories.has(key)) {
            return googleError(repository === '' ? 'google/error.invalid-argument' : 'google/error.already-exists', API);
        }
        return undefined;
    };
    const create: Route['answer'] = (request, params) => {
        const repository = request.url.searchParams.get('repositoryId') ?? '';
        const key = keyOf(params, repository);
        const refused = refusal(repository, key);
        if (refused !== undefined) {
            return refused;
        }
        const created = { ...requestObject(request), name: nameOf(params, repository) };
        state.repositories.set(key, created);
        return jsonResponse({
            name: `projects/${String(params['project'])}/locations/${String(params['region'])}/operations/${nextOperation()}`,
            done: true,
            response: created,
        });
    };
    const publicPull = (request: UpstreamRequest): boolean =>
        state.publicPullRefused === true && JSON.stringify(requestObject(request)).includes('"allUsers"');
    const setPolicy: Route['answer'] = (request, params) =>
        withRepository(params, (key) => {
            if (publicPull(request)) {
                return fixtureResponse('resource-manager/set-iam-policy.org-policy', { values: { member: 'allUsers' } });
            }
            const stored = state.policies.write(key, request);
            return stored === undefined ? googleError('google/error.aborted', API) : jsonResponse(stored);
        });
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(API, answer);
    return {
        name: 'artifact-registry',
        routes: [
            route(
                'GET',
                `${BASE}/{repository}:getIamPolicy`,
                'artifact-registry.repositories.getIamPolicy',
                auth((_request, params) => withRepository(params, (key) => jsonResponse(state.policies.read(key)))),
            ),
            route('POST', `${BASE}/{repository}:setIamPolicy`, 'artifact-registry.repositories.setIamPolicy', auth(setPolicy)),
            route(
                'GET',
                `${BASE}/{repository}`,
                'artifact-registry.repositories.get',
                auth((_request, params) => withRepository(params, (key) => jsonResponse(state.repositories.get(key)))),
            ),
            route('POST', BASE, 'artifact-registry.repositories.create', auth(create)),
        ],
        failure: (mode) => googleFailure(API, mode),
        scenarios: {
            // What Prepare the project leaves: the pipeline's repository of the demo project (its writer bound with it).
            provisioned: () => {
                const name = `projects/${String(FIXTURE_VALUES['projectId'])}/locations/us-central1/repositories/hcm`;
                state.repositories.set(`${String(FIXTURE_VALUES['projectId'])}/us-central1/hcm`, { name, format: 'DOCKER' });
            },
            /**
             * Finding 31 of 2026-10-31: the repository cannot be made (a 403 for the create), so Prepare the project's
             * `artifact-registry` item fails; only the optional imagery pipeline needs it, so Install the server goes on.
             */
            createRefused: () => {
                state.createRefused = true;
            },
            publicPullRefused: () => {
                state.publicPullRefused = true;
            },
        },
        snapshot: () => ({ repositories: Object.fromEntries(state.repositories), policies: state.policies.snapshot() }),
    };
}
