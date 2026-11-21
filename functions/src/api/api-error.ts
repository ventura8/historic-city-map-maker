import { API_ERRORS, apiErrorDetails, type ApiErrorCode, type Logger, type ValidationIssue } from '@hcm/shared';
import { HttpsError } from 'firebase-functions/https';

import { InvalidDocumentError, UpstreamError, type UpstreamFailure } from '../ports/errors.js';

/**
 * A failure the caller is meant to see: one of the API error codes (`@hcm/shared` → `API_ERRORS`), with the
 * parameters of its message and, for `apiError.invalidRequest`, the field issues. Never carries a secret: params are
 * shown to the admin and logged.
 */
export class ApiError extends Error {
    readonly code: ApiErrorCode;
    readonly params: Readonly<Record<string, string>> | undefined;
    readonly issues: readonly ValidationIssue[] | undefined;

    constructor(code: ApiErrorCode, params?: Readonly<Record<string, string>>, issues?: readonly ValidationIssue[]) {
        super(code);
        this.name = 'ApiError';
        this.code = code;
        this.params = params;
        this.issues = issues;
    }
}

/**
 * The code an `UpstreamError` a handler did not map itself becomes. Handlers map the failures they expect to their
 * specific codes (`apiError.mapbox.tokenInvalid`, `apiError.usgs.maintenance`, ...); this is only the fallback.
 */
const UPSTREAM_FALLBACK: Readonly<Record<UpstreamFailure, ApiErrorCode>> = {
    unauthorized: 'apiError.internal',
    forbidden: 'apiError.internal',
    notFound: 'apiError.notFound',
    conflict: 'apiError.conflict',
    rateLimited: 'apiError.rateLimited',
    maintenance: 'apiError.unavailable',
    unavailable: 'apiError.unavailable',
    invalid: 'apiError.internal',
};

function asApiError(error: unknown): ApiError {
    if (error instanceof ApiError) {
        return error;
    }
    return new ApiError(error instanceof UpstreamError ? UPSTREAM_FALLBACK[error.failure] : 'apiError.internal');
}

/** What the log says about an unexpected failure: its class and message (adapters never put secrets in messages). */
function describeFailure(error: unknown): Readonly<Record<string, unknown>> {
    if (error instanceof InvalidDocumentError) {
        return { error: error.name, path: error.path, issues: error.issues.length };
    }
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : 'non-error value thrown' };
}

/**
 * The `HttpsError` a callable rejects with: `new HttpsError(API_ERRORS[code].status, code, details)`, where `details`
 * validates with `apiErrorDetailsSchema` (the admin reads it with `apiErrorFromFailure`). An `HttpsError` passes
 * through unchanged; anything that is not an `ApiError` is logged once, here.
 */
export function toHttpsError(error: unknown, log: Logger): HttpsError {
    if (error instanceof HttpsError) {
        return error;
    }
    const apiError = asApiError(error);
    if (apiError !== error) {
        log.error('callable failed', { code: apiError.code, ...describeFailure(error) });
    }
    return new HttpsError(
        API_ERRORS[apiError.code].status,
        apiError.code,
        apiErrorDetails(apiError.code, apiError.params, apiError.issues),
    );
}
