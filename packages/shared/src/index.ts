// The viewer's and the interface's languages, their catalogues' registry and the fallback to English (docs/I18N.md).
export * from './i18n/index.js';
export { pluralOf } from './i18n/plural.js';
export * from './i18n/locales.js';
export type { Translator } from './i18n/catalogue.js';
// The admin's own texts (docs/research/M2b-interfaces.md §1.6): separate catalogues the viewer never imports.
export { translateAdminShell, type AdminShellKey, type AdminShellMessages } from './i18n/admin-shell/index.js';
export { translateStart, type StartKey } from './i18n/start/index.js';
export { translateAdminSetup, type AdminSetupKey, type AdminSetupMessages } from './i18n/admin-setup/index.js';
export { translateAdminContent, type AdminContentKey, type AdminContentMessages } from './i18n/admin-content/index.js';
export { REDACTED, consoleSink, createLogger, redact } from './log.js';
export type { LogData, LogLevel, LogRecord, LogSink, Logger, LoggerOptions } from './log.js';

export { EARTH_RADIUS_M, MAX_MERCATOR_LAT, bearingDelta, clamp, roundTo, toDegrees, toRadians, wrapBearing } from './geo/math.js';
export type { LngLat } from './geo/math.js';
export { streetViewUrl } from './geo/street-view.js';
export { PHOTO_KINDS, PHOTO_VIEWS, photoKindOf, type PhotoKind, type PhotoVersion, type PhotoView } from './schemas/manifest.js';
export { bearingBetween, destinationPoint, distanceMeters } from './geo/bearing.js';
export { DEFAULT_FOV, MAX_FOV, MIN_FOV, angularSpan, coneFromPolygon, conePolygon, findConeApex, openRing } from './geo/cone.js';
export type { MeasuredCone, ViewCone } from './geo/cone.js';
export { bboxCenter, bboxContains, bboxExpand, bboxFromRecord, bboxIntersects, bboxOf, bboxToRecord, clampToBBox } from './geo/bbox.js';
export type { BBox, BoundsRecord } from './geo/bbox.js';

export { DEFAULT_COMPARE_POSITION, DEFAULT_HASH_LIMITS, MAX_HASH_LENGTH, MAX_OVERLAY_ENTRIES, decodeHash, encodeHash } from './url/hash.js';
export type { CompareState, DecodedHash, HashLimits, HashState, MapView } from './url/hash.js';

export { formatPhotoDate, monthNames } from './text/photo-date.js';
export { MAX_URL_LENGTH, isCspOrigin, isHostOf, isHttpsUrl, isRelativeUrl, toHttpsUrl } from './text/urls.js';
export { linkTargets, markdownToPlainText, parseMarkdown } from './text/markdown.js';
export { redactText } from './text/redact.js';
export type { InlineNode, MarkdownDocument, MarkdownParagraph } from './text/markdown.js';
export { parseStory, storyFigureIds, type StoryBlock, type StoryFigure } from './text/story.js';

