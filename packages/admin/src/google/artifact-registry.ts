import { PIPELINE_REPOSITORY } from '@hcm/shared';

import { isGoogleFailure } from './failure.js';
import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { isRecord, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Artifact Registry v1 for the imagery pipeline's image (`docs/research/M6-interfaces.md` §1.6): the Docker repository
 * `hcm` in the project's region. The installer reads it before it submits the pipeline build (S-A56-BAD-NO-REPOSITORY);
 * Prepare the project's `artifact-registry` item creates it with {@link pipelineRepositorySpec} (server-bugs).
 */

const ARTIFACT_REGISTRY = 'https://artifactregistry.googleapis.com/v1';

interface RepositoryView {
    /** `projects/<p>/locations/<r>/repositories/<id>`. */
    readonly name: string;
    /** `DOCKER`, … */
    readonly format: string;
}

export interface ArtifactRegistryClient {
    get(projectId: string, region: string, repository: string): Promise<RepositoryView | undefined>;
    /** Creates the repository (waits for the operation); resolves to false when it existed already. */
    create(projectId: string, region: string, repository: string, spec: Readonly<Record<string, unknown>>): Promise<boolean>;
    /** The repository's IAM policy (server-bugs, CR-M6-2: the installer's `roles/artifactregistry.writer` on `hcm` only). */
    repositoryPolicy(projectId: string, region: string, repository: string): PolicyAccess;
}

/** The pipeline's repository: Docker, keeping the two newest images (the cleanup policy deletes the older ones). */
export function pipelineRepositorySpec(): Readonly<Record<string, unknown>> {
    return {
        format: 'DOCKER',
        description: `Historic City Map Maker: the raster pipeline's image (${PIPELINE_REPOSITORY})`,
        cleanupPolicyDryRun: false,
        cleanupPolicies: {
            'keep-two-newest': { id: 'keep-two-newest', action: 'KEEP', mostRecentVersions: { keepCount: 2 } },
            'delete-older': { id: 'delete-older', action: 'DELETE', condition: { tagState: 'ANY' } },
        },
    };
}

export function createArtifactRegistryClient(transport: GoogleTransport): ArtifactRegistryClient {
    const base = (projectId: string, region: string): string =>
        `${ARTIFACT_REGISTRY}/projects/${projectId}/locations/${region}/repositories`;
    return {
        get: async (projectId, region, repository) => {
            const body = await transport.find({
                operation: 'artifact-registry.repositories.get',
                url: `${base(projectId, region)}/${encodeURIComponent(repository)}`,
            });
            return isRecord(body) ? { name: stringAt(body, 'name') ?? '', format: stringAt(body, 'format') ?? '' } : undefined;
        },
        create: async (projectId, region, repository, spec) => {
            try {
                const started = await transport.call({
                    operation: 'artifact-registry.repositories.create',
                    method: 'POST',
                    url: base(projectId, region),
                    query: { repositoryId: repository },
                    body: spec,
                    role: 'roles/owner',
                });
                await transport.operation(ARTIFACT_REGISTRY, started, {
                    operation: 'artifact-registry.repositories.create',
                    role: 'roles/owner',
                });
                return true;
            } catch (error) {
                if (isGoogleFailure(error, 'conflict')) {
                    return false;
                }
                throw error;
            }
        },
        repositoryPolicy: (projectId, region, repository) => {
            const resource = `${base(projectId, region)}/${encodeURIComponent(repository)}`;
            return {
                read: async () =>
                    parsePolicy(
                        await transport.call({ operation: 'artifact-registry.repositories.getIamPolicy', url: `${resource}:getIamPolicy` }),
                    ),
                write: (policy) =>
                    transport.call({
                        operation: 'artifact-registry.repositories.setIamPolicy',
                        method: 'POST',
                        url: `${resource}:setIamPolicy`,
                        body: { policy },
                        role: 'roles/owner',
                    }),
            };
        },
    };
}
