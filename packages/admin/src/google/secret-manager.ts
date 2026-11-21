import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { createOnce, type GoogleTransport } from './transport.js';

/**
 * Secret Manager v1 for the `secrets` and `iam` items (`docs/research/M2b-interfaces.md` §3.4): the provisioner creates
 * the secrets' shells only (automatic replication, label `app=historic-city-map`, no version) and binds who may read or
 * add versions. The values arrive later through `setup.saveUsgs` and `setup.saveMapbox`; the browser never reads or
 * writes a secret version.
 */

const SECRET_MANAGER = 'https://secretmanager.googleapis.com/v1';
const ROLE = 'roles/secretmanager.admin';

export interface SecretManagerClient {
    exists(projectId: string, secretId: string): Promise<boolean>;
    /** Creates the shell; an existing secret is success. */
    create(projectId: string, secretId: string): Promise<void>;
    secretPolicy(projectId: string, secretId: string): PolicyAccess;
}

export function createSecretManagerClient(transport: GoogleTransport): SecretManagerClient {
    const secret = (projectId: string, secretId: string): string => `${SECRET_MANAGER}/projects/${projectId}/secrets/${secretId}`;
    return {
        exists: async (projectId, secretId) =>
            (await transport.find({ operation: 'secret-manager.secrets.get', url: secret(projectId, secretId) })) !== undefined,
        create: async (projectId, secretId) => {
            await createOnce(transport, {
                operation: 'secret-manager.secrets.create',
                method: 'POST',
                url: `${SECRET_MANAGER}/projects/${projectId}/secrets`,
                query: { secretId },
                body: { replication: { automatic: {} }, labels: { app: 'historic-city-map' } },
                role: ROLE,
            });
        },
        secretPolicy: (projectId, secretId) => ({
            read: async () =>
                parsePolicy(
                    await transport.call({
                        operation: 'secret-manager.secrets.getIamPolicy',
                        url: `${secret(projectId, secretId)}:getIamPolicy`,
                        query: { 'options.requestedPolicyVersion': 3 },
                    }),
                ),
            write: (policy) =>
                transport.call({
                    operation: 'secret-manager.secrets.setIamPolicy',
                    method: 'POST',
                    url: `${secret(projectId, secretId)}:setIamPolicy`,
                    body: { policy },
                    role: ROLE,
                }),
        }),
    };
}
