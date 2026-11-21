import { lastSegment, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Service Usage v1 (the `apis` item, and the checks of steps (a) and (b); `docs/research/M2b-interfaces.md` §3.3, §3.4):
 * the enabled APIs, `services:batchEnable` (at most 20 per call, each operation polled to done) and, from v1beta1,
 * `generateServiceIdentity` (a Google service agent created before the `iam` item binds a role to it).
 */

const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
const SERVICE_USAGE_BETA = 'https://serviceusage.googleapis.com/v1beta1';
/** Service Usage refuses a batch of more than 20 services. */
export const BATCH_ENABLE_LIMIT = 20;
const ROLE = 'roles/serviceusage.serviceUsageAdmin';

export interface ServiceUsageClient {
    /** The enabled APIs of the project (`secretmanager.googleapis.com`, ...). */
    listEnabled(project: string): Promise<string[]>;
    isEnabled(project: string, service: string): Promise<boolean>;
    /** Enables the services, 20 per call, and waits for each operation. */
    enable(project: string, services: readonly string[]): Promise<void>;
    /** The e-mail address of the service's agent in the project, created when missing. */
    serviceIdentity(project: string, service: string): Promise<string>;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, index * size + size));
}

export function createServiceUsageClient(transport: GoogleTransport): ServiceUsageClient {
    return {
        listEnabled: async (project) => {
            const services = await transport.pages(
                {
                    operation: 'service-usage.list',
                    url: `${SERVICE_USAGE}/projects/${project}/services`,
                    query: { filter: 'state:ENABLED', pageSize: 200 },
                },
                'services',
            );
            return records(services)
                .filter((service) => service['state'] === 'ENABLED')
                .map((service) => stringAt(service, 'config', 'name') ?? lastSegment(String(service['name'])));
        },
        isEnabled: async (project, service) => {
            const body = await transport.call({
                operation: 'service-usage.get',
                url: `${SERVICE_USAGE}/projects/${project}/services/${service}`,
            });
            return stringAt(body, 'state') === 'ENABLED';
        },
        enable: async (project, services) => {
            for (const batch of chunks(services, BATCH_ENABLE_LIMIT)) {
                const started = await transport.call({
                    operation: 'service-usage.batchEnable',
                    method: 'POST',
                    url: `${SERVICE_USAGE}/projects/${project}/services:batchEnable`,
                    body: { serviceIds: batch },
                    role: ROLE,
                });
                await transport.operation(SERVICE_USAGE, started, { operation: 'service-usage.batchEnable', role: ROLE });
            }
        },
        serviceIdentity: async (project, service) => {
            const started = await transport.call({
                operation: 'service-usage.generateServiceIdentity',
                method: 'POST',
                url: `${SERVICE_USAGE_BETA}/projects/${project}/services/${service}:generateServiceIdentity`,
                role: ROLE,
            });
            const identity = await transport.operation(SERVICE_USAGE_BETA, started, {
                operation: 'service-usage.generateServiceIdentity',
                role: ROLE,
            });
            return stringAt(identity, 'email') ?? '';
        },
    };
}
