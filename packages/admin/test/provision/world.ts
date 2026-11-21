import { createLogger, type Logger } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { createUpstreamFakes, E2E_PROJECT_CONFIG, GOOGLE_TOKENS, type RecordedCall, type UpstreamFakes } from '@hcm/test-support/fakes';

import { createGoogleClients, type GoogleClients } from '../../src/google/clients.js';
import { parseProjectConfig, type ProjectConfig } from '../../src/provision/project-config.js';
import type { ProvisionDeps } from '../../src/provision/provisioner.js';

/**
 * The provisioner's test world: the fake upstreams of `@hcm/test-support` (a fresh Firebase project, its billing already
 * linked because Provision cloud runs after step (b)), typed clients with the owner's token, and a recording logger.
 */

/** The value, failing the test when it is missing. */
export function must<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('expected a value');
    }
    return value;
}

export const PROJECT: ProjectConfig = must(parseProjectConfig(E2E_PROJECT_CONFIG));

export const OWNER_EMAIL = String(FIXTURE_VALUES['ownerEmail']);

export const BILLING_ACCOUNT = `billingAccounts/${String(FIXTURE_VALUES['billingAccountId'])}`;

export const WEB = { projectId: PROJECT.projectId, appId: String(FIXTURE_VALUES['appId']), apiKey: String(FIXTURE_VALUES['apiKey']) };

export interface ProvisionWorld {
    readonly fakes: UpstreamFakes;
    readonly clients: GoogleClients;
    readonly deps: ProvisionDeps;
    readonly log: Logger;
    readonly sink: RecordingSink;
    /** Drops the token, as a Google 401 does (every later call fails `unauthorized`). */
    dropToken(): void;
    /** Drops the token once `count` more calls were made. */
    dropTokenAfter(count: number): void;
    /** A renewed token (Continue, after a re-consent). */
    renewToken(): void;
    /** Creates the $5 budget step (b) leaves behind. */
    createBudget(): Promise<string>;
}

/** Every call that changes something (a read through POST, `getIamPolicy` and `testIamPermissions`, is not one). */
export function writes(fakes: UpstreamFakes): RecordedCall[] {
    return fakes.calls.filter((call) => call.method !== 'GET' && !/getIamPolicy|testIamPermissions/.test(call.operation));
}

export function provisionWorld(options: { readonly billing?: boolean; readonly ownerEmail?: string | null } = {}): ProvisionWorld {
    const fakes = createUpstreamFakes();
    if (options.billing !== false) {
        fakes.scenario('cloud-billing.enabled');
    }
    const sink = createRecordingSink();
    const log = createLogger('test', { sink: sink.sink, minLevel: 'debug' });
    let token: string | null = GOOGLE_TOKENS.owner;
    let dropAt: number | undefined;
    const clients = createGoogleClients({
        fetch: fakes.fetch,
        token: () => (dropAt !== undefined && fakes.calls.length >= dropAt ? null : token),
        sleep: () => Promise.resolve(),
        log,
    });
    const deps: ProvisionDeps = {
        project: PROJECT,
        web: WEB,
        ownerEmail: options.ownerEmail === undefined ? OWNER_EMAIL : options.ownerEmail,
        clients,
        log,
    };
    return {
        fakes,
        clients,
        deps,
        log,
        sink,
        dropToken: () => {
            token = null;
        },
        dropTokenAfter: (count) => {
            dropAt = fakes.calls.length + count;
        },
        renewToken: () => {
            token = GOOGLE_TOKENS.owner;
            dropAt = undefined;
        },
        createBudget: async () =>
            (
                await clients.billing.ensureBudget(BILLING_ACCOUNT, {
                    projectId: PROJECT.projectId,
                    projectNumber: PROJECT.projectNumber,
                    currencyCode: 'USD',
                    units: 5,
                })
            ).name,
    };
}