export { ID_PATTERN, MAX_LINKS, MAX_TOKENS, PHOTOS_OVERLAY_ID, TOKEN_NAME_PATTERN, isId, yearSchema } from './schemas/primitives.js';
export type { ValidationCode } from './schemas/primitives.js';
export {
    LAYER_ADJUSTMENT_RANGES,
    LAYER_KINDS,
    LICENSES,
    MANIFEST_VERSION,
    MAX_LAYERS,
    MAX_PHOTOS,
    THEME_SCHEMES,
    citySchema,
    layerSchema,
    manifestSchema,
    photoSchema,
    themeSchema,
    unplacedPhotoSchema,
} from './schemas/manifest.js';
export * from './schemas/review.js';
export { REVIEW_ROLES, STAFF_ROLES, isContributorOnly, isReviewRole, isStaffRole, strongerRole } from './schemas/city-roles.js';
export { PHOTO_LOCATION_SLACK_DEG } from './schemas/manifest-rules.js';
export { GEOMETRY_TYPES, MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS, geometryDocSchema, geometryFromDoc } from './schemas/geometry.js';
export { geometryPositions, geometrySchema, geometryToDoc } from './schemas/geometry.js';
export type { Geometry, GeometryDoc, GeometryType } from './schemas/geometry.js';
export {
    DEFAULT_POI_ICON,
    ICON_NAME_PATTERN,
    MAX_POIS,
    MAX_POI_CATEGORIES,
    MAX_POI_PHOTOS,
    POI_ICONS,
    photosOverlaySchema,
    poiCategorySchema,
    poiSchema,
} from './schemas/poi.js';
export type { PhotosOverlay, Poi, PoiCategory, PoiIcon } from './schemas/poi.js';
export { hasPlaceYear, latestPlaceYear, placeYearIssues, type PlaceYears } from './schemas/place-year.js';
export { storyDocSchema, type StoryDoc } from './schemas/firestore.js';
export { MAX_STORIES, MAX_STORY_LINKS, MAX_STORY_TEXT, storySchema, type Story } from './schemas/story.js';
// M31 (docs/research/M31-wikipedia.md): the Wikipedia overlay's file, state, settings and its articles as places.
export * from './schemas/wikipedia.js';
export * from './overlays/wikipedia.js';
export type {
    Basemap,
    City,
    Credit,
    Layer,
    LayerAdjustmentName,
    LayerAdjustments,
    LayerKind,
    LayerSource,
    License,
    Manifest,
    Photo,
    UnplacedPhoto,
    PhotoImage,
    PhotoLink,
    Theme,
    ThemeScheme,
    ThemeTokens,
} from './schemas/manifest.js';
export { DEFAULT_CONTAINER_SELECTOR, engineConfigSchema, type EngineConfig } from './schemas/config.js';
export { SYSTEM_WRITERS, systemWriter, timestampFromDate, timestampSchema, timestampToDate } from './schemas/firestore-common.js';
export type { SystemWriter, TimestampLike } from './schemas/firestore-common.js';
export {
    FIRESTORE_LICENSES,
    GEOREF_METHODS,
    LAYER_TILESET_ORIGINS,
    HISTORY_ACTIONS,
    HISTORY_ENTITIES,
    LAYER_STATUSES,
    PHOTO_CONTENT_TYPES,
    PROCESSING_STATES,
    cityDocSchema,
    historyEntryDocSchema,
    httpsOriginSchema,
    layerDocSchema,
    mapboxTokenIdSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
} from './schemas/firestore.js';
export type {
    CityDoc,
    FirestoreLicense,
    GeorefMethod,
    HistoryAction,
    HistoryEntity,
    HistoryEntryDoc,
    LayerDoc,
    PhotoContentType,
    PhotoDoc,
    PoiCategoryDoc,
    PoiDoc,
} from './schemas/firestore.js';
export {
    ADMIN_ROLES,
    CLIENT_JOB_TYPES,
    FINISHED_JOB_STATUSES,
    GUARD_REASONS,
    GUARD_STATES,
    JOB_LOG_LEVELS,
    JOB_MACHINES,
    JOB_STATUSES,
    JOB_STEP_STATES,
    JOB_TYPES,
    JOB_WAIT_REASONS,
    MANIFEST_BUILD_STATES,
    MANIFEST_ENTITIES,
    OPS_STEPS,
    PROVISION_CHANGED_IN,
    PROVISION_ITEMS,
    PROVISION_SET_VERSION,
    PLACING_POINTS_HOLD_MS,
    RUN_CHOICES,
    RUN_PLACES,
    SERVICE_STATES,
    SETUP_AREAS,
    USGS_ROLES,
    USGS_SCENE_STATUSES,
    WORKER_ID_PATTERN,
    adminDocSchema,
    provisionDue,
    inviteDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    jobStatusOnlySchema,
    manifestStateDocSchema,
    opsDispatchDocSchema,
    opsGuardDocSchema,
    opsProbeDocSchema,
    ownerDocSchema,
    setupStatusDocSchema,
    usageDocSchema,
    usgsSceneDocSchema,
} from './schemas/firestore-ops.js';
export {
    HARVEST_DATASET_STATES,
    HARVEST_OUTCOMES,
    HARVEST_STOP_REASONS,
    harvestDatasetSchema,
    harvestStateDocSchema,
} from './schemas/harvest-state.js';
export type { HarvestDataset, HarvestDatasets, HarvestStateDoc } from './schemas/harvest-state.js';
export type {
    AdminDoc,
    AdminRole,
    InviteDoc,
    JobDoc,
    JobLogDoc,
    JobMachine,
    JobStatus,
    JobType,
    JobWaitReason,
    RunChoice,
    RunPlace,
    ManifestStateDoc,
    OpsDispatchDoc,
    OpsGuardDoc,
    OpsProbeDoc,
    OpsStep,
    OwnerDoc,
    ProvisionItem,
    ServiceState,
    SetupArea,
    SetupStatusDoc,
    UsageDoc,
    UsgsRole,
    UsgsSceneDoc,
} from './schemas/firestore-ops.js';
export { BROWSE_STATES, CLOUDY_CITY_PERCENT, CLOUD_ESTIMATE_VERSION, DEM_ATTRIBUTION } from './schemas/usgs-scene.js';
export { RANKING_VERSION, RANKING_WEIGHTS } from './schemas/usgs-scene.js';
export { RANK_REASONS, SENSORS, SENSOR_SPECS, UNUSABLE_REASONS, USGS_ATTRIBUTION } from './schemas/usgs-scene.js';
export { cloudEstimateSchema, rankReasonSchema, usgsBrowseUrlSchema } from './schemas/usgs-scene.js';
export type { CloudEstimate, RankReason, RankReasonEntry, Sensor, SensorSpec, UnusableReason, UsgsDataset } from './schemas/usgs-scene.js';
export {
    AUTO_MIN_MEASURED_PCT,
    CITY_MIN_COVERAGE_PCT,
    DEFAULT_RMSE_THRESHOLD_M,
    JOIN_MAX_FRAMES,
    JOIN_MAX_PARTS,
} from './schemas/imagery-settings.js';
export { MAX_TARGET_YEARS, RMSE_THRESHOLD_RANGE, cityImagerySchema, imagerySettingsOf } from './schemas/imagery-settings.js';
// M25 (docs/research/M25-landsat.md): named, never `export *` (a star re-export costs the engine bytes: docs/LESSONS.md 532).
export { DECLASS_DATASETS, DEFAULT_LANDSAT_YEARS, ETM_SLC_OFF_DATE, LANDSAT_ATTRIBUTION } from './schemas/landsat.js';
export { LANDSAT_AUTO_MAX_CLOUD, LANDSAT_AUTO_MAX_PER_TICK, LANDSAT_AUTO_PER_TICK, LANDSAT_DATASETS } from './schemas/landsat.js';
export { LANDSAT_MAX_CITY_CLOUD_PCT, LANDSAT_MAX_OFFSET_PX, landsatClear } from './schemas/landsat-verdict.js';
export { LANDSAT_MONTHS, LANDSAT_SEARCH_MAX_CLOUD, LEAF_ON_MONTHS, USGS_DATASETS } from './schemas/landsat.js';
export { isLandsatDataset, landsatReportSchema, landsatYearsOf } from './schemas/landsat.js';
export type * from './schemas/landsat.js';
export type { CityImagery, ImagerySettings } from './schemas/imagery-settings.js';
export {
    CHECKPOINT_KINDS,
    GCP_ORIGINS,
    GEOREF_TRANSFORMS,
    MAX_GCPS,
    MAX_SCAN_PIXELS,
    MIN_GCPS,
    cropRingSchema,
    enabledGcps,
    gcpSchema,
    georefSchema,
    pixelSchema,
} from './schemas/georef.js';
export type { CheckpointKind, CropRing, Gcp, GcpOrigin, Georef, GeorefTransform } from './schemas/georef.js';
export {
    DOWNLOAD_STEPS,
    ENDED_VERSION_STATES,
    GUARD_VERDICTS,
    JOB_PARAMS_SCHEMAS,
    JOB_STEPS,
    LAYER_VERSION_STATES,
    MTS_PRECISIONS,
    PIPELINE_STEPS,
    PUBLISH_CHOICES,
    PUBLISH_PATHS,
    PUBLISH_STEPS,
    SCAN_PREVIEW_MAX_PX,
    VERSION_ORIGINS,
    geotiffImportParamsSchema,
    layerVersionDocSchema,
    regeorefParamsSchema,
    republishParamsSchema,
    isSideJob,
    layerTilesParamsSchema,
    runsOnPipeline,
    SIDE_JOB_TYPES,
    versionTilesSchema,
    type VersionTiles,
    usgsImportParamsSchema,
} from './schemas/imagery.js';
export type {
    JobStep,
    LayerVersionDoc,
    LayerVersionState,
    MtsPrecision,
    PipelineStep,
    PublishChoice,
    PublishStep,
} from './schemas/imagery.js';
export {
    KM2_PER_COMPUTE_UNIT,
    MAPBOX_FREE_COMPUTE_UNITS,
    MAX_TILESETS,
    STUDIO_MAX_BYTES,
    USD_PER_COMPUTE_UNIT,
    availableComputeUnits,
    estimateComputeUnits,
    fnv1a32,
    guardVerdict,
    nextMonthStart,
    precisionOf,
    rasterRecipe,
    tilesetIdFor,
    tilesetName,
    usageMonth,
} from './schemas/imagery-publish.js';
export type { GuardInput, GuardOutcome, UsageCounters } from './schemas/imagery-publish.js';
export {
    PRIVATE_BUCKET_LIFECYCLE,
    RASTER_PATHS,
    RASTER_UPLOAD_FILE_PATTERN,
    RASTER_UPLOAD_MAX_BYTES,
    REFERENCE_KINDS,
    VERSION_FILES,
    isOwnTiles,
    parseRasterUploadPath,
} from './schemas/imagery-paths.js';
export type { RasterUpload, ReferenceKind, VersionFile, VersionTilesPaths } from './schemas/imagery-paths.js';
// M4 (docs/research/M4-interfaces.md): buying a scan, automatic GCP suggestions, the assists, notifications (every export
// of these modules is public; `test/index.test.ts` lists them).
export * from './schemas/usgs-order.js';
export * from './schemas/autogcp.js';
export * from './schemas/assist.js';
export * from './schemas/notifications.js';
export * from './schemas/worker.js';
export * from './schemas/imagery-calibration.js';
export * from './schemas/imagery-recalibration.js';
export * from './schemas/imagery-join.js';
export { layerVersionReadSchema, salvageLayerVersion, setupStatusReadSchema, type SalvagedVersion } from './schemas/legacy-reads.js';
export * from './schemas/imagery-plan.js';
// M20 (docs/research/M20-import-local.md): a local archive's report, its series, rights, the map threshold. By name, not
// `export *`: the star cost the engine's IIFE 19 bytes gzip of module glue it never uses (DECISIONS-for-review.md §137j).
export { ARCHIVE_ACTIONS, ARCHIVE_AUTO_LIKELIHOODS, ARCHIVE_ENCODINGS, ARCHIVE_ID_PATTERN } from './schemas/imagery-archive.js';
export { ARCHIVE_ISSUES_MAX, ARCHIVE_MAX_SERIES, ARCHIVE_MIN_YEAR, ARCHIVE_PLACE_METHODS } from './schemas/imagery-archive.js';
export { ARCHIVE_SERIES_CLASSES, ARCHIVE_SERIES_MAX_BYTES, ARCHIVE_SKIP_REASONS } from './schemas/imagery-archive.js';
export { DEFAULT_MAP_THRESHOLD_MAX_M, HELP_REASONS, LAYER_LICENSES, MAP_PAPER_TOLERANCE_MM } from './schemas/imagery-archive.js';
export { MAP_THRESHOLD_MAX_RANGE, RIGHTS_LICENCES, RIGHTS_STATES, SERIES_ID_PATTERN, archiveDocSchema } from './schemas/imagery-archive.js';
export { archiveIssueSchema, archiveReportSchema, archiveSeriesParamsSchema, archiveSeriesSchema } from './schemas/imagery-archive.js';
export { archiveSourceSchema, creditLine, gridDocSchema, helpItemSchema, layerRightsOf } from './schemas/imagery-archive.js';
export { layerRightsSchema, mapThresholdM, opsDailyDocSchema, rightsAllowPublish, rightsSchema } from './schemas/imagery-archive.js';
export type * from './schemas/imagery-archive.js';
export { helpFlagsOf, relayoutable, restitchable, STITCH_METHODS, STITCHED_PREVIEW_MAX_PX } from './schemas/imagery-help.js';
export { stitchedSchema, type HelpFlags, type RestitchInput, type Stitched } from './schemas/imagery-help.js';
export * from './schemas/imagery-tiles.js';
// M5 (docs/research/M5-interfaces.md): many cities in one project, the static export, engine releases on jsDelivr (every
// export of these modules is public; `test/index.test.ts` lists them).
export * from './schemas/cities.js';
export * from './schemas/city-export.js';
export * from './schemas/engine-release.js';
// M6 installer (docs/research/M6-interfaces.md §1): the install bundle, the build log's events, each target's state.
export * from './schemas/install.js';
// The admin on its own Hosting site (the owner's decision of 2026-11-13, DECISIONS-for-review.md §210).
export * from './schemas/admin-site.js';
export * from './schemas/start-release.js';
// M5 kit-cli (§3.2): the one CSP table of every engine page, and the starter kit's page (`fillKitPage`).
export * from './kit/csp.js';
export * from './kit/page.js';
export * from './imagery/index.js';
export * from './georef/index.js';
export { CLIENT_WRITES, type ClientCollection, type ClientWrites } from './schemas/client-writes.js';
export {
    CITY_ID_PATTERN,
    FIRESTORE_PATHS,
    GEOCODE_KEY_PATTERN,
    NOTIFICATION_ID_PATTERN,
    PUSH_DEVICE_ID_PATTERN,
    PHOTO_EXTENSIONS,
    PHOTO_VARIANTS,
    STORAGE_PATHS,
    UPLOAD_FILE_PATTERN,
    auditedDocumentPath,
    cityIdSchema,
    parseAuditedDocumentPath,
    parsePhotoUploadPath,
    publicObjectUrl,
} from './schemas/paths.js';
export type { AuditedDocument, PhotoUpload, PhotoVariant } from './schemas/paths.js';
export { formatPath, isValidationCode, parseManifestJson, toValidationIssues, validate, validateManifest } from './schemas/validation.js';
export type { Schema, ValidationIssue, ValidationResult } from './schemas/validation.js';
export { checkManifestCompat, compareVersions, parseReleaseVersion, parseVersion, PRERELEASE_CHANNELS } from './schemas/compat.js';
export type { ManifestCompat, PrereleaseChannel, ReleaseVersionParts } from './schemas/compat.js';

