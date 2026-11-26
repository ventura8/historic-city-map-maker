import type { AdminSetupKey, AdminShellKey, ApiErrorCode } from '@hcm/shared';

import type { GoogleScope } from './scopes.js';
import { at, list, records, stringAt, type JsonObject } from './json.js';

/**
 * How a Google REST call from the browser failed (`docs/research/M2b-interfaces.md` §3.4), read from Google's error JSON
 * (`error.status`, `google.rpc.ErrorInfo`, `PreconditionFailure`, `QuotaFailure`, and the Cloud Storage JSON API's
 * `error.errors[]`), and the message key the admin shows for it. A failure never holds a URL, a header, a token or
 * Google's free-text message: only the kind, the status and the names the message needs.
 */
export type GoogleFailureKind =
    'unauthorized' | 'forbidden' | 'notFound' | 'conflict' | 'rateLimited' | 'unavailable' | 'invalid' | 'orgPolicy';

export interface GoogleFailure {
    readonly kind: GoogleFailureKind;
    /** The HTTP status; 0 when no answer arrived (network failure, timeout, an operation that never finished). */
    readonly status: number;
    /**
     * Why, when Google says: an `ErrorInfo` reason (`SERVICE_DISABLED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`,
     * `IAM_PERMISSION_DENIED`), the gRPC status of a conflict (`ALREADY_EXISTS`, `ABORTED`), `QUOTA_EXCEEDED` for a
     * `QuotaFailure` and `BILLING_REQUIRED` for Service Usage's billing precondition.
     */
    readonly reason?: string;
    /** The disabled API of a `SERVICE_DISABLED` answer (`secretmanager.googleapis.com`). */
    readonly api?: string;
    /** The permission Google names (`IAM_PERMISSION_DENIED`). */
    readonly permission?: string;
    /** The role the caller declared for the call: what `apiError.cloud.permission` names on a 403. */
    readonly role?: string;
    /** The organisation policy constraint that refused the call, without `constraints/` (`iam.allowedPolicyMemberDomains`). */
    readonly constraint?: string;
    /** From `Retry-After`, in seconds. */
    readonly retryAfterSeconds?: number;
    /**
     * The host a request to which never left the browser (finding 48 of 2026-11-01: no HTTP answer at all, as when a DNS
     * blocklist, a VPN or a firewall stops it or its CORS preflight fails), unlike a server's own 503.
     */
    readonly host?: string;
}

/**
 * What every Google client throws; `operation` names the call (`cloud-billing.updateBillingInfo`). The failure's fields
 * are also the error's own (`error.kind`, `error.api`, `error.role`, `error.constraint`), so a caller may read either.
 */
export class GoogleApiError extends Error implements GoogleFailure {
    declare readonly kind: GoogleFailureKind;
    declare readonly status: number;
    declare readonly reason?: string;
    declare readonly api?: string;
    declare readonly permission?: string;
    declare readonly role?: string;
    declare readonly constraint?: string;
    declare readonly retryAfterSeconds?: number;
    declare readonly host?: string;
    readonly operation: string;
    readonly failure: GoogleFailure;

    constructor(operation: string, failure: GoogleFailure) {
        super(`${operation} failed: ${failure.kind} (HTTP ${String(failure.status)})`);
        this.name = 'GoogleApiError';
        this.operation = operation;
        this.failure = failure;
        Object.assign(this, failure);
    }
}

/** The failure of `error` when it is a {@link GoogleApiError}, else undefined. */
export function googleFailureOf(error: unknown): GoogleFailure | undefined {
    return error instanceof GoogleApiError ? error.failure : undefined;
}

/** True when `error` is a Google failure of one of `kinds`. */
export function isGoogleFailure(error: unknown, ...kinds: readonly GoogleFailureKind[]): error is GoogleApiError {
    const failure = googleFailureOf(error);
    return failure !== undefined && kinds.includes(failure.kind);
}

const KIND_BY_STATUS: ReadonlyMap<number, GoogleFailureKind> = new Map([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'rateLimited'],
]);

const SERVER_ERROR = 500;

function kindOfStatus(status: number): GoogleFailureKind {
    return KIND_BY_STATUS.get(status) ?? (status >= SERVER_ERROR || status === 0 ? 'unavailable' : 'invalid');
}

const ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo';
const PRECONDITION_FAILURE = 'type.googleapis.com/google.rpc.PreconditionFailure';
const QUOTA_FAILURE = 'type.googleapis.com/google.rpc.QuotaFailure';
const CONSTRAINT = /constraints\/([\w.]+)/;
/** Service Usage's precondition for a billed API on a project without billing. */
const BILLING_PRECONDITION = 'googleapis.com/billing-enabled';

function details(body: unknown, type: string): JsonObject[] {
    return records(at(body, 'error', 'details')).filter((detail) => detail['@type'] === type);
}

/** The organisation policy constraint a refusal names: a `PreconditionFailure` violation or the message itself (Cloud Storage). */
function constraintOf(body: unknown): string | undefined {
    const violation = details(body, PRECONDITION_FAILURE)
        .flatMap((detail) => records(detail['violations']))
        .map((item) => (typeof item['type'] === 'string' ? item['type'] : ''))
        .find((type) => type.startsWith('constraints/'));
    const text = violation ?? stringAt(body, 'error', 'message') ?? '';
    return CONSTRAINT.exec(text)?.[1];
}

function hasBillingPrecondition(body: unknown): boolean {
    return details(body, PRECONDITION_FAILURE).some((detail) =>
        records(detail['violations']).some((item) => item['type'] === BILLING_PRECONDITION),
    );
}

