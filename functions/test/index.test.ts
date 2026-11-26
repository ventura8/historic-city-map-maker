import { BACKGROUND_FUNCTIONS, CALLABLES, HTTP_ENDPOINTS, deployedName } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RUNTIME_ACCOUNTS, type FunctionName } from '../src/global-options.js';

/** What firebase-tools reads from each export when it discovers the functions to deploy. */
interface Endpoint {
    readonly region?: readonly string[];
    readonly maxInstances?: number;
    readonly serviceAccountEmail?: string;
    readonly eventTrigger?: { readonly eventFilters?: Readonly<Record<string, unknown>> };
}

type Groups = Readonly<Record<string, Readonly<Record<string, { readonly __endpoint: Endpoint }>>>>;

/**
 * The bucket every functions test that loads `src/index.ts` puts in `FIREBASE_CONFIG` (`deploy-shape.test.ts`,
 * `photos/on-upload.test.ts`, `imagery/upload.test.ts`): the shared module graph evaluates `index.ts` once, and
 * firebase-functions caches the first configuration it reads, so a different value here depended on the files' order
 * (lesson 290). It still differs from the fallback `<project>.appspot.com` that `GCLOUD_PROJECT` alone gives.
 */
const BUCKET = 'demo-hcm.firebasestorage.app';

let deployed: Map<string, Endpoint>;

beforeAll(async () => {
    // firebase-tools sets both while it loads the code; `photos.onUpload` resolves its bucket from them.
    vi.stubEnv('GCLOUD_PROJECT', 'demo-hcm');
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-hcm', storageBucket: BUCKET }));
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

const REGISTRY = [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)] as FunctionName[];

function endpointOf(name: string): Endpoint {
    const endpoint = deployed.get(name);
    if (endpoint === undefined) {
        throw new Error(`${name} is not exported`);
    }
    return endpoint;
}

describe('deployed functions', () => {
    it('happyPath_exportsExactlyTheRegistryUnderItsDeployedNames', () => {
        const names = [...deployed.keys()].map((name) => deployedName(name)).sort((a, b) => a.localeCompare(b));

        expect(names).toEqual(REGISTRY.map((name) => deployedName(name)).sort((a, b) => a.localeCompare(b)));
    });

    it('happyPath_everyFunctionRunsInUsCentral1AsItsOwnServiceAccount', () => {
        const placed = REGISTRY.map((name) => [name, endpointOf(name).region, endpointOf(name).serviceAccountEmail]);

        expect(placed).toEqual(
            REGISTRY.map((name) => [name, ['us-central1'], `${RUNTIME_ACCOUNTS[name]}@demo-hcm.iam.gserviceaccount.com`]),
        );
    });

    it('happyPath_callablesAndTheCrashEndpointKeepTheirRegistryInstanceCaps', () => {
        const caps = Object.entries({ ...CALLABLES, ...HTTP_ENDPOINTS }).map(([name, spec]) => [name, spec.maxInstances]);

        expect(caps.map(([name]) => [name, endpointOf(String(name)).maxInstances])).toEqual(caps);
    });

    it('badPath_noFunctionScalesPastFiveInstances', () => {
        const uncapped = REGISTRY.filter((name) => (endpointOf(name).maxInstances ?? Number.POSITIVE_INFINITY) > 5);

        expect(uncapped).toEqual([]);
    });

    it('happyPath_photoUploadsAreWatchedOnTheProjectsDefaultBucket', () => {
        expect(endpointOf('photos.onUpload').eventTrigger?.eventFilters).toEqual({ bucket: BUCKET });
    });

    it('happyPath_rasterUploadsAreWatchedOnTheSameBucket', () => {
        expect(endpointOf('imagery.onRasterUpload').eventTrigger?.eventFilters).toEqual({ bucket: BUCKET });
    });
});
