import { API_ERRORS, VERTEX_DRAFTS_ROLE_ID, type ApiErrorCode } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { ModelsNotOfferedError } from '../api/vertex-models.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';

/**
 * How the `setup.*` handlers turn an outside failure into what the admin sees (M2-interfaces §4.1): each call maps the
 * failures it expects to a specific error code with the parameters its message needs; an unmapped one is left to the
 * plumbing's fallback (`toHttpsError`). `setup/status` keeps the same code as an area's `detail`.
 */
type Params = Readonly<Record<string, string>>;

/** The error code (and its message parameters) each expected failure becomes. */
export type FailureMap = Readonly<Partial<Record<UpstreamFailure, readonly [ApiErrorCode, Params?]>>>;

/**
 * The `ApiError` an upstream failure was mapped to, keeping that failure so a log line can say what the service
 * answered (M6, finding 20: the self-test logged only the code and lost Google's status and reason).
 */
export class MappedUpstreamError extends ApiError {
    readonly upstream: UpstreamError;

    constructor(code: ApiErrorCode, params: Params | undefined, upstream: UpstreamError) {
        super(code, params);
        this.upstream = upstream;
    }
}

/** `error` as the `ApiError` its failure maps to, or unchanged. */
export function mapFailure(error: unknown, map: FailureMap): unknown {
    if (!(error instanceof UpstreamError)) {
        return error;
    }
    const mapped = map[error.failure];
    return mapped === undefined ? error : new MappedUpstreamError(mapped[0], mapped[1], error);
}

/** Awaits `work`, mapping its upstream failure (anything else passes through). */
export async function upstream<T>(work: Promise<T>, map: FailureMap): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw mapFailure(error, map);
    }
}

/** Awaits a Google API call of the runtime service account (see {@link cloudFailure}). */
export async function viaCloud<T>(work: Promise<T>, role: string, transient: FailureMap): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw cloudFailure(error, role, transient);
    }
}

/** The roles the runtime service account needs (security review §1.1, M2-interfaces §4.3), named in `cloud.permission`. */
export const ROLES = {
    firebaseViewer: 'roles/firebase.viewer',
    errorReportingViewer: 'roles/errorreporting.viewer',
    storageObjectAdmin: 'roles/storage.objectAdmin',
    cloudTasksEnqueuer: 'roles/cloudtasks.enqueuer',
    datastoreUser: 'roles/datastore.user',
    /**
     * M4: Vertex AI Gemini for the translation drafts (`docs/research/M4-interfaces.md` §4.4): the project's custom role
     * Provision makes (`generateContent` and `countTokens` only), not `roles/aiplatform.user` (DECISIONS §57g).
     */
    vertexDrafts: VERTEX_DRAFTS_ROLE_ID,
} as const;

/** Failures that clear up by themselves: the area reads `unavailable` and is checked again later. */
export const TRANSIENT: FailureMap = {
    rateLimited: ['apiError.rateLimited'],
    maintenance: ['apiError.unavailable'],
    unavailable: ['apiError.unavailable'],
};

export const MAPBOX_FAILURES: FailureMap = {
    ...TRANSIENT,
    unauthorized: ['apiError.mapbox.tokenInvalid'],
    maintenance: ['apiError.mapbox.unavailable'],
    unavailable: ['apiError.mapbox.unavailable'],
};

/** Creating or updating a token: a demo account (403) or unconfirmed billing details (422) refuse it. */
export const MINT_FAILURES: FailureMap = {
    ...MAPBOX_FAILURES,
    forbidden: ['apiError.mapbox.mintRefused'],
    invalid: ['apiError.mapbox.mintRefused'],
};

export const SECRET_FAILURES: FailureMap = {
    unauthorized: ['apiError.secrets.unavailable'],
    forbidden: ['apiError.secrets.unavailable'],
    notFound: ['apiError.secrets.unavailable'],
    invalid: ['apiError.secrets.unavailable'],
    ...TRANSIENT,
};

/**
 * A Google API call with the runtime service account: a 403 is the missing `role`, or the disabled API when Google
 * named it (`UpstreamError.api`, CR-M2-11); other failures map as `transient` says.
 */
function cloudFailure(error: unknown, role: string, transient: FailureMap): unknown {
    if (!(error instanceof UpstreamError) || error.failure !== 'forbidden') {
        return mapFailure(error, transient);
    }
    return error.api === undefined
        ? new MappedUpstreamError('apiError.cloud.permission', { role }, error)
        : new MappedUpstreamError('apiError.cloud.apiDisabled', { api: error.api }, error);
}

/** Why Google refused: its `ErrorInfo` reason, else its status, else the HTTP status, else the failure. */
function refusalReason(error: UpstreamError): string {
    const answered = error.status === undefined ? error.failure : `HTTP ${String(error.status)}`;
    return error.reason ?? error.googleStatus ?? answered;
}

/**
 * An upstream failure no map named becomes Google's refusal of `api` with its reason (`apiError.cloud.refused`), never
 * the plumbing's `apiError.internal` (finding 20 of `docs/research/manual-test-2026-10-25.md`); anything else passes.
 */
export function refusal(error: unknown, api: string): unknown {
    return error instanceof UpstreamError
        ? new MappedUpstreamError('apiError.cloud.refused', { api, reason: refusalReason(error) }, error)
        : error;
}

/** What a log line may say about the upstream answer behind a failure: names and the HTTP status, never a body. */
export function upstreamFields(error: unknown): Readonly<Record<string, string | number>> {
    const upstreamError = error instanceof MappedUpstreamError || error instanceof ModelsNotOfferedError ? error.upstream : error;
    if (!(upstreamError instanceof UpstreamError)) {
        return {};
    }
    const fields = {
        service: upstreamError.service,
        failure: upstreamError.failure,
        status: upstreamError.status,
        googleStatus: upstreamError.googleStatus,
        reason: upstreamError.reason,
    };
    return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
}

/** A failure's code and parameters as a `setup/status` area records them. */
export interface FailureRecord {
    readonly state: 'invalid' | 'unavailable';
    readonly detail: ApiErrorCode;
    readonly params?: Params;
}

/** The record of a failure: `unavailable` when retrying may help, else `invalid`; an unexpected error is `internal`. */
export function failureRecord(error: unknown): FailureRecord {
    const apiError = error instanceof ApiError ? error : new ApiError('apiError.internal');
    const state = API_ERRORS[apiError.code].retryable ? 'unavailable' : 'invalid';
    return apiError.params === undefined ? { state, detail: apiError.code } : { state, detail: apiError.code, params: apiError.params };
}
