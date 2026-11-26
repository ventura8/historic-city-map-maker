import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The Cloud Storage JSON API's bucket calls, for the Provision cloud step (`buckets`, `bucket-cors`,
 * `bucket-lifecycle`; scenario S-A04-BAD-ORG-POLICY): create, read and patch a bucket, and its IAM policy. With
 * `publicAccessPrevented` (an organization policy) a policy naming `allUsers` is refused with 412. Objects are not
 * faked here: the Storage emulator serves them.
 */

interface Bucket {
    readonly projectNumber: string;
    /** `cors`, `lifecycle`, `iamConfiguration`, ... as last patched. */
    readonly settings: Record<string, unknown>;
    bindings: readonly { readonly role: string; readonly members: readonly string[] }[];
}

export interface CloudStorageState {
    /** Bucket name → bucket (bucket names are global). */
    readonly buckets: Map<string, Bucket>;
    /** `constraints/storage.publicAccessPrevention`: an IAM policy with `allUsers` or `allAuthenticatedUsers` gets 412. */
    publicAccessPrevented: boolean;
    /** Uniform bucket-level access refuses the legacy object roles (`roles/storage.legacyObject*`) with 400 (**UNVERIFIED**). */
    legacyRolesRefused: boolean;
}

const STORAGE: GoogleApi = { service: 'storage.googleapis.com', title: 'Cloud Storage JSON API', permission: 'storage.buckets.create' };
const PUBLIC_MEMBERS = new Set(['allUsers', 'allAuthenticatedUsers']);
const SETTINGS = [
    'cors',
    'lifecycle',
    'iamConfiguration',
    'labels',
    'versioning',
    'website',
    'softDeletePolicy',
    'location',
    'storageClass',
];

function settingsOf(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(SETTINGS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

/** Adds a bucket of `projectNumber` (Firebase Storage's default bucket is a Cloud Storage bucket too). */
export function addBucket(state: CloudStorageState, name: string, projectNumber: string): void {
    if (!state.buckets.has(name)) {
        state.buckets.set(name, { projectNumber, settings: {}, bindings: [] });
    }
}

/** A project number that is not the e2e project's: the owner of a bucket name that is taken. */
const OTHER_PROJECT_NUMBER = '999999999999';

/** The fake bucket API of Cloud Storage. */
export function createCloudStorageFake(state: CloudStorageState, projects: GoogleProjects): ServiceFake {
    const bucketBody = (name: string, bucket: Bucket): Readonly<Record<string, unknown>> => ({
        ...(fixtureBody('cloud-storage/bucket.get', { bucket: name, projectNumber: bucket.projectNumber }) as Record<string, unknown>),
        ...bucket.settings,
    });
    const withBucket = (params: RouteParams, answer: (name: string, bucket: Bucket) => Response): Response => {
        const name = String(params['bucket']);
        const bucket = state.buckets.get(name);
        return bucket === undefined ? fixtureResponse('cloud-storage/bucket.not-found') : answer(name, bucket);
    };
    const create: Route['answer'] = (request) => {
        const project = projects.resolve(request.url.searchParams.get('project') ?? '');
        const name = bodyField(request, 'name');
        if (typeof name !== 'string' || !/^[a-z\d][a-z\d._-]{1,220}[a-z\d]$/.test(name)) {
            return googleError('google/error.invalid-argument', STORAGE);
        }
        if (state.buckets.has(name)) {
            return fixtureResponse('cloud-storage/bucket.exists');
        }
        const bucket: Bucket = { projectNumber: project.number, settings: settingsOf(requestObject(request)), bindings: [] };
        state.buckets.set(name, bucket);
        return jsonResponse(bucketBody(name, bucket));
    };
    /** Why a policy write is refused: public members under public access prevention (412), a legacy object role under uniform access (400). */
    const policyRefusal = (list: Bucket['bindings']): Response | undefined => {
        if (state.publicAccessPrevented && list.some((binding) => binding.members.some((member) => PUBLIC_MEMBERS.has(member)))) {
            return fixtureResponse('cloud-storage/bucket-iam.public-access-prevented');
        }
        const legacy = state.legacyRolesRefused && list.some((binding) => binding.role.startsWith('roles/storage.legacyObject'));
        return legacy ? googleError('google/error.invalid-argument', STORAGE) : undefined;
    };
    const setPolicy: Route['answer'] = (request, params) =>
        withBucket(params, (name, bucket) => {
            const bindings = bodyField(request, 'bindings');
            const list = Array.isArray(bindings) ? (bindings as Bucket['bindings']) : [];
            const refused = policyRefusal(list);
            if (refused !== undefined) {
                return refused;
            }
            bucket.bindings = list;
            return jsonResponse({
                ...(fixtureBody('cloud-storage/bucket-iam.ok', { bucket: name }) as Record<string, unknown>),
                bindings: list,
            });
        });
    const base = 'https://storage.googleapis.com/storage/v1/b';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(STORAGE, answer);
    return {
        name: 'cloud-storage',
        routes: [
            route('POST', base, 'cloud-storage.buckets.insert', auth(create)),
            route(
                'GET',
                `${base}/{bucket}/iam`,
                'cloud-storage.buckets.getIamPolicy',
                auth((_request, params) =>
                    withBucket(params, (name, bucket) => {
                        const policy = fixtureBody('cloud-storage/bucket-iam.ok', { bucket: name }) as { bindings: unknown[] };
                        return jsonResponse({ ...policy, bindings: [...policy.bindings, ...bucket.bindings] });
                    }),
                ),
            ),
            route('PUT', `${base}/{bucket}/iam`, 'cloud-storage.buckets.setIamPolicy', auth(setPolicy)),
            route(
                'GET',
                'https://storage.googleapis.com/storage/v1/projects/{project}/serviceAccount',
                'cloud-storage.serviceAccount',
                auth((_request, params) =>
                    fixtureResponse('cloud-storage/storage-agent.get', {
                        values: { projectNumber: projects.resolve(String(params['project'])).number },
                    }),
                ),
            ),
            route(
                'GET',
                `${base}/{bucket}`,
                'cloud-storage.buckets.get',
                auth((_request, params) => withBucket(params, (name, bucket) => jsonResponse(bucketBody(name, bucket)))),
            ),
            route(
                'PATCH',
                `${base}/{bucket}`,
                'cloud-storage.buckets.patch',
                auth((request, params) =>
                    withBucket(params, (name, bucket) => {
                        Object.assign(bucket.settings, settingsOf(requestObject(request)));
                        return jsonResponse(bucketBody(name, bucket));
                    }),
                ),
            ),
        ],
        failure: (mode) => googleFailure(STORAGE, mode),
        scenarios: {
            publicAccessPrevented: () => {
                state.publicAccessPrevented = true;
            },
            bucketsProvisioned: () => {
                const projectId = String(FIXTURE_VALUES['projectId']);
                const { number } = projects.resolve(projectId);
                for (const name of [`${projectId}.firebasestorage.app`, `${projectId}-public`]) {
                    addBucket(state, name, number);
                }
            },
            legacyRolesRefused: () => {
                state.legacyRolesRefused = true;
            },
            publicBucketTaken: () => {
                addBucket(state, `${String(FIXTURE_VALUES['projectId'])}-public`, OTHER_PROJECT_NUMBER);
            },
        },
        snapshot: () => ({
            buckets: Object.fromEntries(state.buckets),
            publicAccessPrevented: state.publicAccessPrevented,
            legacyRolesRefused: state.legacyRolesRefused,
        }),
    };
}
