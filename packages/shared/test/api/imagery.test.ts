import { describe, expect, it } from 'vitest';

import {
    CLOUD_RUN_JOBS,
    JOB_MAX_ATTEMPTS,
    NOT_RETRYABLE_CODES,
    PUBLISH_MAX_ATTEMPTS,
    imageryChooseRequestSchema,
    imageryProbeRequestSchema,
    imagerySaveGcpsRequestSchema,
    imagerySearchRequestSchema,
    jobRetryable,
    publishTaskSchema,
    rasterUploadMetadataSchema,
    retryCures,
    runsLocally,
    USGS_BACKOFF_MINUTES,
} from '../../src/api/imagery.js';
import { API_ERRORS } from '../../src/api/errors.js';
import { translateApiError } from '../../src/i18n/api/index.js';
import { validate } from '../../src/schemas/validation.js';

const pair = (id: string, x: number) => ({
    id,
    pixel: { x, y: x },
    geo: { lat: 44.4, lng: 26 + x / 1e5 },
    enabled: true,
    origin: 'manual',
});

describe('imagery requests', () => {
    it('happyPath_aSearchOfOneDatasetAndAWindow', () => {
        expect(
            validate(imagerySearchRequestSchema, { cityId: 'bucharest', datasets: ['corona2'], from: '1960-01-01', to: '1980-12-31' }).ok,
        ).toBe(true);
    });

    it('badPath_aWindowThatEndsBeforeItStarts', () => {
        expect(validate(imagerySearchRequestSchema, { cityId: 'bucharest', from: '1980-01-01', to: '1960-01-01' })).toEqual({
            ok: false,
            issues: [{ path: 'to', code: 'validation.value' }],
        });
    });

    it('happyPath_pointsEnoughForTheirTransform', () => {
        const gcps = [pair('g1', 0), pair('g2', 1000), pair('g3', 2000)];

        expect(validate(imagerySaveGcpsRequestSchema, { cityId: 'bucharest', versionId: 'v1', transform: 'affine', gcps }).ok).toBe(true);
        expect(validate(imagerySaveGcpsRequestSchema, { cityId: 'bucharest', versionId: 'v1', transform: 'tps', gcps })).toEqual({
            ok: false,
            issues: [{ path: 'gcps', code: 'validation.tooSmall' }],
        });
    });

    it('badPath_aChoiceOrAPhaseNobodyKnows', () => {
        expect(imageryChooseRequestSchema.safeParse({ cityId: 'bucharest', versionId: 'v1', choice: 'later' }).success).toBe(false);
        expect(publishTaskSchema.safeParse({ cityId: 'bucharest', jobId: 'j1', phase: 'finish', poll: 0 }).success).toBe(false);
    });

    it('happyPath_aProbeTakesALinkableSource', () => {
        const source = { type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 256 };

        expect(imageryProbeRequestSchema.safeParse({ cityId: 'bucharest', source }).success).toBe(true);
        expect(
            imageryProbeRequestSchema.safeParse({ cityId: 'bucharest', source: { type: 'pmtiles', url: 'https://x.org/a.pmtiles' } })
                .success,
        ).toBe(false);
    });

    it('badPath_uploadMetadataIsStrict', () => {
        expect(rasterUploadMetadataSchema.safeParse({ originalName: 'Plan 1911.tif', year: '1911', layerId: 'plan-1911' }).success).toBe(
            true,
        );
        expect(rasterUploadMetadataSchema.safeParse({ year: '911' }).success).toBe(false);
        expect(rasterUploadMetadataSchema.safeParse({ owner: 'someone' }).success).toBe(false);
    });

    it('happyPath_limitsAndErrorsTheContractNames', () => {
        expect(CLOUD_RUN_JOBS).toEqual({ fetch: 'raster-fetch', std: 'raster-pipeline', xl: 'raster-pipeline-xl' });
        expect(USGS_BACKOFF_MINUTES.at(-1)).toBe(720);
        expect(API_ERRORS['apiError.imagery.dailyLimit']).toEqual({ status: 'resource-exhausted', httpStatus: 429, retryable: true });
        expect(translateApiError('en', 'apiError.imagery.overBudget', { estimate: '24.5', available: '3' })).toBe(
            'Publishing would use 24.5 Mapbox compute units; 3 are left this month.',
        );
    });
});