export {
    DEFAULT_PHOTOS_OPACITY,
    OVERLAY_KINDS,
    findOverlay,
    hashOverlayOpacity,
    opacityPercent,
    overlayLabel,
    overlaysFromManifest,
    resetOverlays,
    withHashOpacity,
    withOverlayOpacity,
    withOverlayVisibility,
} from './overlays/model.js';
export type { Overlay, OverlayKind, OverlayLabel } from './overlays/model.js';
export { MAP_LAYER_TYPES, OPACITY_PROPERTIES, OVERLAY_LAYER_TYPES, overlayOpacityPaint, rasterAdjustmentPaint } from './overlays/paint.js';
export type { MapLayerType, OpacityBase, OpacityProperty, PaintUpdate, RasterAdjustmentPaint } from './overlays/paint.js';
export { isPhotoNearYear, PHOTO_YEAR_WINDOW, PHOTOS_NEAR_WINDOWS } from './overlays/photos.js';
export { poiIcon, poiInYear } from './overlays/poi.js';
export { missingStarterCategories, STARTER_POI_CATEGORIES, starterCategoryDocs } from './overlays/starter-categories.js';
export type { StarterCategory, StarterCategoryDoc } from './overlays/starter-categories.js';
export {
    ADJUSTMENT_SLIDERS,
    adjustmentDelta,
    adjustmentFromSlider,
    normalizeAdjustments,
    sameAdjustments,
    signedPercent,
    sliderFromAdjustment,
    withAdjustment,
} from './overlays/adjustments.js';
export type { AdjustmentSlider } from './overlays/adjustments.js';

