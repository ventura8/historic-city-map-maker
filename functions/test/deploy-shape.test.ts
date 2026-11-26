/**
 * The deploy shape (finding 11 of `docs/research/manual-test-2026-10-25.md`, `docs/research/M6-interfaces.md` §3.2): what
 * firebase-tools reads from every export when it deploys, checked the way firebase-tools uses it. Each function names
 * its runtime account as a full e-mail address of the project the code is loaded for, and the Cloud Scheduler job
 * firebase-tools builds for each scheduled function (with its own `jobFromEndpoint`) calls it with that address: the
 * shorthand `fn-admin@` reached Scheduler unexpanded and Google refused both jobs with 400 `INVALID_ARGUMENT`.
 *
 * It loads `src/index.ts` with the environment firebase-tools sets for discovery, as `index.test.ts` does: the tests
 * stage runs before any build, and `functions/dist/index.js` is the same code bundled.
 */
import { createRequire } from 'node:module';

import { BACKGROUND_FUNCTIONS, CALLABLES, HTTP_ENDPOINTS, deployedName } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RUNTIME_ACCOUNTS, type FunctionName } from '../src/global-options.js';

/** What firebase-tools reads from each export (`__endpoint`, firebase-functions' deploy manifest). */
interface Endpoint {
    readonly region?: readonly string[];
    readonly serviceAccountEmail?: string;
    readonly scheduleTrigger?: { readonly schedule?: unknown; readonly timeZone?: unknown };
    readonly eventTrigger?: { readonly eventType?: string };
    readonly taskQueueTrigger?: object;
}

type Groups = Readonly<Record<string, Readonly<Record<string, { readonly __endpoint: Endpoint }>>>>;

/** The Scheduler job firebase-tools 15.33.0 creates (`lib/gcp/cloudscheduler.js`), as far as this test reads it. */
interface SchedulerJob {
    readonly name: string;
    readonly schedule: string;
    readonly httpTarget?: { readonly oidcToken?: { readonly serviceAccountEmail?: string } };
}

type JobFromEndpoint = (endpoint: object, location: string, projectNumber: string) => Promise<SchedulerJob>;

/** firebase-tools' own job builder (the root devDependency; no network: the account is given, so no default is looked up). */
const { jobFromEndpoint } = createRequire(import.meta.url)('firebase-tools/lib/gcp/cloudscheduler.js') as {
    readonly jobFromEndpoint: JobFromEndpoint;
};

const PROJECT = 'demo-hcm';
const REGION = 'us-central1';
const FULL_ACCOUNT = /^(fn-admin|fn-events|fn-crash)@demo-hcm\.iam\.gserviceaccount\.com$/;
const REGISTRY = [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)] as FunctionName[];

let deployed: ReadonlyMap<string, Endpoint>;

