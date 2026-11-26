import { PIPELINE_REPOSITORY, PRIVATE_BUCKET_LIFECYCLE } from '@hcm/shared';

import { pipelineRepositorySpec } from '../google/artifact-registry.js';
import { ensureBindings, missingBindings, type PolicyAccess, type WantedBinding } from '../google/iam-policy.js';
import type { Bucket } from '../google/storage.js';
import { isGoogleFailure } from '../google/failure.js';
import { at, matchesSpec, records, type JsonObject } from '../google/json.js';
import { eachInTurn, lacking, ok, refused, type Observation, type ProvisionContext, type ProvisionItemSpec } from './item.js';
import { PUBLIC_PULL, repositoryBindings } from './resources.js';

/**
 * The storage items (`docs/research/M2b-interfaces.md` §3.4 items 4–6, §3.4.2): Firebase Storage's default bucket (the
 * private one) and the public bucket with its public read, their CORS rules, and the private bucket's lifecycle. An
 * organisation policy that refuses `allUsers` leaves `buckets` invalid with its constraint named; the buckets themselves
 * are still created.
 */

/** `get` without `list` for everyone (security review §1.5); `objectViewer` when the legacy role is refused. */
const PUBLIC_READ: WantedBinding = { role: 'roles/storage.legacyObjectReader', member: 'allUsers' };
const PUBLIC_READ_FALLBACK: WantedBinding = { role: 'roles/storage.objectViewer', member: 'allUsers' };

/** What `buckets` may lack. */
const DEFAULT_BUCKET = 'default-bucket' as const;
const PUBLIC_BUCKET = 'public-bucket' as const;
const PUBLIC_READ_PART = 'public-read' as const;

const CORS_HEADERS = ['Content-Type', 'Range', 'Content-Range', 'ETag', 'Accept-Ranges'];

function corsRule(origins: readonly string[]): JsonObject[] {
    return [{ origin: origins, method: ['GET', 'HEAD'], responseHeader: CORS_HEADERS, maxAgeSeconds: 3600 }];
}

/**
 * The private bucket's lifecycle, `PRIVATE_BUCKET_LIFECYCLE` of `@hcm/shared` (CR-M3-6): `tmp/` after a day, `uploads/`
 * after a week, the raster pipeline's `work/` after two, `usgs-raw/` after a week (M7: `locate` deletes it sooner) and the cached `reference/` after 90 days.
 */
const LIFECYCLE: JsonObject = {
    rule: PRIVATE_BUCKET_LIFECYCLE.map(({ prefix, days }) => ({
        action: { type: 'Delete' },
        condition: { age: days, matchesPrefix: [prefix] },
    })),
};

/** The CORS rules of a bucket: the public one for every origin, the private one for the admin only. */
function corsFor(context: ProvisionContext, bucket: string): JsonObject[] {
    return corsRule(bucket === context.names.publicBucket ? ['*'] : context.names.adminOrigins);
}

function publiclyReadable(bindings: readonly { readonly role: string; readonly members: readonly string[] }[]): boolean {
    return bindings.some(
        (binding) => [PUBLIC_READ.role, PUBLIC_READ_FALLBACK.role].includes(binding.role) && binding.members.includes('allUsers'),
    );
}

/** The constraint that refuses `allUsers` on the project, if any. */
async function publicReadBlocker(context: ProvisionContext): Promise<string | undefined> {
    const findings = await context.findings();
    if (findings.domainRestricted) {
        return 'iam.allowedPolicyMemberDomains';
    }
    return findings.publicAccessPrevention ? 'storage.publicAccessPrevention' : undefined;
}

/** The public bucket, `taken` when another project owns its name (Google answers 403 for a bucket we cannot read). */
async function readPublicBucket(context: ProvisionContext): Promise<Bucket | undefined | 'taken'> {
    try {
        const bucket = await context.clients.storage.getBucket(context.names.publicBucket);
        return bucket === undefined || bucket.projectNumber === context.project.projectNumber ? bucket : 'taken';
    } catch (error) {
        return takenWhenForbidden(error);
    }
}

/** A 403 that does not name a disabled API: the bucket belongs to someone else. */
function takenWhenForbidden(error: unknown): 'taken' {
    if (isGoogleFailure(error, 'forbidden') && error.api === undefined) {
        return 'taken';
    }
    throw error;
}

