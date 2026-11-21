/**
 * How the backend reports a failure (`docs/research/M2-interfaces.md` → *Error codes*). A callable throws
 * `new HttpsError(API_ERRORS[code].status, code, details)` with `details` = {@link ApiErrorDetails}; the HTTPS endpoint
 * answers `API_ERRORS[code].httpStatus` with the same details as its JSON body. The admin shows
 * `translateApiError(locale, details.code, details.params)` and, for `apiError.invalidRequest`, each issue next to its
 * field. A code is an i18n key of `packages/shared/src/i18n/api/ro.ts`, so every failure has a Romanian and an English
 * message, and nothing user-visible is ever English-only text from the server.
 */
import { z } from 'zod';

import { isApiErrorCode, type ApiErrorCode } from '../i18n/api/index.js';
import { coded, type ValidationCode } from '../schemas/primitives.js';
import { isValidationCode, type ValidationIssue } from '../schemas/validation.js';

/** The Firebase callable error statuses the API uses (a subset of `FunctionsErrorCode`). */
export const FUNCTIONS_ERROR_STATUSES = [
    'invalid-argument',
    'unauthenticated',
    'permission-denied',
    'not-found',
    'already-exists',
    'aborted',
    'failed-precondition',
    'resource-exhausted',
    'unavailable',
    'internal',
] as const;

export type FunctionsErrorStatus = (typeof FUNCTIONS_ERROR_STATUSES)[number];

export interface ApiErrorSpec {
    /** The callable status (`HttpsError.code`). */
    readonly status: FunctionsErrorStatus;
    /** The HTTP status of the HTTPS endpoint's error response (the Firebase mapping, unless stated). */
    readonly httpStatus: number;
    /** True when the same request may succeed later without any change (the admin offers Retry). */
    readonly retryable: boolean;
}

/** The HTTP status Firebase's callable protocol uses for each status. */
const HTTP_STATUS: Readonly<Record<FunctionsErrorStatus, number>> = {
    'invalid-argument': 400,
    unauthenticated: 401,
    'permission-denied': 403,
    'not-found': 404,
    'already-exists': 409,
    aborted: 409,
    'failed-precondition': 400,
    'resource-exhausted': 429,
    unavailable: 503,
    internal: 500,
};

const RETRYABLE: ReadonlySet<FunctionsErrorStatus> = new Set(['aborted', 'resource-exhausted', 'unavailable', 'internal']);

function spec(status: FunctionsErrorStatus, httpStatus = HTTP_STATUS[status]): ApiErrorSpec {
    return { status, httpStatus, retryable: RETRYABLE.has(status) };
}