beforeAll(async () => {
    // firebase-tools sets both while it loads the code for discovery (in Cloud Build as on a terminal).
    vi.stubEnv('GCLOUD_PROJECT', PROJECT);
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` }));
    const groups = (await import('../src/index.js')) as Groups;
    deployed = new Map(
        Object.entries(groups).flatMap(([group, functions]) =>
            Object.entries(functions).map(([key, fn]): [string, Endpoint] => [`${group}.${key}`, fn.__endpoint]),
        ),
    );
});

afterAll(() => {
    vi.unstubAllEnvs();
});

function endpointOf(name: string): Endpoint {
    const endpoint = deployed.get(name);
    if (endpoint === undefined) {
        throw new Error(`${name} is not exported`);
    }
    return endpoint;
}

function sorted(names: readonly string[]): string[] {
    return names.toSorted((left, right) => left.localeCompare(right));
}

/** The registry's names of one trigger kind. */
function triggeredBy(trigger: (typeof BACKGROUND_FUNCTIONS)[keyof typeof BACKGROUND_FUNCTIONS]['trigger']): string[] {
    return Object.entries(BACKGROUND_FUNCTIONS)
        .filter(([, spec]) => spec.trigger === trigger)
        .map(([name]) => name);
}

/** The backend endpoint firebase-tools builds from a scheduled function's manifest (the fields `jobFromEndpoint` reads). */
function backendEndpoint(name: string, endpoint: Endpoint): object {
    return {
        platform: 'gcfv2',
        id: deployedName(name),
        region: REGION,
        project: PROJECT,
        entryPoint: name,
        runtime: 'nodejs24',
        serviceAccount: endpoint.serviceAccountEmail,
        scheduleTrigger: { schedule: endpoint.scheduleTrigger?.schedule },
    };
}

describe('deploy shape', () => {
    it('happyPath_everyFunctionNamesItsRuntimeAccountInFull @S-A55-HAPPY-SCHEDULER-ACCOUNT', () => {
        const accounts = REGISTRY.map((name) => [name, endpointOf(name).serviceAccountEmail]);

        expect(accounts).toEqual(REGISTRY.map((name) => [name, `${RUNTIME_ACCOUNTS[name]}@${PROJECT}.iam.gserviceaccount.com`]));
        expect(accounts.filter(([, account]) => !FULL_ACCOUNT.test(String(account)))).toEqual([]);
    });

    it('happyPath_theSchedulerJobsFirebaseToolsBuildsCallTheirFunctionsAsTheFullAccount @S-A55-HAPPY-SCHEDULER-ACCOUNT', async () => {
        const scheduled = [...deployed].filter(([, endpoint]) => endpoint.scheduleTrigger !== undefined);
        expect(sorted(scheduled.map(([name]) => name))).toEqual(sorted(triggeredBy('schedule')));
        expect(scheduled.map(([name]) => name)).toEqual(expect.arrayContaining(['ops.tick', 'imagery.tick']));

        const jobs = await Promise.all(scheduled.map(([name, endpoint]) => jobFromEndpoint(backendEndpoint(name, endpoint), REGION, '1')));

        expect(jobs.map((job) => [job.name, job.httpTarget?.oidcToken?.serviceAccountEmail])).toEqual(
            scheduled.map(([name]) => [
                `projects/${PROJECT}/locations/${REGION}/jobs/firebase-schedule-${deployedName(name)}-${REGION}`,
                `${RUNTIME_ACCOUNTS[name as FunctionName]}@${PROJECT}.iam.gserviceaccount.com`,
            ]),
        );
        expect(jobs.map((job) => job.schedule)).toEqual(scheduled.map(([name]) => BACKGROUND_FUNCTIONS[name as 'ops.tick'].source));
    });

    it('happyPath_eventAndTaskQueueFunctionsAreDeliveredWithTheirFullAccount', () => {
        // Eventarc delivers a Firestore, Storage or Pub/Sub event with the function's own account (finding 17), and a task
        // queue's tasks are signed for it: both need the full address and, in the project, `roles/run.invoker`.
        const delivered = [...deployed].filter(
            ([, endpoint]) => endpoint.eventTrigger !== undefined || endpoint.taskQueueTrigger !== undefined,
        );
        const expected = [...triggeredBy('firestore'), ...triggeredBy('storage'), ...triggeredBy('pubsub'), ...triggeredBy('taskQueue')];

        expect(sorted(delivered.map(([name]) => name))).toEqual(sorted(expected));
        expect(delivered.filter(([, endpoint]) => !FULL_ACCOUNT.test(endpoint.serviceAccountEmail ?? ''))).toEqual([]);
    });

    it('badPath_aShorthandAccountWouldReachTheSchedulerJobUnexpanded', async () => {
        // The bug as it was: firebase-tools copies the shorthand into the job, which Cloud Scheduler refuses.
        const job = await jobFromEndpoint(
            backendEndpoint('ops.tick', { ...endpointOf('ops.tick'), serviceAccountEmail: 'fn-admin@' }),
            REGION,
            '1',
        );

        expect(job.httpTarget?.oidcToken?.serviceAccountEmail).toBe('fn-admin@');
        expect(FULL_ACCOUNT.test('fn-admin@')).toBe(false);
    });
});