/** What the public bucket lacks: itself and its public read, or only the read. */
async function publicBucketParts(context: ProvisionContext): Promise<readonly string[] | 'taken'> {
    const bucket = await readPublicBucket(context);
    if (bucket === undefined || bucket === 'taken') {
        return bucket ?? [PUBLIC_BUCKET, PUBLIC_READ_PART];
    }
    const policy = await context.clients.storage.bucketPolicy(bucket.name).read();
    return publiclyReadable(policy.bindings) ? [] : [PUBLIC_READ_PART];
}

/** The lacking parts, except a public read an organisation policy refuses: that one makes the item invalid. */
function bucketObservation(context: ProvisionContext, lacks: readonly string[], blocker: string | undefined): Observation {
    const creatable = blocker === undefined ? lacks : lacks.filter((part) => part !== PUBLIC_READ_PART);
    if (creatable.length === 0 && blocker !== undefined && lacks.includes(PUBLIC_READ_PART)) {
        return refused('adminSetup.provision.orgPolicy', { constraint: blocker });
    }
    return lacking(creatable, () => createParts(context, creatable));
}

/** Grants the public read; a refused legacy role (uniform access) falls back to `objectViewer` (**UNVERIFIED**). */
async function grantPublicRead(context: ProvisionContext): Promise<void> {
    const policy = context.clients.storage.bucketPolicy(context.names.publicBucket);
    try {
        await ensureBindings(policy, [PUBLIC_READ]);
    } catch (error) {
        if (!isGoogleFailure(error, 'invalid')) {
            throw error;
        }
        await ensureBindings(policy, [PUBLIC_READ_FALLBACK]);
    }
}

const BUCKET_PARTS = [DEFAULT_BUCKET, PUBLIC_BUCKET, PUBLIC_READ_PART] as const;

const CREATE_PART: Readonly<Record<(typeof BUCKET_PARTS)[number], (context: ProvisionContext) => Promise<unknown>>> = {
    [DEFAULT_BUCKET]: ({ clients, project }) => clients.storage.addDefaultBucket(project.projectNumber, project.region),
    [PUBLIC_BUCKET]: ({ clients, project, names }) =>
        clients.storage.createBucket(project.projectId, project.projectNumber, {
            name: names.publicBucket,
            location: project.region.toUpperCase(),
            storageClass: 'STANDARD',
            iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'inherited' },
        }),
    [PUBLIC_READ_PART]: grantPublicRead,
};

function createParts(context: ProvisionContext, lacks: readonly string[]): Promise<void> {
    return eachInTurn(
        BUCKET_PARTS.filter((part) => lacks.includes(part)),
        (part) => CREATE_PART[part](context),
    );
}

const buckets: ProvisionItemSpec = {
    id: 'buckets',
    after: ['apis', 'org-policies'],
    observe: async (context) => {
        const parts = await publicBucketParts(context);
        if (parts === 'taken') {
            return refused('apiError.conflict', { bucket: context.names.publicBucket });
        }
        const hasDefault = await context.clients.storage.hasDefaultBucket(context.project.projectNumber);
        return bucketObservation(context, [...(hasDefault ? [] : [DEFAULT_BUCKET]), ...parts], await publicReadBlocker(context));
    },
};

/** The buckets whose `field` does not match its spec (a missing bucket counts as not matching). */
async function bucketsDiffering(context: ProvisionContext, specs: ReadonlyMap<string, JsonObject>): Promise<string[]> {
    const names = [...specs.keys()];
    const found = await Promise.all(names.map((name) => context.clients.storage.getBucket(name)));
    return names.filter((name, index) => !matchesSpec(found[index]?.body, specs.get(name)));
}

const bucketCors: ProvisionItemSpec = {
    id: 'bucket-cors',
    after: ['buckets'],
    observe: async (context) => {
        const { privateBucket, publicBucket } = context.names;
        const specs = new Map([privateBucket, publicBucket].map((name) => [name, { cors: corsFor(context, name) }]));
        const differing = await bucketsDiffering(context, specs);
        return lacking(differing, () =>
            eachInTurn(differing, (name) => context.clients.storage.patchBucket(name, { cors: corsFor(context, name) })),
        );
    },
};

/** Soft delete is off for the private bucket (uploads and temporary files are not worth keeping deleted). */
function softDeleteOff(body: JsonObject | undefined): boolean {
    return Number(at(body, 'softDeletePolicy', 'retentionDurationSeconds') ?? 'x') === 0;
}

