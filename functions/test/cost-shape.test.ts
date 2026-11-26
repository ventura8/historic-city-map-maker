/**
 * The cost shape (reports/resource-audit.md §4 and its budget test 5; `docs/research/M7-local-worker.md` §4.6, the reviewed table): what
 * every export asks Google for, read from the deploy manifest firebase-tools reads (`__endpoint`), as `deploy-shape.test.ts` loads it.
 * Nothing keeps an instance warm (no `minInstances`: an idle project is billed nothing), a function's memory is the default 256 MiB
 * unless the table names it, no function asks for more than 1 GiB, every timeout is the table's, and no schedule runs more often than
 * every 15 minutes. A change to any of these is a cost decision: change the table and the document together.
 */
import { BACKGROUND_FUNCTIONS, EXPORT_LIMITS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** What this test reads from each export's deploy manifest. */
interface Endpoint {
    readonly minInstances?: unknown;
    readonly maxInstances?: unknown;
    readonly availableMemoryMb?: unknown;
    readonly timeoutSeconds?: unknown;
    readonly cpu?: unknown;
    readonly scheduleTrigger?: { readonly schedule?: unknown };
}

type Groups = Readonly<Record<string, Readonly<Record<string, { readonly __endpoint: Endpoint }>>>>;

/** The reviewed memory of the functions that do not run at the default 256 MiB (2026-11-12). */
const MEMORY_MB: Readonly<Record<string, number>> = {
    // One decode of a photo of up to 200 MP: 321 MB at the peak, measured (2 GiB until 2026-11-12).
    'photos.onUpload': 1024,
    // A city's static export zips its files in memory, under 2 GiB.
    'export.build': 1024,
    // Both upload paths stream the COG from the bucket (1 GiB until 2026-11-12).
    'imagery.publish': 512,
    // Every city's jobs, layers and the harvest's answers in one run.
    'imagery.tick': 512,
    // A city's manifest is built in memory.
    'publish.buildManifest': 512,
    // `imagery.markScene` rewrites the date plan after each mark (259 MiB used on 256 MiB; Crashes, 2026-11-20).
    'imagery.markScene': 512,
    // `imagery.browse` makes the browse copy of a scan; two at a time ran out of 256 MiB (2026-11-23).
    'imagery.browse': 512,
};

/** The reviewed timeouts that are not the default 60 s. */
const TIMEOUT_SECONDS: Readonly<Record<string, number>> = {
    'photos.onUpload': 300,
    'export.build': EXPORT_LIMITS.buildMinutes * 60,
    'imagery.publish': 1800,
    'imagery.tick': 540,
    'ops.tick': 540,
    // Wikipedia keeps every article: a large city's manifest takes longer than 300 s (d6906378).
    'publish.buildManifest': 540,
    'assist.geocode': 60,
    'imagery.onRasterUpload': 120,
    'imagery.search': 540,
};

/** The largest memory a function may ask for, and the longest any schedule waits between runs (minutes) at the least. */
const MEMORY_CEILING_MB = 1024;
const SCHEDULE = /^every (\d+) minutes$/;
const LEAST_MINUTES = 15;

let deployed: ReadonlyMap<string, Endpoint>;

beforeAll(async () => {
    vi.stubEnv('GCLOUD_PROJECT', 'demo-hcm');
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-hcm', storageBucket: 'demo-hcm.firebasestorage.app' }));
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

function where(test: (endpoint: Endpoint) => boolean): string[] {
    return [...deployed]
        .filter(([, endpoint]) => test(endpoint))
        .map(([name]) => name)
        .toSorted((left, right) => left.localeCompare(right));
}

/** A value the manifest sets: a number (firebase-functions marks an unset option with a `ResetValue` object). */
function setOf(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

describe('cost shape', () => {
    it('happyPath_nothingIsWarmWhileIdleAndEveryFunctionIsCapped', () => {
        expect(deployed.size).toBeGreaterThan(60);
        expect(where((endpoint) => (setOf(endpoint.minInstances) ?? 0) > 0)).toEqual([]);
        expect(where((endpoint) => ['number', 'string'].includes(typeof endpoint.cpu))).toEqual([]);
        expect(where((endpoint) => (setOf(endpoint.maxInstances) ?? 0) > 5)).toEqual([]);
    });

    it('happyPath_memoryAndTimeoutsAreTheReviewedTable', () => {
        const memory = Object.fromEntries(
            where((endpoint) => setOf(endpoint.availableMemoryMb) !== undefined).map((name) => [
                name,
                setOf(deployed.get(name)?.availableMemoryMb),
            ]),
        );
        const timeouts = Object.fromEntries(
            where((endpoint) => setOf(endpoint.timeoutSeconds) !== undefined).map((name) => [
                name,
                setOf(deployed.get(name)?.timeoutSeconds),
            ]),
        );

        expect(memory).toEqual(MEMORY_MB);
        expect(timeouts).toEqual(TIMEOUT_SECONDS);
    });

    it('badPath_noFunctionAsksForMoreThanAGigabyteOrRunsOnAScheduleUnderFifteenMinutes', () => {
        expect(where((endpoint) => (setOf(endpoint.availableMemoryMb) ?? 0) > MEMORY_CEILING_MB)).toEqual([]);
        const scheduled = [...deployed].filter(([, endpoint]) => endpoint.scheduleTrigger !== undefined);
        const minutes = scheduled.map(([name, endpoint]) => [name, Number(SCHEDULE.exec(String(endpoint.scheduleTrigger?.schedule))?.[1])]);

        expect(scheduled).toHaveLength(Object.values(BACKGROUND_FUNCTIONS).filter((spec) => spec.trigger === 'schedule').length);
        expect(minutes.filter(([, every]) => Number.isNaN(every) || Number(every) < LEAST_MINUTES)).toEqual([]);
    });
});
