import { at, lastSegment, records, stringAt, strings, type JsonObject } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Build v1 for the in-app installer (`docs/research/M6-interfaces.md` §1.4, §1.7): the admin submits a regional
 * build with the owner's token and reads it back (its status, each step's status and timing), and finds a target's
 * builds by tag, newest first. A build's definition is the installer's (`../install/build-spec.ts`); nothing here
 * reads a URL from Google's answer (the console link is built from the build's id).
 */

const CLOUD_BUILD = 'https://cloudbuild.googleapis.com/v1';

/** A tag Cloud Build accepts, and safe inside the list filter's quotes. */
const TAG = /^\w[\w.-]{0,127}$/;

/** A build's status as Google names it. */
export type CloudBuildStatus =
    'STATUS_UNKNOWN' | 'PENDING' | 'QUEUED' | 'WORKING' | 'SUCCESS' | 'FAILURE' | 'INTERNAL_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'EXPIRED';

const STATUSES: ReadonlySet<string> = new Set<CloudBuildStatus>([
    'PENDING',
    'QUEUED',
    'WORKING',
    'SUCCESS',
    'FAILURE',
    'INTERNAL_ERROR',
    'TIMEOUT',
    'CANCELLED',
    'EXPIRED',
]);

interface CloudBuildStep {
    /** The step's `id` in the definition (`functions`). */
    readonly id: string;
    readonly status: CloudBuildStatus;
    /** ISO 8601, when the step started and ended (absent before). */
    readonly startTime?: string;
    readonly endTime?: string;
}

export interface CloudBuild {
    readonly id: string;
    readonly status: CloudBuildStatus;
    readonly createTime?: string;
    readonly startTime?: string;
    readonly finishTime?: string;
    readonly steps: readonly CloudBuildStep[];
    readonly tags: readonly string[];
    readonly substitutions: Readonly<Record<string, string>>;
}

export interface CloudBuildClient {
    /** Submits `build` in `region`; resolves to the build Google queued (from the operation's metadata). */
    create(projectId: string, region: string, build: JsonObject): Promise<CloudBuild>;
    get(projectId: string, region: string, id: string): Promise<CloudBuild>;
    /** The newest builds carrying `tag` (at most `pageSize`), newest first. */
    listByTag(projectId: string, region: string, tag: string, pageSize?: number): Promise<readonly CloudBuild[]>;
}

function statusOf(value: unknown): CloudBuildStatus {
    return typeof value === 'string' && STATUSES.has(value) ? (value as CloudBuildStatus) : 'STATUS_UNKNOWN';
}

/** `{a, b}` without its undefined entries (`exactOptionalPropertyTypes`). */
function times(source: unknown, fields: readonly string[], ...path: readonly string[]): Record<string, string> {
    return Object.fromEntries(
        fields
            .map((field) => [field, stringAt(source, ...path, field)])
            .filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
}

function stepOf(step: JsonObject): CloudBuildStep {
    return {
        id: typeof step['id'] === 'string' ? step['id'] : '',
        status: statusOf(step['status']),
        ...times(step, ['startTime', 'endTime'], 'timing'),
    };
}

function substitutionsOf(value: unknown): Record<string, string> {
    return Object.fromEntries(
        Object.entries(typeof value === 'object' && value !== null ? value : {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
    );
}

/** A build from Google's JSON (anything missing has a safe default). */
export function cloudBuildOf(body: unknown): CloudBuild {
    const id = stringAt(body, 'id') ?? lastSegment(stringAt(body, 'name') ?? '');
    return {
        id,
        status: statusOf(stringAt(body, 'status')),
        ...times(body, ['createTime', 'startTime', 'finishTime']),
        steps: records(at(body, 'steps')).map(stepOf),
        tags: strings(at(body, 'tags')),
        substitutions: substitutionsOf(at(body, 'substitutions')),
    };
}

/** The Google Cloud console's page of a build (made from its id, never read from an answer). */
export function cloudBuildConsoleUrl(projectId: string, region: string, id: string): string {
    const url = new URL(
        `https://console.cloud.google.com/cloud-build/builds;region=${encodeURIComponent(region)}/${encodeURIComponent(id)}`,
    );
    url.searchParams.set('project', projectId);
    return url.toString();
}

export function createCloudBuildClient(transport: GoogleTransport): CloudBuildClient {
    const base = (projectId: string, region: string): string => `${CLOUD_BUILD}/projects/${projectId}/locations/${region}/builds`;
    return {
        create: async (projectId, region, build) => {
            const operation = await transport.call({
                operation: 'cloud-build.builds.create',
                method: 'POST',
                url: base(projectId, region),
                body: build,
                role: 'roles/owner',
            });
            return cloudBuildOf(at(operation, 'metadata', 'build'));
        },
        get: async (projectId, region, id) =>
            cloudBuildOf(
                await transport.call({ operation: 'cloud-build.builds.get', url: `${base(projectId, region)}/${encodeURIComponent(id)}` }),
            ),
        listByTag: async (projectId, region, tag, pageSize = 5) => {
            if (!TAG.test(tag)) {
                throw new RangeError(`not a build tag: ${JSON.stringify(tag)}`);
            }
            const body = await transport.call({
                operation: 'cloud-build.builds.list',
                url: base(projectId, region),
                query: { filter: `tags="${tag}"`, pageSize },
            });
            return records(at(body, 'builds')).map(cloudBuildOf);
        },
    };
}
