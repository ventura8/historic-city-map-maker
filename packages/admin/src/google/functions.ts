import { BACKGROUND_FUNCTIONS, CALLABLE_NAMES, deployedName, HTTP_ENDPOINTS, parseReleaseTime } from '@hcm/shared';

import { lastSegment, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Functions v2's list for step (d), the server's deployment (`docs/research/M2b-interfaces.md` §3.3 d): every
 * registry function must be `ACTIVE`. A project where nothing was ever deployed has the Cloud Functions API disabled
 * (403 `SERVICE_DISABLED`), which the step reads as `missing`.
 */

const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2';

export interface DeployedFunction {
    /** The short name (`admin-session`). */
    readonly id: string;
    /** `ACTIVE`, `DEPLOYING`, `FAILED`, ... */
    readonly state: string;
    /** M6: the release the function runs (its `HCM_RELEASE` environment variable), or null for a deploy without one. */
    readonly release: string | null;
    /** Its build time (`HCM_RELEASE_TIME`, finding 39 of 2026-11-01), or null for a deploy without one. */
    readonly releaseTime: number | null;
}

export interface FunctionsClient {
    list(projectId: string, region: string): Promise<DeployedFunction[]>;
}

export interface DeploymentStatus {
    readonly state: 'ok' | 'pending' | 'invalid';
    readonly ready: number;
    readonly total: number;
    /** The registry names whose deployment failed. */
    readonly failed: readonly string[];
}

/** Every function the backend deploys (`deployedName` of the callables, the worker's included, the HTTPS endpoints and the triggers). */
export function expectedFunctions(): string[] {
    return [...CALLABLE_NAMES, ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)].map(deployedName);
}

function deploymentState(ready: number, total: number, failed: number): DeploymentStatus['state'] {
    if (failed > 0) {
        return 'invalid';
    }
    return ready === total ? 'ok' : 'pending';
}

/** Every expected function `ACTIVE`: `ok`; one `FAILED`: `invalid`; otherwise `pending` with the count of ready ones. */
export function deploymentStatus(
    functions: readonly Pick<DeployedFunction, 'id' | 'state'>[],
    expected: readonly string[] = expectedFunctions(),
): DeploymentStatus {
    const states = new Map(functions.map((item) => [item.id, item.state]));
    const ready = expected.filter((id) => states.get(id) === 'ACTIVE').length;
    const failed = expected.filter((id) => states.get(id) === 'FAILED');
    return { state: deploymentState(ready, expected.length, failed.length), ready, total: expected.length, failed };
}

export function createFunctionsClient(transport: GoogleTransport): FunctionsClient {
    return {
        list: async (projectId, region) =>
            records(
                await transport.pages(
                    {
                        operation: 'cloud-functions.list',
                        url: `${FUNCTIONS}/projects/${projectId}/locations/${region}/functions`,
                        query: { pageSize: 100 },
                    },
                    'functions',
                ),
            ).map((item) => ({
                id: lastSegment(String(item['name'])),
                state: stringAt(item, 'state') ?? 'STATE_UNSPECIFIED',
                release: stringAt(item, 'serviceConfig', 'environmentVariables', 'HCM_RELEASE') ?? null,
                releaseTime: parseReleaseTime(stringAt(item, 'serviceConfig', 'environmentVariables', 'HCM_RELEASE_TIME')),
            })),
    };
}