const bucketLifecycle: ProvisionItemSpec = {
    id: 'bucket-lifecycle',
    after: ['buckets'],
    observe: async ({ clients, names }) => {
        const bucket = await clients.storage.getBucket(names.privateBucket);
        const rules = records(at(bucket?.body, 'lifecycle', 'rule'));
        const right = matchesSpec({ rule: rules }, LIFECYCLE) && softDeleteOff(bucket?.body);
        return lacking(right ? [] : [names.privateBucket], () =>
            clients.storage.patchBucket(names.privateBucket, { lifecycle: LIFECYCLE, softDeletePolicy: { retentionDurationSeconds: '0' } }),
        );
    },
};

/**
 * M7 (`docs/research/M7-local-worker.md` §1.1): the runs in which an organisation policy refused the image's public pull
 * at the write (the organisation's findings did not foresee it), so the run's next look leaves the image private.
 */
const PULL_REFUSED = new WeakSet<ProvisionContext>();

/** The constraint that keeps the image private. */
const PULL_CONSTRAINT = 'iam.allowedPolicyMemberDomains';

/** Whether this run leaves the image private: the organisation refuses `allUsers`, foreseen or met at the write. */
async function pullBlocked(context: ProvisionContext): Promise<boolean> {
    const restricted = await context.findings().then(
        (findings) => findings.domainRestricted,
        () => false,
    );
    return restricted || PULL_REFUSED.has(context);
}

/** The public pull (`PUBLIC_PULL`); an organisation policy's refusal is recorded for the run, never a failure. */
async function grantPublicPull(context: ProvisionContext, access: PolicyAccess): Promise<void> {
    try {
        await ensureBindings(access, [PUBLIC_PULL]);
    } catch (error) {
        if (!isGoogleFailure(error, 'orgPolicy')) {
            throw error;
        }
        PULL_REFUSED.add(context);
    }
}

/** What the repository lacks: itself, and the bindings `wanted` its policy does not hold. */
async function repositoryLacks(context: ProvisionContext, wanted: readonly WantedBinding[], access: PolicyAccess): Promise<string[]> {
    const { clients, project } = context;
    const found = await clients.artifactRegistry.get(project.projectId, project.region, PIPELINE_REPOSITORY);
    if (found === undefined) {
        return [PIPELINE_REPOSITORY, 'binding'];
    }
    return missingBindings(await access.read(), wanted).length === 0 ? [] : ['binding'];
}

/** Creates what lacks: the repository, the installer's role, and the public pull unless the organisation refuses it. */
async function fixRepository(context: ProvisionContext, lacks: readonly string[], access: PolicyAccess, blocked: boolean): Promise<void> {
    const { clients, project } = context;
    if (lacks.includes(PIPELINE_REPOSITORY)) {
        await clients.artifactRegistry.create(project.projectId, project.region, PIPELINE_REPOSITORY, pipelineRepositorySpec());
    }
    await ensureBindings(access, repositoryBindings(project).bindings);
    if (!blocked) {
        await grantPublicPull(context, access);
    }
}

/**
 * M6 (`docs/research/M6-interfaces.md` §1.6, CR-M6-2): the Docker repository `hcm` in the project's region, where the
 * in-app installer pushes the imagery pipeline's image (a cleanup policy keeps the two newest), and the installer's
 * writer role on it (§1.2); `missing` creates the repository, then binds the role. Finding 31 of 2026-10-31: only the
 * optional imagery pipeline needs either, so the binding lives here, not in the `iam` item, which the server needs and
 * which no longer waits for this one; Setup's step d waits for the items the server needs only (`serverPrepared`).
 * M7 (`docs/research/M7-local-worker.md` §1.1): `allUsers` may pull the image too (`PUBLIC_PULL`); where an organisation
 * policy refuses it the item is still `ok`, with the constraint named, and Provision goes on.
 */
const artifactRegistry: ProvisionItemSpec = {
    id: 'artifact-registry',
    after: ['apis', 'service-accounts'],
    observe: async (context) => {
        const { project } = context;
        const access = context.clients.artifactRegistry.repositoryPolicy(project.projectId, project.region, PIPELINE_REPOSITORY);
        const blocked = await pullBlocked(context);
        const wanted = blocked ? repositoryBindings(project).bindings : [...repositoryBindings(project).bindings, PUBLIC_PULL];
        const lacks = await repositoryLacks(context, wanted, access);
        if (blocked && lacks.length === 0) {
            return { ...ok(), detail: 'adminSetup.provision.orgPolicy', params: { constraint: PULL_CONSTRAINT } };
        }
        return lacking(lacks, () => fixRepository(context, lacks, access, blocked));
    },
};

export const STORAGE_ITEMS: readonly ProvisionItemSpec[] = [buckets, artifactRegistry, bucketCors, bucketLifecycle];
