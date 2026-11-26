import { describe, expect, it } from 'vitest';

import { CLOUD_RUN_ESTIMATE_SECONDS, CLOUD_RUN_FREE_TIER, JOB_MACHINE_SIZES, imageryRunOnRequestSchema } from '../../src/api/worker.js';
import { workerStepRequestSchema, workerUrlsRequestSchema } from '../../src/api/worker-calls.js';
import { cloudRunUsageDocSchema, runChoiceDocSchema, workerDocSchema } from '../../src/schemas/worker.js';
import { FIRESTORE_PATHS } from '../../src/schemas/paths.js';

const AT = { seconds: 1_793_000_000, nanoseconds: 0 };
const STAMP = { updatedAt: AT, updatedBy: 'system:imagery' };
const JOB = { cityId: 'bucharest', workerId: 'w-0123456789abcdef', jobId: 'job-1' };

describe('imagery.runOn (docs/research/M7-local-worker.md §3)', () => {
    it('happyPath_aCityChoiceMayBeAutoAndAJobsPlaceIsLocalOrCloud', () => {
        expect(imageryRunOnRequestSchema.safeParse({ cityId: 'bucharest', runOn: 'auto' }).success).toBe(true);
        expect(imageryRunOnRequestSchema.safeParse({ cityId: 'bucharest', jobId: 'job-1', runOn: 'local' }).success).toBe(true);
        expect(imageryRunOnRequestSchema.safeParse({ cityId: 'bucharest', jobId: 'job-1', runOn: 'cloud', freeTierOk: true }).success).toBe(
            true,
        );
    });

    it('badPath_aJobIsNeverSentToAuto', () => {
        const parsed = imageryRunOnRequestSchema.safeParse({ cityId: 'bucharest', jobId: 'job-1', runOn: 'auto' });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]).toMatchObject({ message: 'validation.format', path: ['runOn'] });
    });
});

describe('the worker callables (§2.4)', () => {
    it('happyPath_aStepCarriesOneDocumentOperation', () => {
        const update = {
            op: 'update',
            path: 'cities/bucharest/jobs/job-1',
            fields: { progress: 0.5 },
            ifUpdateTime: '1793000000.000000001',
        };

        expect(workerStepRequestSchema.safeParse({ ...JOB, request: update }).success).toBe(true);
        expect(
            workerStepRequestSchema.safeParse({ ...JOB, request: { op: 'list', collection: 'cities/bucharest/jobs/job-1/logs' } }).success,
        ).toBe(true);
    });

    it('badPath_aWorkerIdAPathOrAnObjectOutsideTheShapeIsRefused', () => {
        expect(
            workerStepRequestSchema.safeParse({ ...JOB, workerId: 'w-1', request: { op: 'get', path: 'cities/bucharest' } }).success,
        ).toBe(false);
        expect(workerStepRequestSchema.safeParse({ ...JOB, request: { op: 'get', path: '../cities' } }).success).toBe(false);
        const climbing = { kind: 'objects', objects: [{ path: 'rasters/bucharest/../usgs-raw/x.tgz', method: 'GET' }] };
        expect(workerUrlsRequestSchema.safeParse({ ...JOB, request: climbing }).success).toBe(false);
        const many = { kind: 'objects', objects: Array.from({ length: 21 }, () => ({ path: 'rasters/a/b/c/cog.tif', method: 'GET' })) };
        expect(workerUrlsRequestSchema.safeParse({ ...JOB, request: many }).success).toBe(false);
        expect(workerUrlsRequestSchema.safeParse({ ...JOB, request: { kind: 'usgs', endpoint: 'login-token', payload: {} } }).success).toBe(
            false,
        );
    });
});