/** Every error code with its status; a code missing here (or a stray one) is a compile error. */
export const API_ERRORS: Readonly<Record<ApiErrorCode, ApiErrorSpec>> = {
    'apiError.unauthenticated': spec('unauthenticated'),
    'apiError.accountNotAllowed': spec('permission-denied'),
    'apiError.notAdmin': spec('permission-denied'),
    'apiError.appCheck': spec('unauthenticated'),
    'apiError.invalidRequest': spec('invalid-argument'),
    'apiError.notFound': spec('not-found'),
    'apiError.conflict': spec('aborted'),
    'apiError.rateLimited': spec('resource-exhausted'),
    'apiError.unavailable': spec('unavailable'),
    'apiError.internal': spec('internal'),
    // The admin's own code (finding 27 of 2026-10-31): a server answered in a shape older than the admin reads.
    'apiError.serverOutdated': spec('failed-precondition'),
    'apiError.guardPaused': spec('failed-precondition'),
    'apiError.claim.tokenInvalid': spec('unauthenticated'),
    'apiError.claim.tokenMismatch': spec('permission-denied'),
    'apiError.claim.scopeMissing': spec('permission-denied'),
    'apiError.claim.notOwner': spec('permission-denied'),
    'apiError.claim.alreadyClaimed': spec('already-exists'),
    'apiError.invite.alreadyAdmin': spec('already-exists'),
    'apiError.invite.notFound': spec('not-found'),
    'apiError.invite.expired': spec('failed-precondition'),
    'apiError.revoke.owner': spec('failed-precondition'),
    'apiError.revoke.self': spec('failed-precondition'),
    'apiError.history.notFound': spec('not-found'),
    'apiError.history.nothingToRestore': spec('failed-precondition'),
    'apiError.history.invalidSnapshot': spec('failed-precondition'),
    'apiError.history.placeYear': spec('failed-precondition'),
    'apiError.history.layerGone': spec('failed-precondition'),
    'apiError.mapbox.publicToken': spec('invalid-argument'),
    'apiError.mapbox.tokenFormat': spec('invalid-argument'),
    'apiError.mapbox.tokenInvalid': spec('permission-denied'),
    'apiError.mapbox.missingScopes': spec('permission-denied'),
    'apiError.mapbox.mintRefused': spec('failed-precondition'),
    'apiError.mapbox.notConfigured': spec('failed-precondition'),
    'apiError.mapbox.unavailable': spec('unavailable'),
    'apiError.usgs.credentials': spec('permission-denied'),
    'apiError.usgs.maintenance': spec('unavailable'),
    'apiError.usgs.notConfigured': spec('failed-precondition'),
    'apiError.usgs.unavailable': spec('unavailable'),
    'apiError.usgs.accessPending': spec('failed-precondition'),
    'apiError.usgs.alreadyAvailable': spec('failed-precondition'),
    'apiError.usgs.orderState': spec('failed-precondition'),
    'apiError.analytics.notEnabled': spec('failed-precondition'),
    'apiError.analytics.noWebApp': spec('failed-precondition'),
    'apiError.cloud.permission': spec('failed-precondition'),
    'apiError.cloud.apiDisabled': spec('failed-precondition'),
    'apiError.cloud.apiPropagation': spec('unavailable'),
    'apiError.cloud.refused': spec('failed-precondition'),
    'apiError.setup.eventsUnreached': spec('failed-precondition'),
    'apiError.errorReporting.unavailable': spec('unavailable'),
    'apiError.secrets.unavailable': spec('failed-precondition'),
    'apiError.photo.unsupportedType': spec('invalid-argument'),
    'apiError.photo.heicUnsupported': spec('invalid-argument'),
    'apiError.photo.tooLarge': spec('invalid-argument'),
    'apiError.photo.unreadable': spec('invalid-argument'),
    'apiError.photo.duplicate': spec('already-exists'),
    'apiError.photo.notReceived': spec('failed-precondition'),
    'apiError.photo.versionNotAllowed': spec('permission-denied'),
    // The city's tab icon (cities.setIcon): what the bytes are, not what they are called.
    'apiError.cityIcon.badType': spec('invalid-argument'),
    'apiError.cityIcon.tooBig': spec('invalid-argument'),
    'apiError.cityIcon.tooSmall': spec('invalid-argument'),
    'apiError.cityIcon.tooLarge': spec('invalid-argument'),
    'apiError.cityIcon.notSquare': spec('invalid-argument'),
    'apiError.cityIcon.animated': spec('invalid-argument'),
    'apiError.cityIcon.invalid': spec('invalid-argument'),
    'apiError.layers.alreadyLinked': spec('already-exists'),
    'apiError.layers.busy': spec('failed-precondition'),
    'apiError.layers.foreignTileset': spec('permission-denied'),
    'apiError.layers.otherCityTileset': spec('permission-denied'),
    'apiError.layers.secretInAddress': spec('invalid-argument'),
    'apiError.imagery.notScanned': spec('failed-precondition'),
    'apiError.imagery.alreadyImported': spec('already-exists'),
    'apiError.imagery.dailyLimit': spec('resource-exhausted'),
    'apiError.imagery.browseUnavailable': spec('unavailable'),
    'apiError.imagery.browseTooLarge': spec('failed-precondition'),
    'apiError.imagery.browseNotImage': spec('unavailable'),
    'apiError.imagery.notTiff': spec('invalid-argument'),
    'apiError.imagery.unreadableRaster': spec('invalid-argument'),
    'apiError.imagery.processingFailed': spec('internal'),
    'apiError.imagery.archiveCorrupt': spec('failed-precondition'),
    'apiError.imagery.downloadIncomplete': spec('unavailable'),
    'apiError.imagery.referenceUnavailable': spec('unavailable'),
    'apiError.imagery.cityNotFound': spec('failed-precondition'),
    'apiError.imagery.noMatch': spec('failed-precondition'),
    'apiError.imagery.noSpread': spec('failed-precondition'),
    'apiError.imagery.tooFewGcps': spec('invalid-argument'),
    'apiError.imagery.degenerateGcps': spec('invalid-argument'),
    'apiError.imagery.gcpOutside': spec('invalid-argument'),
    'apiError.imagery.cropOutsideLayer': spec('invalid-argument'),
    'apiError.imagery.noScan': spec('failed-precondition'),
    'apiError.imagery.versionState': spec('failed-precondition'),
    'apiError.imagery.versionRejected': spec('failed-precondition'),
    'apiError.imagery.importedAgain': spec('failed-precondition'),
    'apiError.imagery.overBudget': spec('failed-precondition'),
    'apiError.imagery.tilesetLimit': spec('failed-precondition'),
    'apiError.imagery.studioNotFound': spec('not-found'),
    'apiError.imagery.mtsRefused': spec('failed-precondition'),
    'apiError.imagery.sourceTooLarge': spec('failed-precondition'),
    'apiError.imagery.tilesMissing': spec('failed-precondition'),
    'apiError.imagery.tilesGone': spec('failed-precondition'),
    'apiError.imagery.tilesNotFound': spec('not-found'),
    'apiError.imagery.tilesNotImage': spec('invalid-argument'),
    'apiError.imagery.tilesUnreachable': spec('unavailable'),
    'apiError.imagery.addressRefused': spec('invalid-argument'),
    'apiError.imagery.outOfMemory': spec('failed-precondition'),
    'apiError.imagery.attemptsExhausted': spec('failed-precondition'),
    'apiError.imagery.locateInputsGone': spec('failed-precondition'),
    'apiError.imagery.locateFilesElsewhere': spec('failed-precondition'),
    'apiError.imagery.layoutStale': spec('failed-precondition'),
    'apiError.imagery.layoutWaits': spec('failed-precondition'),
    'apiError.imagery.mapboxFinishing': spec('failed-precondition'),
    'apiError.imagery.workerLost': spec('unavailable'),
    // P0-1 (2026-11-14): a lost local run whose attempt was given back (the computer stopped: a power cut or a crash).
    'apiError.imagery.workerLostAgain': spec('unavailable'),
    'apiError.imagery.workerLostRefunded': spec('unavailable'),
    // M8 (docs/research/M8-join-interfaces.md §4): joining frames of one date into one layer.
    'apiError.imagery.joinMixedFrames': spec('invalid-argument'),
    // Batch 4: a frame a newer join of its date stamped (a failed join's retry cannot take it back).
    'apiError.imagery.joinPartTaken': spec('failed-precondition'),
    'apiError.imagery.joinPartGone': spec('failed-precondition'),
    'apiError.imagery.joinPartHeld': spec('failed-precondition'),
    // M18 item 4: a join whose published frame's layer is busy; the admin offers to join once it is free.
    'apiError.imagery.joinLayerBusy': spec('failed-precondition'),
    'apiError.imagery.joinPartMissing': spec('failed-precondition'),
    'apiError.imagery.joinSeamTooFar': spec('failed-precondition'),
    'apiError.imagery.joinNoFrames': spec('failed-precondition'),
    'apiError.imagery.joinMapsApart': spec('failed-precondition'),
    'apiError.imagery.joinNeedsPoints': spec('failed-precondition'),
    'apiError.imagery.joinSameLayer': spec('failed-precondition'),
    'apiError.imagery.joinNoRoom': spec('failed-precondition'),
    // A step that ran past its wall-time limit (`STEP_LIMITS_SECONDS` of the pipeline; live 2026-11-12: an hour in `locate`).
    'apiError.imagery.stepTimeLimit': spec('failed-precondition'),
    // M16 (docs/research/M16-recalibrate.md): a refine that found nothing better, or whose proof did not hold, ends with these (the job and
    // its version cancelled, nothing else changed); Approve of a recalibration not shown better asks for the owner's choice; a join refines frame by frame.
    'apiError.imagery.notImproved': spec('failed-precondition'),
    'apiError.imagery.refineRefused': spec('failed-precondition'),
    'apiError.imagery.refineUnmeasured': spec('failed-precondition'),
    'apiError.imagery.notBetter': spec('failed-precondition'),
    'apiError.imagery.joinRecalibrate': spec('failed-precondition'),
    // M20 (docs/research/M20-import-local.md §1): a local archive's series never moves to the cloud, never publishes before its
    // rights are confirmed, runs only where its originals are, and is imported once.
    'apiError.imagery.localOnly': spec('failed-precondition'),
    'apiError.imagery.rightsUnconfirmed': spec('failed-precondition'),
    'apiError.imagery.archiveMissing': spec('failed-precondition'),
    'apiError.imagery.filmMissing': spec('failed-precondition'),
    'apiError.imagery.archiveImported': spec('failed-precondition'),
    'apiError.imagery.archiveYear': spec('failed-precondition'),
    // Pause (the owner's request of 2026-11-13): a job that finished or waits for something else; a timed pause past two days.
    'apiError.imagery.notPausable': spec('failed-precondition'),
    'apiError.imagery.pauseUntil': spec('invalid-argument'),
    // M25 (docs/research/M25-landsat.md §3): a Landsat delivery without a band the true colour needs {band}.
    'apiError.imagery.missingBand': spec('failed-precondition'),
    // A job type the worker's pipeline does not run: its image is older than the job; an updated one's retry runs it.
    'apiError.imagery.pipelineOutdated': spec('failed-precondition'),
    // A version is deleted only once it never reached the map, nothing runs for it and no other version is built on it.
    'apiError.imagery.deletePublished': spec('failed-precondition'),
    'apiError.imagery.deleteRunning': spec('failed-precondition'),
    'apiError.imagery.deleteInUse': spec('failed-precondition'),
    'apiError.worker.notHolder': spec('failed-precondition'),
    'apiError.worker.refused': spec('permission-denied'),
    // Finding 67 of 2026-11-02: a pairing code unknown, used or expired (one answer for the three), and a disconnected computer.
    'apiError.worker.pairCode': spec('permission-denied'),
    'apiError.worker.revoked': spec('permission-denied'),
    'apiError.telemetry.origin': spec('permission-denied'),
    'apiError.telemetry.tooLarge': spec('invalid-argument', 413),
    'apiError.assist.rateLimited': spec('resource-exhausted'),
    'apiError.assist.unavailable': spec('unavailable'),
    'apiError.assist.monthlyCap': spec('failed-precondition'),
    'apiError.assist.noDraft': spec('failed-precondition'),
    'apiError.assist.linksChanged': spec('failed-precondition'),
    'apiError.assist.dailyCap': spec('resource-exhausted'),
    'apiError.assist.modelUnavailable': spec('failed-precondition'),
    'apiError.notify.deviceInvalid': spec('invalid-argument'),
    'apiError.city.notMember': spec('permission-denied'),
    'apiError.city.notOwner': spec('permission-denied'),
    'apiError.city.notProjectOwner': spec('permission-denied'),
    'apiError.city.idTaken': spec('already-exists'),
    'apiError.city.tooMany': spec('failed-precondition'),
    'apiError.city.lastOwner': spec('failed-precondition'),
    'apiError.city.projectOwnerStays': spec('failed-precondition'),
    'apiError.city.budgetReached': spec('failed-precondition'),
    // M13 (docs/research/M13-roles.md).
    'apiError.city.notEditor': spec('permission-denied'),
    'apiError.city.notReviewer': spec('permission-denied'),
    'apiError.contribute.blocked': spec('permission-denied'),
    'apiError.contribute.alreadyMember': spec('failed-precondition'),
    'apiError.contribute.alreadyPending': spec('already-exists'),
    'apiError.contribute.retryLater': spec('failed-precondition'),
    'apiError.contribute.alreadyDecided': spec('failed-precondition'),
    'apiError.review.alreadyDecided': spec('failed-precondition'),
    'apiError.review.notReady': spec('failed-precondition'),
    'apiError.review.licenseUnknown': spec('failed-precondition'),
    'apiError.review.changed': spec('failed-precondition'),
    'apiError.review.storyEmpty': spec('failed-precondition'),
    'apiError.review.placeYear': spec('failed-precondition'),
    'apiError.suggestion.dailyLimit': spec('resource-exhausted'),
    'apiError.suggestion.wrongKind': spec('failed-precondition'),
    'apiError.suggestion.outsideCity': spec('invalid-argument'),
    'apiError.suggestion.noChange': spec('failed-precondition'),
    'apiError.suggestion.alreadyDecided': spec('failed-precondition'),
    'apiError.suggestion.invalid': spec('failed-precondition'),
    'apiError.suggestion.notRevertable': spec('failed-precondition'),
    'apiError.export.busy': spec('failed-precondition'),
    'apiError.export.dailyLimit': spec('resource-exhausted'),
    'apiError.export.downloadLimit': spec('resource-exhausted'),
    'apiError.export.tooLarge': spec('failed-precondition'),
    'apiError.export.notReady': spec('failed-precondition'),
    'apiError.export.expired': spec('failed-precondition'),
    'apiError.export.noManifest': spec('failed-precondition'),
    'apiError.install.bundleMissing': spec('failed-precondition'),
    'apiError.install.bundleFormat': spec('failed-precondition'),
    'apiError.install.mismatch': spec('failed-precondition'),
    'apiError.install.noRelease': spec('failed-precondition'),
    'apiError.install.notProvisioned': spec('failed-precondition'),
    'apiError.install.noRepository': spec('failed-precondition'),
    'apiError.install.newer': spec('failed-precondition'),
    'apiError.install.notAvailable': spec('failed-precondition'),
    'apiError.install.failed': spec('failed-precondition'),
    'apiError.install.missingFunctions': spec('failed-precondition'),
    'apiError.install.nothingToShow': spec('failed-precondition'),
    'apiError.install.adminOutdated': spec('failed-precondition'),
};