describe('what a retry can cure (CR-M3-47)', () => {
    const failed = { status: 'failed', type: 'usgs-import', layerId: 'corona-1966' } as const;

    it('happyPath_aRunOrAPublishWithAttemptsLeftIsRetried', () => {
        expect(jobRetryable(failed)).toBe(true);
        expect(jobRetryable({ ...failed, attempt: JOB_MAX_ATTEMPTS - 1, error: { code: 'apiError.internal', message: 'x' } })).toBe(true);
        expect(jobRetryable({ ...failed, type: 'republish' })).toBe(true);
        expect(jobRetryable({ ...failed, steps: { guard: { status: 'done' } }, publishAttempts: PUBLISH_MAX_ATTEMPTS - 1 })).toBe(true);
    });

    it.each([
        ['a job that did not fail', { ...failed, status: 'running' as const }],
        ['a tileset deletion', { ...failed, type: 'layer-delete' as const }],
        ['an upload refused before any version', { ...failed, layerId: undefined }],
        ['a revoked Mapbox token', { ...failed, error: { code: NOT_RETRYABLE_CODES[0], message: 'x' } }],
        ['runs used up', { ...failed, attempt: JOB_MAX_ATTEMPTS }],
        ['publish starts used up', { ...failed, steps: { guard: { status: 'done' as const } }, publishAttempts: PUBLISH_MAX_ATTEMPTS }],
    ])('badPath_noRetry_%s', (_case, job) => {
        expect(jobRetryable(job)).toBe(false);
    });
});

describe("a manual retry of a run on the owner's computer passes the cap (live report of 2026-11-12)", () => {
    const atCap = { status: 'failed', type: 'usgs-import', layerId: 'plan-1911', attempt: JOB_MAX_ATTEMPTS } as const;
    const internal = { code: 'apiError.internal', message: 'record refused' };
    const series = { ...atCap, type: 'archive-series', localOnly: true, runOn: 'local', error: internal } as const;

    it.each([
        ['an archive series failed in place', series],
        ['a frame run on the computer', { ...atCap, runOn: 'local' as const, error: internal }],
        ['an archive series with no place recorded', { ...atCap, type: 'archive-series' as const }],
        ['a local run the dispatcher ended at the cap', { ...series, error: { code: 'apiError.imagery.attemptsExhausted', message: 'x' } }],
    ])('happyPath_tryAgainIsOffered_%s @S-A12-HAPPY-LOCAL-RETRY-PAST-CAP', (_case, job) => {
        expect(runsLocally(job)).toBe(true);
        expect(jobRetryable(job)).toBe(true);
    });

    it.each([
        ['a cloud run at the cap', { ...atCap, runOn: 'cloud' as const, error: internal }],
        ['a run never placed, at the cap', { ...atCap, error: internal }],
        ['a cloud run the dispatcher ended at the cap', { ...atCap, error: { code: 'apiError.imagery.attemptsExhausted', message: 'x' } }],
        ['a local run whose Mapbox token was refused', { ...series, error: { code: 'apiError.mapbox.tokenInvalid', message: 'x' } }],
        ['a dismissed local run', { ...series, cancelRequested: true as const }],
        [
            'a local run whose publish starts are used up',
            { ...series, steps: { guard: { status: 'done' as const } }, publishAttempts: PUBLISH_MAX_ATTEMPTS },
        ],
        [
            'a local run whose publish ran out of starts',
            {
                ...series,
                steps: { guard: { status: 'done' as const } },
                error: { code: 'apiError.imagery.attemptsExhausted', message: 'x' },
            },
        ],
    ])('badPath_noTryAgain_%s @S-A12-BAD-CLOUD-RETRY-AT-CAP', (_case, job) => {
        expect(jobRetryable(job)).toBe(false);
    });

    it('badPath_aLocalPublishsExhaustedStartsAreNoCure', () => {
        const exhausted = { ...series, error: { code: 'apiError.imagery.attemptsExhausted', message: 'x' } };
        expect(retryCures(exhausted, false)).toBe(true);
        expect(retryCures(exhausted, true)).toBe(false);
        expect(retryCures({ type: 'usgs-import', error: exhausted.error }, false)).toBe(false);
    });
});