describe('the local AI on a worker (docs/research/M10-local-ai.md)', () => {
    const worker = { uid: 'owner-uid', version: '0.7.0', startedAt: AT, lastSeenAt: AT, state: 'idle', ...STAMP };

    it('happyPath_aDeviceOrAReasonValidates @S-A68-HAPPY-DEVICE-SHOWN', () => {
        for (const ai of [
            { state: 'idle' },
            { state: 'ready', device: 'gpu', deviceName: 'NVIDIA RTX 3080' },
            { state: 'unavailable', why: 'old-starter' },
        ]) {
            expect(workerDocSchema.safeParse({ ...worker, ai }).success).toBe(true);
        }
    });

    it('badPath_anUnknownStateDeviceOrReasonIsRefused @S-A68-BAD-AI-UNAVAILABLE', () => {
        for (const ai of [
            { state: 'asleep' },
            { state: 'ready', device: 'tpu' },
            { state: 'unavailable', why: 'because' },
            { state: 'idle', more: 1 },
        ]) {
            expect(workerDocSchema.safeParse({ ...worker, ai }).success).toBe(false);
        }
    });
});

describe('the M7 documents (§8)', () => {
    it('happyPath_aWorkerItsCitysChoiceAndTheMonthsUseValidate', () => {
        const worker = { uid: 'owner-uid', version: '0.7.0', startedAt: AT, lastSeenAt: AT, state: 'busy', jobId: 'job-1', ...STAMP };

        expect(workerDocSchema.safeParse(worker).success).toBe(true);
        expect(runChoiceDocSchema.safeParse({ choice: 'local', ...STAMP }).success).toBe(true);
        expect(
            cloudRunUsageDocSchema.safeParse({ month: '2026-11', vcpuSeconds: 4000, gibSeconds: 16_000, runs: 1, ...STAMP }).success,
        ).toBe(true);
        expect(FIRESTORE_PATHS.runChoice('bucharest')).toBe('cities/bucharest/workers/choice');
        expect(FIRESTORE_PATHS.worker('bucharest', 'w-0123456789abcdef')).toBe('cities/bucharest/workers/w-0123456789abcdef');
        expect(FIRESTORE_PATHS.cloudRunUsage('2026-11')).toBe('usage/cloudrun-2026-11');
    });

    it('badPath_anUnknownChoiceOrANegativeUseIsRefused', () => {
        expect(runChoiceDocSchema.safeParse({ choice: 'somewhere', ...STAMP }).success).toBe(false);
        expect(cloudRunUsageDocSchema.safeParse({ month: '2026-11', vcpuSeconds: -1, gibSeconds: 0, runs: 0, ...STAMP }).success).toBe(
            false,
        );
        expect(() => FIRESTORE_PATHS.cloudRunUsage('2026-13')).toThrow();
    });

    it('happyPath_theEstimateCoversEveryMachine', () => {
        expect(Object.keys(CLOUD_RUN_ESTIMATE_SECONDS)).toEqual(Object.keys(JOB_MACHINE_SIZES));
    });

    it('happyPath_aProcessingRunFitsTheFreeTierSixteenTimesAMonth', () => {
        // 2026-11-12 (reports/resource-audit.md item 7): `std` 2 vCPU / 8 GiB, `xl` 4 / 16; a `std` phase of 2,700 s takes 21,600
        // GiB-seconds, so 16 of them fit in the month's 360,000, where 4 / 16 fitted 8.
        expect(JOB_MACHINE_SIZES).toEqual({ fetch: { vcpu: 1, gib: 4 }, std: { vcpu: 2, gib: 8 }, xl: { vcpu: 4, gib: 16 } });
        const std = JOB_MACHINE_SIZES.std;
        const runs = Math.min(
            CLOUD_RUN_FREE_TIER.vcpuSeconds / (std.vcpu * CLOUD_RUN_ESTIMATE_SECONDS.std),
            CLOUD_RUN_FREE_TIER.gibSeconds / (std.gib * CLOUD_RUN_ESTIMATE_SECONDS.std),
        );
        expect(Math.floor(runs)).toBe(16);
    });

    it('badPath_noProcessingMachineIsLargerThanItsReviewedCeiling', () => {
        // A larger default silently halves the free runs again: each machine stays at its reviewed ceiling, `xl` above `std`.
        expect(JOB_MACHINE_SIZES.std.gib).toBeLessThanOrEqual(8);
        expect(JOB_MACHINE_SIZES.xl.gib).toBeLessThanOrEqual(16);
        expect(JOB_MACHINE_SIZES.xl.gib).toBeGreaterThan(JOB_MACHINE_SIZES.std.gib);
    });
});