export const apiErrorCodeSchema = z.custom<ApiErrorCode>(isApiErrorCode, coded('validation.value'));

const PARAM_NAME = /^[a-zA-Z]{1,30}$/;
const MAX_PARAMS = 10;

/** The `{placeholder}` values of a message: plain strings, never markup (rendered as text). */
export const apiErrorParamsSchema = z
    .record(z.string().regex(PARAM_NAME), z.string().max(500))
    .refine((params) => Object.keys(params).length <= MAX_PARAMS, coded('validation.tooBig'));

export const validationIssueSchema = z.strictObject({
    path: z.string().max(200),
    code: z.custom<ValidationCode>((value) => typeof value === 'string' && isValidationCode(value), coded('validation.value')),
});

/** At most this many field issues travel with `apiError.invalidRequest` (the count says how many there were). */
export const MAX_ERROR_ISSUES = 50;

/** `HttpsError.details` of every callable failure, and the JSON body of an HTTPS error response. */
export const apiErrorDetailsSchema = z.strictObject({
    code: apiErrorCodeSchema,
    params: apiErrorParamsSchema.optional(),
    issues: z.array(validationIssueSchema).max(MAX_ERROR_ISSUES).optional(),
});

export type ApiErrorDetails = z.infer<typeof apiErrorDetailsSchema>;

