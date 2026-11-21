import type { ValidationIssue } from '@hcm/shared';

/** The outside services the adapters talk to (the `service` of an {@link UpstreamError}). */
export type UpstreamService =
    | 'mapbox'
    | 'usgs'
    | 'google-oauth'
    | 'resource-manager'
    | 'firebase-management'
    | 'error-reporting'
    | 'secret-manager'
    | 'cloud-tasks'
    | 'cloud-storage'
    | 'firestore'
    | 'firebase-auth'
    /** The image processor (sharp): bytes it cannot read (CR-M2-23). */
    | 'image'
    /** M3: Cloud Run Admin (the pipeline's executions). */
    | 'cloud-run'
    /** M3: an outside address from data (`RemoteFiles`: a browse image, a probed tile). */
    | 'remote'
    /** M4: OpenStreetMap's Nominatim (`Geocoder`), Vertex AI Gemini (`Translator`), FCM web push (`PushSender`). */
    | 'nominatim'
    | 'vertex-ai'
    | 'fcm';

/**
 * How an outside call failed, as far as a handler needs to know (docs/research/M2-interfaces.md §4.1):
 * - `unauthorized`: the credential is invalid, expired or revoked (HTTP 401, USGS HTML 403, Mapbox `TokenInvalid`);
 * - `forbidden`: the credential is fine but lacks a permission or scope (HTTP 403 with JSON);
 * - `notFound`, `conflict` (it already exists, or a precondition such as `ifGenerationMatch` failed);
 * - `rateLimited` (429, USGS `RATE_LIMIT`), `maintenance` (USGS HTML 503), `unavailable` (other 5xx, network);
 * - `invalid`: the service refused the request's content (400, 422) or answered something unreadable.
 */
export type UpstreamFailure =
    'unauthorized' | 'forbidden' | 'notFound' | 'conflict' | 'rateLimited' | 'maintenance' | 'unavailable' | 'invalid';

/** What an adapter knows of a failed answer besides its failure. */
export interface UpstreamErrorDetails {
    readonly status?: number;
    readonly retryAfterSeconds?: number;
    readonly api?: string;
    readonly googleStatus?: string;
    readonly reason?: string;
}

/**
 * What every adapter throws for a failed outside call; handlers map it to an `ApiErrorCode`. The message names the
 * service, the operation and the status, never a credential, a signed URL or a response body.
 */
export class UpstreamError extends Error {
    readonly service: UpstreamService;
    readonly failure: UpstreamFailure;
    readonly status: number | undefined;
    /** From `Retry-After` (or the service's own backoff hint), in seconds. */
    readonly retryAfterSeconds: number | undefined;
    /** The Google API a `forbidden` answer says is disabled (`SERVICE_DISABLED`, e.g. `firebase.googleapis.com`; CR-M2-11). */
    readonly api: string | undefined;
    /**
     * M6 (finding 20, `docs/research/M6-interfaces.md` §3.2): Google's `error.status` (`NOT_FOUND`, `INVALID_ARGUMENT`) and
     * the first `google.rpc.ErrorInfo` reason (`SERVICE_DISABLED`, `IAM_PERMISSION_DENIED`), each `[A-Z_]{1,64}` or absent:
     * names a log line may carry, never Google's free-text message.
     */
    readonly googleStatus: string | undefined;
    readonly reason: string | undefined;

    constructor(service: UpstreamService, failure: UpstreamFailure, details: UpstreamErrorDetails = {}) {
        const status = details.status === undefined ? '' : ` (HTTP ${String(details.status)})`;
        super(`${service} call failed: ${failure}${status}`);
        this.name = 'UpstreamError';
        this.service = service;
        this.failure = failure;
        this.status = details.status;
        this.retryAfterSeconds = details.retryAfterSeconds;
        this.api = details.api;
        this.googleStatus = details.googleStatus;
        this.reason = details.reason;
    }
}

/** A stored document that no longer passes its schema: never used, reported with its issues. */
export class InvalidDocumentError extends Error {
    readonly path: string;
    readonly issues: readonly ValidationIssue[];

    constructor(path: string, issues: readonly ValidationIssue[]) {
        super(`${path} is not a valid document (${String(issues.length)} issues)`);
        this.name = 'InvalidDocumentError';
        this.path = path;
        this.issues = issues;
    }
}
