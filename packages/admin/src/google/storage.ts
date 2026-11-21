import { isGoogleFailure } from './failure.js';
import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { asRecord, stringAt, type JsonObject } from './json.js';
import { createOnce, type GoogleTransport } from './transport.js';

/**
 * The Cloud Storage JSON API's bucket calls and the Firebase Storage default-bucket API, for the `buckets`,
 * `bucket-cors`, `bucket-lifecycle` and `iam` items (`docs/research/M2b-interfaces.md` §3.4). Objects are never touched
 * here. The Firebase Storage request shape is **UNVERIFIED** until the first real project (the fakes follow the
 * documented `v1alpha` `defaultBucket` resource).
 */

const STORAGE = 'https://storage.googleapis.com/storage/v1';
const FIREBASE_STORAGE = 'https://firebasestorage.googleapis.com/v1alpha';
const ROLE = 'roles/storage.admin';

export interface Bucket {
    readonly name: string;
    readonly projectNumber: string;
    readonly body: JsonObject;
}

type BucketCreate = 'created' | 'exists' | 'taken';

export interface StorageClient {
    /** The bucket, or undefined when it does not exist; a bucket of another project answers 403 (thrown). */
    getBucket(name: string): Promise<Bucket | undefined>;
    /** Creates a bucket; `exists` when this project already owns it, `taken` when another project does. */
    createBucket(projectId: string, projectNumber: string, body: JsonObject): Promise<BucketCreate>;
    patchBucket(name: string, body: JsonObject): Promise<void>;
    bucketPolicy(name: string): PolicyAccess;
    /** The Cloud Storage service agent of the project (created on first read). */
    serviceAgent(projectId: string): Promise<string>;
    /** True when Firebase Storage has its default bucket. */
    hasDefaultBucket(projectNumber: string): Promise<boolean>;
    addDefaultBucket(projectNumber: string, location: string): Promise<void>;
}

function bucketOf(body: unknown): Bucket | undefined {
    const name = stringAt(body, 'name');
    return name === undefined ? undefined : { name, projectNumber: stringAt(body, 'projectNumber') ?? '', body: asRecord(body) };
}

async function getBucket(transport: GoogleTransport, name: string): Promise<Bucket | undefined> {
    return bucketOf(await transport.find({ operation: 'cloud-storage.buckets.get', url: `${STORAGE}/b/${name}` }));
}

/** A 409 is ours ("you already own it") or another project's name: a read tells which. */
async function ownerAfterConflict(transport: GoogleTransport, name: string, projectNumber: string): Promise<BucketCreate> {
    try {
        const bucket = await getBucket(transport, name);
        return bucket?.projectNumber === projectNumber ? 'exists' : 'taken';
    } catch (error) {
        if (isGoogleFailure(error, 'forbidden')) {
            return 'taken';
        }
        throw error;
    }
}

async function createBucket(transport: GoogleTransport, projectId: string, projectNumber: string, body: JsonObject): Promise<BucketCreate> {
    const created = await createOnce(transport, {
        operation: 'cloud-storage.buckets.insert',
        method: 'POST',
        url: `${STORAGE}/b`,
        query: { project: projectId },
        body,
        role: ROLE,
    });
    return created ? 'created' : ownerAfterConflict(transport, String(body['name']), projectNumber);
}

function bucketPolicy(transport: GoogleTransport, name: string): PolicyAccess {
    const url = `${STORAGE}/b/${name}/iam`;
    return {
        read: async () =>
            parsePolicy(
                await transport.call({ operation: 'cloud-storage.buckets.getIamPolicy', url, query: { optionsRequestedPolicyVersion: 3 } }),
            ),
        write: (policy) =>
            transport.call({ operation: 'cloud-storage.buckets.setIamPolicy', method: 'PUT', url, body: policy, role: ROLE }),
    };
}

export function createStorageClient(transport: GoogleTransport): StorageClient {
    return {
        getBucket: (name) => getBucket(transport, name),
        createBucket: (projectId, projectNumber, body) => createBucket(transport, projectId, projectNumber, body),
        patchBucket: async (name, body) => {
            await transport.call({
                operation: 'cloud-storage.buckets.patch',
                method: 'PATCH',
                url: `${STORAGE}/b/${name}`,
                body,
                role: ROLE,
            });
        },
        bucketPolicy: (name) => bucketPolicy(transport, name),
        serviceAgent: async (projectId) =>
            stringAt(
                await transport.call({ operation: 'cloud-storage.serviceAccount', url: `${STORAGE}/projects/${projectId}/serviceAccount` }),
                'email_address',
            ) ?? '',
        hasDefaultBucket: async (projectNumber) =>
            (await transport.find({
                operation: 'firebase-storage.defaultBucket.get',
                url: `${FIREBASE_STORAGE}/projects/${projectNumber}/defaultBucket`,
            })) !== undefined,
        addDefaultBucket: async (projectNumber, location) => {
            await transport.call({
                operation: 'firebase-storage.defaultBucket.create',
                method: 'POST',
                url: `${FIREBASE_STORAGE}/projects/${projectNumber}/defaultBucket`,
                body: { location },
                role: 'roles/firebasestorage.admin',
            });
        },
    };
}