/** The details of a failure; `apiError.invalidRequest` gets the first issues and their total as `{count}`. */
export function apiErrorDetails(
    code: ApiErrorCode,
    params?: Readonly<Record<string, string>>,
    issues?: readonly ValidationIssue[],
): ApiErrorDetails {
    if (issues === undefined) {
        return params === undefined ? { code } : { code, params: { ...params } };
    }
    return { code, params: { ...params, count: String(issues.length) }, issues: issues.slice(0, MAX_ERROR_ISSUES) };
}

/** The code a client shows when a failure carries no readable details (a network error, an old server). */
const FALLBACK_BY_STATUS: Readonly<Record<string, ApiErrorCode>> = {
    unauthenticated: 'apiError.unauthenticated',
    'permission-denied': 'apiError.notAdmin',
    'not-found': 'apiError.notFound',
    aborted: 'apiError.conflict',
    'resource-exhausted': 'apiError.rateLimited',
    unavailable: 'apiError.unavailable',
    'deadline-exceeded': 'apiError.unavailable',
    'invalid-argument': 'apiError.invalidRequest',
};

/**
 * What a client shows for a failed call: the server's details when they validate, otherwise the generic code of the
 * status (the Firebase JS SDK reports `functions/<status>`), else `apiError.internal`. Never throws.
 */
export function apiErrorFromFailure(status: unknown, details: unknown): ApiErrorDetails {
    const parsed = apiErrorDetailsSchema.safeParse(details);
    if (parsed.success) {
        return parsed.data;
    }
    const bare = typeof status === 'string' ? status.replace(/^functions\//, '') : '';
    return { code: FALLBACK_BY_STATUS[bare] ?? 'apiError.internal' };
}
