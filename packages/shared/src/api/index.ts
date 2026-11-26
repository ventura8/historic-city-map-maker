/** The M2 backend contract: error codes, request and response schemas, the function registry. */
export { API_ERROR_CODES, isApiErrorCode, translateApiError } from '../i18n/api/index.js';
export type { ApiErrorCode, ApiMessages } from '../i18n/api/index.js';
export {
    API_ERRORS,
    FUNCTIONS_ERROR_STATUSES,
    MAX_ERROR_ISSUES,
    apiErrorCodeSchema,
    apiErrorDetails,
    apiErrorDetailsSchema,
    apiErrorFromFailure,
    apiErrorParamsSchema,
    validationIssueSchema,
} from './errors.js';
export type { ApiErrorDetails, ApiErrorSpec, FunctionsErrorStatus } from './errors.js';
export * from './community.js';
// By name, not `export *`: the star cost the engine's IIFE bytes of module glue it never uses (DECISIONS-for-review.md §137j).
export {
    imageryArchiveImportRequestSchema,
    imageryArchiveImportResponseSchema,
    workerArchiveReportRequestSchema,
    workerArchiveReportResponseSchema,
} from './archive.js';
export type { ImageryArchiveImportRequest, WorkerArchiveReportRequest } from './archive.js';
export {
    imageryAcceptLayoutRequestSchema,
    imageryLayoutResponseSchema,
    imageryRelayoutRequestSchema,
    imagerySaveLayoutRequestSchema,
} from './imagery-tiles.js';
export { emptyRequestSchema, googleAccessTokenSchema, healthViewFields, isoTimeSchema } from './common.js';
export {
    CLAIM_OAUTH_SCOPE,
    INVITE_TTL_DAYS,
    OWNER_PERMISSION,
    claimRequestSchema,
    claimResponseSchema,
    inviteIdFor,
    inviteResponseSchema,
    joinRequestSchema,
    joinResponseSchema,
    normalizeEmail,
    revokeResponseSchema,
    sessionRequestSchema,
    sessionResponseSchema,
} from './admin.js';
export type { ClaimRequest, ClaimResponse, InviteResponse, JoinResponse, SessionResponse } from './admin.js';
export { HISTORY_KEEP, historyEntryId, historyEntryIdSchema, revertRequestSchema, revertResponseSchema } from './history.js';
export type { RevertRequest, RevertResponse } from './history.js';
export {
    LAYER_DELETE_GRACE_DAYS,
    LINKABLE_SOURCE_TYPES,
    freeOverlayId,
    layerDeleteParamsSchema,
    layerDeleteRequestSchema,
    layerDeleteResponseSchema,
    layerLinkRequestSchema,
    layerLinkResponseSchema,
    layerSourceRefusal,
    sourceOrigins,
    tilesetOwnerOf,
} from './layers.js';
export type {
    LayerDeleteParams,
    LayerDeleteRequest,
    LayerDeleteResponse,
    LayerLinkRequest,
    LayerLinkResponse,
    LayerSourceRefusal,
} from './layers.js';
export {
    MAPBOX_BOOTSTRAP_SCOPES,
    MAPBOX_PUBLIC_SCOPES,
    MAPBOX_TILES_SCOPES,
    MAPBOX_TOKEN_AUDIENCES,
    SELF_TEST_CHECKS,
    SETUP_REQUIRED_AREAS,
    TOKEN_RETIRE_MINUTES,
    USGS_DOWNLOAD_PERMISSION,
    USGS_EXPIRY_REMINDER_DAYS,
    USGS_RECHECK_HOURS,
    analyticsConfigRequestSchema,
    analyticsConfigResponseSchema,
    classifyMapboxToken,
    createCityRequestSchema,
    createCityResponseSchema,
    missingScopes,
    recordCloudRequestSchema,
    recordCloudResponseSchema,
    rotatePublicTokenRequestSchema,
    rotatePublicTokenResponseSchema,
    saveMapboxRequestSchema,
    saveMapboxResponseSchema,
    saveUsgsRequestSchema,
    saveUsgsResponseSchema,
    selfTestRequestSchema,
    selfTestResponseSchema,
    setupReady,
    setupStatusViewSchema,
    statusRequestSchema,
    usgsRoleFromPermissions,
} from './setup.js';
export type {
    AnalyticsConfigResponse,
    MapboxTokenAudience,
    MapboxTokenKind,
    RecordCloudRequest,
    RotatePublicTokenRequest,
    RotatePublicTokenResponse,
    SaveMapboxRequest,
    SaveMapboxResponse,
    SaveUsgsRequest,
    SaveUsgsResponse,
    SelfTestCheck,
    SelfTestResponse,
    SetupStatusView,
} from './setup.js';
// M6 setup-ux (docs/research/M6-interfaces.md §4.1): when Setup is done, and USGS's part in it.
export { USGS_ACCESS_PENDING, setupDone, usgsReadiness } from './setup-done.js';
export type { SetupDoneInput, UsgsReadiness } from './setup-done.js';
export {
    CRASH_TOP_FRAMES,
    ERROR_GROUP_RESOLUTIONS,
    ERROR_REPORT_LIMITS,
    ERROR_REPORT_MAX_BYTES,
    ERROR_SERVICES,
    ERROR_SOURCES,
    REPORTED_ERROR_EVENT_TYPE,
    REPORTED_EVENT_MAX_BYTES,
    errorReportSchema,
    listGroupsRequestSchema,
    listGroupsResponseSchema,
    reportedErrorEventSchema,
} from './telemetry.js';
export type { ErrorReport, ListGroupsRequest, ListGroupsResponse, ReportedErrorEvent } from './telemetry.js';
// What a crash report is not, and the browser of one (the reporters and `telemetry.reportError`).
export { clientLabel, crashNoiseOf } from '../telemetry/crash-noise.js';
export {
    DERIVATIVE_WRITTEN_AT,
    IMMUTABLE_CACHE_CONTROL,
    MANIFEST_CACHE_CONTROL,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    MANIFEST_SPLIT_BYTES,
    NIGHTLY_HOUR_UTC,
    OPS_TICK_SCHEDULE,
    PHOTO_LIMITS,
    STALE_USER_HOURS,
    UNPUBLISH_DELETE_MINUTES,
    buildManifestTaskSchema,
    manifestTaskId,
    rebuildManifestRequestSchema,
    rebuildManifestResponseSchema,
    reprocessPhotoRequestSchema,
    reprocessPhotoResponseSchema,
} from './content.js';
export type { BuildManifestTask, RebuildManifestRequest, RebuildManifestResponse } from './content.js';
export { wikipediaListedArticleSchema, wikipediaManageRequestSchema, wikipediaManageResponseSchema } from './wikipedia.js';
export type { WikipediaListedArticle, WikipediaManageRequest, WikipediaManageResponse } from './wikipedia.js';
export {
    BROWSE_FETCH_MAX_BYTES,
    BROWSE_LONG_EDGE,
    BROWSE_MAX_BYTES,
    BROWSE_PREFETCH,
    CLOUD_RUN_JOBS,
    HARVEST_EVERY_DAYS,
    HARVEST_RESUME_MINUTES,
    HARVEST_RETRY_HOURS,
    HEARTBEAT_SECONDS,
    IMAGERY_PUBLISH_QUEUE,
    IMAGERY_TICK_SCHEDULE,
    JOBS_PER_DAY,
    JOB_MAX_ATTEMPTS,
    LEASE_SECONDS,
    LOST_RUN_REFUNDS,
    LOST_HAND_OVER_MS,
    NOT_RETRYABLE_CODES,
    PIPELINE_OUTDATED,
    PIPELINE_RUN_ARGS,
    PROBE_LIMITS,
    PUBLISH_MAX_ATTEMPTS,
    PUBLISH_POLL_SECONDS,
    RUNNING_JOBS_MAX,
    STARTING_STALE_MINUTES,
    USGS_BACKOFF_MINUTES,
    imageryApproveRequestSchema,
    imageryApproveResponseSchema,
    imageryBrowseRequestSchema,
    imageryBrowseResponseSchema,
    imageryChooseRequestSchema,
    imageryChooseResponseSchema,
    imageryConfirmRightsRequestSchema,
    imageryConfirmRightsResponseSchema,
    imageryDeleteVersionResponseSchema,
    imageryMakeLiveResponseSchema,
    imageryCropRequestSchema,
    imageryCropResponseSchema,
    imageryImportRequestSchema,
    imageryImportResponseSchema,
    imageryJoinRequestSchema,
    imageryJoinResponseSchema,
    imageryProbeRequestSchema,
    imageryProbeResponseSchema,
    imageryRecalibrateRequestSchema,
    imageryRecalibrateResponseSchema,
    imageryRejectResponseSchema,
    imageryResumeGuardRequestSchema,
    imageryResumeGuardResponseSchema,
    imageryRetryRequestSchema,
    imageryRetryResponseSchema,
    imagerySaveGcpsRequestSchema,
    imagerySaveGcpsResponseSchema,
    imagerySearchRequestSchema,
    imagerySearchResponseSchema,
    IMAGERY_PREVIEW_URL_SECONDS,
    imageryPreviewUrlResponseSchema,
    imageryStudioDoneResponseSchema,
    imageryVersionRequestSchema,
    failedOutdated,
    jobRetryable,
    publishTaskSchema,
    rasterUploadMetadataSchema,
    retryCures,
    retryPastCap,
    runsLocally,
} from './imagery.js';
export type {
    ImageryChooseRequest,
    ImageryCropRequest,
    ImageryImportResponse,
    ImageryJoinRequest,
    ImageryJoinResponse,
    ImageryProbeRequest,
    ImagerySaveGcpsRequest,
    ImagerySearchRequest,
    ImagerySearchResponse,
    PublishTask,
    RasterUploadMetadata,
} from './imagery.js';
// M4 (docs/research/M4-interfaces.md): buying a scan, the assists, push notifications.
export {
    usgsCancelOrderRequestSchema,
    usgsCancelOrderResponseSchema,
    usgsCheckOrderRequestSchema,
    usgsCheckOrderResponseSchema,
    usgsMarkOrderedRequestSchema,
    usgsMarkOrderedResponseSchema,
} from './orders.js';
export type { UsgsCheckOrderResponse, UsgsMarkOrderedRequest } from './orders.js';
export {
    assistSuggestTitleRequestSchema,
    assistSuggestTitleResponseSchema,
    assistTranslateDraftRequestSchema,
    assistTranslateDraftResponseSchema,
    geocodeTaskSchema,
} from './assist.js';
export type { AssistSuggestTitleResponse, AssistTranslateDraftRequest, GeocodeTask } from './assist.js';
export {
    notifyRegisterDeviceRequestSchema,
    notifyRegisterDeviceResponseSchema,
    notifySendTestRequestSchema,
    notifySendTestResponseSchema,
    notifyUnregisterDeviceRequestSchema,
    notifyUnregisterDeviceResponseSchema,
} from './notify.js';
export type { NotifyRegisterDeviceRequest } from './notify.js';
// M5 (docs/research/M5-interfaces.md): many cities in one project, the static export.
export {
    cityAdminsListRequestSchema,
    cityAdminsListResponseSchema,
    cityInviteRequestSchema,
    cityRevokeRequestSchema,
    citySetRoleRequestSchema,
    citySetRoleResponseSchema,
    citiesCreateRequestSchema,
    citiesCreateResponseSchema,
    citiesLocateRequestSchema,
    citiesLocateResponseSchema,
    citiesSetLimitsRequestSchema,
    citiesSetLimitsResponseSchema,
    sessionCitiesSchema,
    sessionCitySchema,
} from './cities.js';
export type { CitiesCreateRequest, CityAdminsListResponse, SessionCity } from './cities.js';
export {
    EXPORT_QUEUE,
    exportDownloadRequestSchema,
    exportDownloadResponseSchema,
    exportStartRequestSchema,
    exportStartResponseSchema,
    exportTaskSchema,
} from './city-export.js';
export type { ExportDownloadResponse, ExportStartRequest, ExportTask } from './city-export.js';
export { CITY_ICON_LIMITS, CITY_ICON_SIZES, cityIconRequestSchema, cityIconResponseSchema, type CityIconSize } from './city-icon.js';
export type { CityIconRequest, CityIconResponse } from './city-icon.js';
export {
    CLOUD_RUN_ESTIMATE_SECONDS,
    CLOUD_RUN_FREE_TIER,
    JOB_MACHINE_SIZES,
    MAPBOX_FREE_UPLOAD_MB,
    UPLOADS_FREE_MAX_BYTES,
    WORKER_DELETE_FIELD,
    WORKER_FRESH_SECONDS,
    WORKER_IDLE_POLL_SECONDS,
    WORKER_LEASE_PREFIX,
    WORKER_POLL_SECONDS,
    WORKER_PORT,
    WORKER_URL_SECONDS,
    WORKER_URLS_MAX,
    WORKER_USGS_ENDPOINTS,
    WORKER_CONTAINER,
    WORKER_PAIR_ATTEMPTS,
    WORKER_PAIR_CODE_PATTERN,
    WORKER_PAIR_ID_PATTERN,
    WORKER_PAIR_SECONDS,
    WORKER_PAIR_WINDOW_SECONDS,
    WORKER_WAIT_MINUTES,
    WORKER_OUTDATED_EXIT,
    WORKER_STARTER_PLACEHOLDERS,
    WORKER_STARTER_TEMPLATES,
    WORKER_STARTER_VERSION,
    WORKER_STARTER_LIST_FILE,
    WORKER_STARTER_UPDATES,
    WORKER_OSES,
    WORKER_STARTER_ACTIONS,
    WORKER_STARTER_FILE_NAMES,
    workerStarterQuerySchema,
    imageryRunOnRequestSchema,
    imageryRunOnResponseSchema,
    PAUSE_ACTIONS,
    PAUSE_UNTIL_MAX_HOURS,
    imageryPauseRequestSchema,
    imageryPauseResponseSchema,
    workerPairCodeRequestSchema,
    workerPairCodeResponseSchema,
    workerRevokeRequestSchema,
    workerRevokeResponseSchema,
    WORKER_HOUSEHOLD_PAIR_SECONDS,
    ARCHIVE_COPY_MAX_BYTES,
    ARCHIVE_SHARE_DAY_BYTES,
    ARCHIVE_SHARE_IDLE_WHYS,
} from './worker.js';
export { WORKER_MANAGE_ACTIONS, workerManageRequestSchema, workerManageResponseSchema } from './worker-manage.js';
export type { PauseAction, WorkerOs, WorkerStarterAction, WorkerStarterUpdate } from './worker.js';
// M26: what the worker says of its computer (`machine` on its `/state`), and the owner's profile.
export {
    WORKER_ACCELERATOR_VIAS,
    WORKER_CHOSEN,
    WORKER_MATCHERS,
    WORKER_POWER_SOURCES,
    WORKER_PROFILES,
    WORKER_PROFILE_CHOICES,
    WORKER_PROFILE_WHYS,
    workerMachineSchema,
    workerProfileRequestSchema,
} from './worker-machine.js';
export type { WorkerMachine, WorkerProfileChoice, WorkerProfileRequest } from './worker-machine.js';
export {
    ADMIN_CALLABLES,
    BACKGROUND_FUNCTIONS,
    CALLABLE_NAMES,
    CITY_ACCESSES,
    FUNCTION_OWNERS,
    HTTP_ENDPOINTS,
    WORKER_CALLABLE_NAMES,
    deployedName,
} from './registry.js';
export type {
    AdminCallableName,
    AppCheckMode,
    BackgroundTrigger,
    CallableAccess,
    CallableSpec,
    FunctionOwner,
    WorkerCallableName,
} from './registry.js';
// M7: the local worker's callables, and the whole table (the functions' and the tests'; the admin reads ADMIN_CALLABLES).
export {
    WORKER_CALLABLES,
    workerArchiveCopyRequestSchema,
    workerArchiveCopyResponseSchema,
    workerClaimRequestSchema,
    workerClaimResponseSchema,
    workerEndRequestSchema,
    workerEndResponseSchema,
    workerHelloRequestSchema,
    workerHelloResponseSchema,
    workerImageRequestSchema,
    workerImageResponseSchema,
    workerPairRequestSchema,
    workerPairResponseSchema,
    workerPauseCommandSchema,
    workerSignedObjectSchema,
    workerStepOpSchema,
    workerStepRequestSchema,
    workerStepResponseSchema,
    workerUrlsRequestSchema,
    workerUrlsResponseSchema,
} from './worker-calls.js';
export type { WorkerPauseCommand } from './worker-calls.js';
export { CALLABLES } from './callables.js';
export type { CallableName, CallableRequest, CallableResponse } from './callables.js';
