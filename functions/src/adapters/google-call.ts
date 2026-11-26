/**
 * One Google REST call (Secret Manager, Firebase Management, Resource Manager) with a bearer token: the service
 * account's from `TokenProvider`, or the caller's own for `admin.claim`. A failed answer becomes a
 * {@link GoogleApiError}, which names the API when Google says it is disabled in the project (`SERVICE_DISABLED`), so a
 * handler can answer `apiError.cloud.apiDisabled` with `{api}` instead of a permission problem.
 */
import { UpstreamError, type UpstreamErrorDetails, type UpstreamFailure, type UpstreamService } from '../ports/errors.js';
import { at, errorDetails, failureOfStatus, list, readJson, send, stringAt, type Fetch } from './upstream-http.js';

/**
 * A Google API failure. `api` (`firebase.googleapis.com`, ...) is set for `SERVICE_DISABLED`; handlers read it as the
 * `api` of the `UpstreamError` they caught (docs/research/M2-interfaces.md §4.1, CR-M2-11). M6 (finding 20): Google's
 * `error.status` and the first `ErrorInfo` reason travel as `googleStatus` and `reason`, so a check can log and name them.
 */
export class GoogleApiError extends UpstreamError {
    constructor(service: UpstreamService, failure: UpstreamFailure, details: UpstreamErrorDetails, api: string | undefined) {
        super(service, failure, api === undefined ? details : { ...details, api });
        this.name = 'GoogleApiError';
    }
}

/** A name Google's error may carry that is safe to log (`NOT_FOUND`, `SERVICE_DISABLED`); anything else is dropped. */
const GOOGLE_NAME = /^[A-Z_]{1,64}$/;

function googleName(value: string | undefined): string | undefined {
    return value !== undefined && GOOGLE_NAME.test(value) ? value : undefined;
}

/** The API a `SERVICE_DISABLED` error names (`error.details[].metadata.service` of `google.rpc.ErrorInfo`). */
function disabledApi(body: unknown): string | undefined {
    const info = list(at(body, 'error', 'details')).find((detail) => at(detail, 'reason') === 'SERVICE_DISABLED');
    return stringAt(info, 'metadata', 'service');
}

/** The first `google.rpc.ErrorInfo` reason of the error's details. */
function firstReason(body: unknown): string | undefined {
    const info = list(at(body, 'error', 'details')).find((detail) => typeof at(detail, 'reason') === 'string');
    return googleName(stringAt(info, 'reason'));
}

/** The status, the `Retry-After` hint and Google's own names of a failed answer, those that are present. */
function googleDetails(response: Response, body: unknown): UpstreamErrorDetails {
    const googleStatus = googleName(stringAt(body, 'error', 'status'));
    const reason = firstReason(body);
    return {
        ...errorDetails(response),
        ...(googleStatus === undefined ? {} : { googleStatus }),
        ...(reason === undefined ? {} : { reason }),
    };
}

/** The error for a failed Google answer (the body is read only for the names above, never kept). */
export async function googleError(
    service: UpstreamService,
    response: Response,
    failure: UpstreamFailure = failureOfStatus(response.status),
): Promise<GoogleApiError> {
    const body = await readJson(response);
    return new GoogleApiError(service, failure, googleDetails(response, body), disabledApi(body));
}

interface GoogleRequest {
    readonly method: 'GET' | 'POST';
    readonly accessToken: string;
    /** Sent as JSON. */
    readonly body?: unknown;
}

/** Sends one authorized request and returns the answer as it is (the caller decides which statuses are failures). */
export function googleSend(fetchFn: Fetch, service: UpstreamService, url: string, request: GoogleRequest): Promise<Response> {
    const headers = { authorization: `Bearer ${request.accessToken}`, 'content-type': 'application/json' };
    const body = request.body === undefined ? {} : { body: JSON.stringify(request.body) };
    return send(fetchFn, service, url, { method: request.method, headers, ...body });
}

/** One authorized request whose answer must be a 2xx; resolves to its JSON body (undefined when it has none). */
export async function googleJson(fetchFn: Fetch, service: UpstreamService, url: string, request: GoogleRequest): Promise<unknown> {
    const response = await googleSend(fetchFn, service, url, request);
    if (!response.ok) {
        throw await googleError(service, response);
    }
    return readJson(response);
}
