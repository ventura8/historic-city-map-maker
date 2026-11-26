/** How the `setup.*` handlers map outside failures to error codes (M2-interfaces §4.1). */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { MappedUpstreamError, TRANSIENT, failureRecord, mapFailure, refusal, upstreamFields } from '../../src/setup/failures.js';

describe('mapFailure', () => {
    it('happyPath_anExpectedFailureBecomesItsCodeAndKeepsWhatTheServiceAnswered', () => {
        const upstream = new UpstreamError('usgs', 'maintenance');

        const mapped = mapFailure(upstream, TRANSIENT);

        expect(mapped).toBeInstanceOf(MappedUpstreamError);
        expect(mapped).toBeInstanceOf(ApiError);
        expect(mapped).toMatchObject({ code: 'apiError.unavailable', upstream });
    });

    it.each([
        ['an unexpected failure', new UpstreamError('usgs', 'conflict')],
        ['an error that is not an upstream failure', new Error('boom')],
    ])('badPath_%s_passesThrough', (_label, error) => {
        expect(mapFailure(error, TRANSIENT)).toBe(error);
    });
});

describe('failureRecord', () => {
    it.each([
        [
            new ApiError('apiError.mapbox.missingScopes', { scopes: 'tokens:read' }),
            { state: 'invalid', detail: 'apiError.mapbox.missingScopes', params: { scopes: 'tokens:read' } },
        ],
        [new ApiError('apiError.usgs.maintenance'), { state: 'unavailable', detail: 'apiError.usgs.maintenance' }],
        [new Error('boom'), { state: 'unavailable', detail: 'apiError.internal' }],
    ])('happyPath_recordsTheReason_%#', (error, record) => {
        expect(failureRecord(error)).toEqual(record);
    });
});

describe('refusal (M6, finding 20)', () => {
    it.each([
        [
            new UpstreamError('vertex-ai', 'invalid', { status: 400, googleStatus: 'INVALID_ARGUMENT', reason: 'MODEL_CONFIG' }),
            'MODEL_CONFIG',
        ],
        [new UpstreamError('vertex-ai', 'conflict', { status: 409, googleStatus: 'ABORTED' }), 'ABORTED'],
        [new UpstreamError('vertex-ai', 'unauthorized', { status: 401 }), 'HTTP 401'],
        [new UpstreamError('vertex-ai', 'invalid'), 'invalid'],
    ])('badPath_%s_isGooglesRefusalWithItsReason', (error, reason) => {
        expect(refusal(error, 'aiplatform.googleapis.com')).toMatchObject({
            code: 'apiError.cloud.refused',
            params: { api: 'aiplatform.googleapis.com', reason },
            upstream: error,
        });
    });

    it('happyPath_anythingThatIsNotAnUpstreamFailurePassesThrough', () => {
        const mapped = new ApiError('apiError.assist.modelUnavailable', { model: 'm' });

        expect(refusal(mapped, 'aiplatform.googleapis.com')).toBe(mapped);
    });
});

describe('upstreamFields (M6, finding 20)', () => {
    it('happyPath_aMappedOrRawUpstreamFailureNamesWhatTheServiceAnswered', () => {
        const upstream = new UpstreamError('vertex-ai', 'notFound', { status: 404, googleStatus: 'NOT_FOUND', reason: 'MODEL_GONE' });
        const fields = { service: 'vertex-ai', failure: 'notFound', status: 404, googleStatus: 'NOT_FOUND', reason: 'MODEL_GONE' };

        expect(upstreamFields(new MappedUpstreamError('apiError.notFound', undefined, upstream))).toEqual(fields);
        expect(upstreamFields(upstream)).toEqual(fields);
        expect(upstreamFields(new UpstreamError('usgs', 'maintenance'))).toEqual({ service: 'usgs', failure: 'maintenance' });
    });

    it('badPath_anyOtherErrorNamesNothing', () => {
        expect(upstreamFields(new ApiError('apiError.internal'))).toEqual({});
        expect(upstreamFields(new Error('boom'))).toEqual({});
    });
});