// Field measurements (DECISIONS-for-review.md §76): GA4's event schemas and guards, Core Web Vitals as GA4 parameters;
// imported only by the apps' consented lazy chunks (each its own app's table).
export {
    APP_SURFACES,
    COMMON_EVENT_PARAMS,
    SURFACE_PARAMS,
    FIELD_EVENT_BUDGET,
    GA_LIMITS,
    MAP_ERROR_KINDS,
    VIEWER_PHASES,
    VITAL_DEBUG_NUMBERS,
    WEB_VITAL_NAMES,
    WINDOW_CLASS_NAMES,
    createFieldGuard,
    eventProblem,
    eventSchemas,
} from './telemetry/field-events.js';
export type * from './telemetry/field-events.js';
export { INPUT_DEVICES, VIEWER_EVENT_PARAMS, createViewerGuard, type ViewerEventName } from './telemetry/viewer-events.js';
export { ADMIN_EVENT_PARAMS, FUNNEL_EVENT_PARAMS, createAdminGuard, type AdminEventName } from './telemetry/admin-events.js';
export { observeWebVitals, sanitizeTarget, shortTarget, vitalParams } from './telemetry/web-vitals.js';
export { privacySignal, type PrivacyNavigator } from './telemetry/privacy.js';
export type { FieldChunk, VitalAttribution, VitalMetric, VitalObserver, VitalOptions } from './telemetry/web-vitals.js';
export * from './migration/index.js';
export * from './api/index.js';
