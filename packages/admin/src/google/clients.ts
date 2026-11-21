import { createApiKeysClient, type ApiKeysClient } from './api-keys.js';
import { createArtifactRegistryClient, type ArtifactRegistryClient } from './artifact-registry.js';
import { createAppCheckClient, type AppCheckClient } from './app-check.js';
import { createBillingClient, type BillingClient } from './billing.js';
import { createAnalyticsClient, type AnalyticsClient } from './firebase.js';
import { createFunctionsClient, type FunctionsClient } from './functions.js';
import { createHostingSitesClient, type HostingSitesClient } from './hosting-sites.js';
import { createIamClient, type IamClient } from './iam.js';
import { createMonitoringClient, type MonitoringClient } from './monitoring.js';
import { createPubSubClient, type PubSubClient } from './pubsub.js';
import { createQueuesClient, type QueuesClient } from './queues.js';
import { createResourceManagerClient, type ResourceManagerClient } from './resource-manager.js';
import { createSecretManagerClient, type SecretManagerClient } from './secret-manager.js';
import { createServiceUsageClient, type ServiceUsageClient } from './service-usage.js';
import { createStorageClient, type StorageClient } from './storage.js';
import { createGoogleTransport, type GoogleTransportOptions } from './transport.js';

/**
 * Every typed Google REST client of the admin over one transport (one access token, one `fetch`): what the Setup
 * Assistant's bootstrap steps and the provisioner call (`docs/research/M2b-interfaces.md` §3). Build one per token:
 * `createGoogleClients({fetch, token: () => store.token(), sleep: clock.sleep, log})`.
 */
export interface GoogleClients {
    readonly resourceManager: ResourceManagerClient;
    readonly billing: BillingClient;
    readonly serviceUsage: ServiceUsageClient;
    readonly iam: IamClient;
    readonly storage: StorageClient;
    readonly secretManager: SecretManagerClient;
    readonly pubsub: PubSubClient;
    readonly queues: QueuesClient;
    readonly appCheck: AppCheckClient;
    readonly monitoring: MonitoringClient;
    readonly apiKeys: ApiKeysClient;
    readonly functions: FunctionsClient;
    readonly analytics: AnalyticsClient;
    /** M6: the imagery pipeline's Docker repository (`docs/research/M6-interfaces.md` §1.6, §1.10). */
    readonly artifactRegistry: ArtifactRegistryClient;
    /** §210: the admin's own Hosting site and Firebase Auth's authorised domains. */
    readonly hosting: HostingSitesClient;
}

export function createGoogleClients(options: GoogleTransportOptions): GoogleClients {
    const transport = createGoogleTransport(options);
    return {
        resourceManager: createResourceManagerClient(transport),
        billing: createBillingClient(transport),
        serviceUsage: createServiceUsageClient(transport),
        iam: createIamClient(transport),
        storage: createStorageClient(transport),
        secretManager: createSecretManagerClient(transport),
        pubsub: createPubSubClient(transport),
        queues: createQueuesClient(transport),
        appCheck: createAppCheckClient(transport),
        monitoring: createMonitoringClient(transport),
        apiKeys: createApiKeysClient(transport),
        functions: createFunctionsClient(transport),
        analytics: createAnalyticsClient(transport),
        artifactRegistry: createArtifactRegistryClient(transport),
        hosting: createHostingSitesClient(transport),
    };
}