/** The reason of the first `ErrorInfo`, else a quota or billing precondition, else the gRPC status. */
function reasonOf(body: unknown): string | undefined {
    const info = details(body, ERROR_INFO)[0];
    if (info !== undefined && typeof info['reason'] === 'string') {
        return info['reason'];
    }
    if (details(body, QUOTA_FAILURE).length > 0) {
        return 'QUOTA_EXCEEDED';
    }
    return hasBillingPrecondition(body) ? 'BILLING_REQUIRED' : stringAt(body, 'error', 'status');
}

function infoMetadata(body: unknown, key: string): string | undefined {
    return details(body, ERROR_INFO)
        .map((detail) => stringAt(detail, 'metadata', key))
        .find((value) => value !== undefined);
}

function retryAfter(headers: Headers): number | undefined {
    const value = headers.get('retry-after') ?? '';
    return /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

/** `T` with every optional property also accepting undefined (what conditional fields produce). */
type Loose<T> = { [K in keyof T]: T[K] | undefined };

/** Copies the defined entries only (`exactOptionalPropertyTypes`). */
function defined<T extends object>(value: Loose<T>): T {
    return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T;
}

/** The statuses an organisation policy refusal arrives with (400 and 403 from IAM APIs, 412 from Cloud Storage). */
const POLICY_STATUSES: ReadonlySet<number> = new Set([400, 403, 412]);

/** The failure of a non-2xx answer whose body (possibly not JSON) was already read. */
export function failureOfAnswer(status: number, headers: Headers, body: unknown, role?: string): GoogleFailure {
    const constraint = POLICY_STATUSES.has(status) ? constraintOf(body) : undefined;
    const reason = reasonOf(body);
    return defined<GoogleFailure>({
        kind: constraint === undefined ? kindOfStatus(status) : 'orgPolicy',
        status,
        reason,
        api: reason === 'SERVICE_DISABLED' ? infoMetadata(body, 'service') : undefined,
        permission: infoMetadata(body, 'permission'),
        role,
        constraint,
        retryAfterSeconds: retryAfter(headers),
    });
}

/** A failure without an answer: the network, a timeout, an operation that never finished. */
export function unavailableFailure(role?: string): GoogleFailure {
    return defined<GoogleFailure>({ kind: 'unavailable', status: 0, role });
}

/** The gRPC codes a finished long-running operation's `error.code` may hold, as the HTTP status they map to. */
const HTTP_OF_GRPC: ReadonlyMap<number, number> = new Map([
    [3, 400],
    [5, 404],
    [6, 409],
    [7, 403],
    [8, 429],
    [9, 400],
    [10, 409],
    [14, 503],
    [16, 401],
]);

/** The failure of an operation that finished with an `error` (`google.rpc.Status`). */
export function failureOfOperation(error: JsonObject, role?: string): GoogleFailure {
    const code = typeof error['code'] === 'number' ? error['code'] : 2;
    const status = HTTP_OF_GRPC.get(code) ?? SERVER_ERROR;
    return failureOfAnswer(status, new Headers(), { error: { ...error, details: list(error['details']) } }, role);
}

/** Every message the admin shows: the backend's error codes and the admin's own two catalogues. */
export type AdminMessageKey = ApiErrorCode | AdminShellKey | AdminSetupKey;

export interface AdminMessage {
    readonly key: AdminMessageKey;
    readonly params?: Readonly<Record<string, string>>;
}

function forbiddenMessage(failure: GoogleFailure, scope: GoogleScope): AdminMessage {
    if (failure.api !== undefined) {
        // M6 (finding 4): an API the transport waited for and Google still refused is propagating, not off.
        const key = failure.reason === 'API_PROPAGATING' ? 'apiError.cloud.apiPropagation' : 'apiError.cloud.apiDisabled';
        return { key, params: { api: failure.api } };
    }
    if (failure.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
        return { key: 'adminShell.oauth.scopeDenied', params: { scope: `adminShell.oauth.scope.${scope}` } };
    }
    return { key: 'apiError.cloud.permission', params: { role: failure.role ?? 'roles/owner' } };
}

const MESSAGES: Readonly<Record<GoogleFailureKind, (failure: GoogleFailure, scope: GoogleScope) => AdminMessage>> = {
    unauthorized: () => ({ key: 'adminShell.session.googleExpired' }),
    forbidden: forbiddenMessage,
    notFound: () => ({ key: 'apiError.notFound' }),
    conflict: () => ({ key: 'apiError.conflict' }),
    rateLimited: () => ({ key: 'apiError.rateLimited' }),
    unavailable: (failure) =>
        failure.host === undefined
            ? { key: 'apiError.unavailable' }
            : { key: 'adminShell.network.blocked', params: { host: failure.host } },
    invalid: (failure) => ({ key: failure.reason === 'QUOTA_EXCEEDED' ? 'adminSetup.billing.quota' : 'apiError.internal' }),
    orgPolicy: (failure) => ({ key: 'adminSetup.provision.orgPolicy', params: { constraint: failure.constraint ?? '' } }),
};

/**
 * The message for a failure (§2.5, §3.3): a 401 asks to renew the Google permission; a 403 names the disabled API, the
 * unticked scope (`{scope}` is the key of the scope's name, translated by the page) or the missing role; an
 * organisation policy names its constraint; a billing account's project quota has its own message.
 */
export function failureMessage(failure: GoogleFailure, scope: GoogleScope = 'cloudPlatform'): AdminMessage {
    return MESSAGES[failure.kind](failure, scope);
}
