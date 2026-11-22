/**
 * Every function of the M2 backend in one table (`docs/research/M2-interfaces.md` §3): the callables with their access
 * rule, App Check mode and zod request/response, the public HTTPS endpoint, and the background functions. The
 * functions validate every request and response against it, the admin calls `httpsCallable(functions,
 * deployedName(name))` and validates the answer, the integrator's `functions/src/index.ts` exports exactly these names
 * (its test compares them), and the e2e mock server answers from the same schemas.
 */
import type { z } from 'zod';

import { imageryArchiveImportRequestSchema, imageryArchiveImportResponseSchema } from './archive.js';
import {
    imageryAcceptLayoutRequestSchema,
    imageryLayoutResponseSchema,
    imageryRelayoutRequestSchema,
    imagerySaveLayoutRequestSchema,
} from './imagery-tiles.js';
import {
    claimRequestSchema,
    claimResponseSchema,
    inviteResponseSchema,
    joinRequestSchema,
    joinResponseSchema,
    revokeResponseSchema,
    sessionRequestSchema,
    sessionResponseSchema,
} from './admin.js';
import {
    citiesCreateRequestSchema,
    citiesCreateResponseSchema,
    citiesLocateRequestSchema,
    citiesLocateResponseSchema,
    citiesSetLimitsRequestSchema,
    citiesSetLimitsResponseSchema,
    cityAdminsListRequestSchema,
    cityAdminsListResponseSchema,
    cityInviteRequestSchema,
    cityRevokeRequestSchema,
    citySetRoleRequestSchema,
    citySetRoleResponseSchema,
} from './cities.js';
import { cityIconRequestSchema, cityIconResponseSchema } from './city-icon.js';
import {
    EXPORT_QUEUE,
    exportDownloadRequestSchema,
    exportDownloadResponseSchema,
    exportStartRequestSchema,
    exportStartResponseSchema,
} from './city-export.js';
import {
    MANIFEST_QUEUE,
    OPS_TICK_SCHEDULE,
    rebuildManifestRequestSchema,
    rebuildManifestResponseSchema,
    reprocessPhotoRequestSchema,
    reprocessPhotoResponseSchema,
} from './content.js';
import { COMMUNITY_CALLABLES } from './community.js';
import { revertRequestSchema, revertResponseSchema } from './history.js';
import { wikipediaManageRequestSchema, wikipediaManageResponseSchema } from './wikipedia.js';
import { ASSIST_GEOCODE_QUEUE } from '../schemas/assist.js';
import {
    IMAGERY_PUBLISH_QUEUE,
    IMAGERY_TICK_SCHEDULE,
    imageryApproveResponseSchema,
    imageryBrowseRequestSchema,
    imageryBrowseResponseSchema,
    imageryMarkSceneRequestSchema,
    imageryMarkSceneResponseSchema,
    imageryChooseRequestSchema,
    imageryChooseResponseSchema,
    imageryConfirmRightsRequestSchema,
    imageryConfirmRightsResponseSchema,
    imageryDeleteVersionResponseSchema,
    imageryCropRequestSchema,
    imageryCropResponseSchema,
    imageryImportRequestSchema,
    imageryImportResponseSchema,
    imageryJoinRequestSchema,
    imageryJoinResponseSchema,
    imageryProbeRequestSchema,
    imageryProbeResponseSchema,
    imageryRejectResponseSchema,
    imageryResumeGuardRequestSchema,
    imageryResumeGuardResponseSchema,
    imageryRetryRequestSchema,
    imageryRetryResponseSchema,
    imagerySaveGcpsRequestSchema,
    imagerySaveGcpsResponseSchema,
    imagerySearchRequestSchema,
    imagerySearchResponseSchema,
    imageryPreviewUrlResponseSchema,
    imageryStudioDoneResponseSchema,
    imageryVersionRequestSchema,
    imageryApproveRequestSchema,
    imageryRecalibrateRequestSchema,
    imageryRecalibrateResponseSchema,
} from './imagery.js';
import {
    assistSuggestTitleRequestSchema,
    assistSuggestTitleResponseSchema,
    assistTranslateDraftRequestSchema,
    assistTranslateDraftResponseSchema,
} from './assist.js';
import {
    notifyRegisterDeviceRequestSchema,
    notifyRegisterDeviceResponseSchema,
    notifySendTestRequestSchema,
    notifySendTestResponseSchema,
    notifyUnregisterDeviceRequestSchema,
    notifyUnregisterDeviceResponseSchema,
} from './notify.js';
import { layerDeleteRequestSchema, layerDeleteResponseSchema, layerLinkRequestSchema, layerLinkResponseSchema } from './layers.js';
import {
    usgsCancelOrderRequestSchema,
    usgsCancelOrderResponseSchema,
    usgsCheckOrderRequestSchema,
    usgsCheckOrderResponseSchema,
    usgsMarkOrderedRequestSchema,
    usgsMarkOrderedResponseSchema,
} from './orders.js';
import {
    analyticsConfigRequestSchema,
    analyticsConfigResponseSchema,
    createCityRequestSchema,
    createCityResponseSchema,
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
    statusRequestSchema,
    setupStatusViewSchema,
} from './setup.js';
import { workerManageRequestSchema, workerManageResponseSchema } from './worker-manage.js';
import { ERROR_REPORT_MAX_BYTES, errorReportSchema, listGroupsRequestSchema, listGroupsResponseSchema } from './telemetry.js';
import {
    imageryPauseRequestSchema,
    imageryPauseResponseSchema,
    imageryRunOnRequestSchema,
    imageryRunOnResponseSchema,
    workerPairCodeRequestSchema,
    workerPairCodeResponseSchema,
    workerRevokeRequestSchema,
    workerRevokeResponseSchema,
    workerStarterQuerySchema,
} from './worker.js';

/**
 * The workstreams that implement the functions (`docs/research/M2-interfaces.md` §5; `fn-imagery`:
 * `docs/research/M3-interfaces.md` §9, the M3 raster backend; `fn-orders` and `fn-assist-notify`:
 * `docs/research/M4-interfaces.md` §6, the M4 orders, assists and notifications; `fn-cities`:
 * `docs/research/M5-interfaces.md` §6, the M5 multi-city workstream; `fn-export`: the M5 static export, §5; `fn-worker`:
 * `docs/research/M7-local-worker.md` §2.4, the local worker's callables).
 */
export const FUNCTION_OWNERS = [
    'fn-admin',
    'fn-setup',
    'fn-content',
    'fn-imagery',
    'fn-orders',
    'fn-assist-notify',
    'fn-cities',
    'fn-export',
    'fn-worker',
] as const;
export type FunctionOwner = (typeof FUNCTION_OWNERS)[number];

/**
 * `signedIn`: a verified Google account (`email_verified`, `sign_in_provider == 'google.com'`), admin or not.
 * `admin`: also the `admin` claim and an `admins/{uid}` document (the rules' `isAdmin()`).
 * M5 (`docs/research/M5-interfaces.md` §1.3), each an `admin` too: `cityEditor` has a role in the request's `cityId`,
 * `cityOwner` owns it (both checked once the request is valid, before the handler reads anything), `projectOwner` is the
 * account that claimed the project (`admins/{uid}.role == 'owner'`).
 * M13 (`docs/research/M13-roles.md` §1): `cityEditor` is an owner or an editor, `cityReviewer` adds a moderator, `admin` leaves
 * out an account whose every role is `moderator` or `uploader`, and `member` is any admin document (the push devices only).
 * `none` (finding 67 of 2026-11-02): no sign-in at all, for `worker.pair` only, whose one-time code is the credential.
 */
export type CallableAccess = 'signedIn' | 'member' | 'admin' | 'cityEditor' | 'cityReviewer' | 'cityOwner' | 'projectOwner' | 'none';

/** The accesses that name a city: their requests carry `cityId` at the top level (the registry's test checks it). */
export const CITY_ACCESSES: readonly CallableAccess[] = ['cityEditor', 'cityReviewer', 'cityOwner'];

/**
 * `consume`: a replay-protected App Check token (`consumeAppCheckToken`), for ownership and secret pastes. `off` (M7,
 * `docs/research/M7-local-worker.md` §2.4, §10.6): no App Check, for the local worker's callables only, which a process
 * on the owner's computer calls (nothing can attest it); each is bound to the one job that worker claimed.
 */
export type AppCheckMode = 'enforce' | 'consume' | 'off';

export interface CallableSpec {
    readonly access: CallableAccess;
    readonly appCheck: AppCheckMode;
    readonly maxInstances: number;
    readonly request: z.ZodType;
    readonly response: z.ZodType;
    readonly owner: FunctionOwner;
    /**
     * Finding 67: the callable also admits the token of a worker paired for the request's city (`worker: true`, `city`,
     * `pair` claims, signed in with a custom token), besides a city editor's Google sign-in. Only the worker's callables.
     */
    readonly workerToken?: true;
}

/** An admin-only callable (`access: 'admin'`, three instances at most), its schemas keeping their types. */
function adminCallable<Request extends z.ZodType, Response extends z.ZodType>(
    owner: FunctionOwner,
    request: Request,
    response: Response,
    appCheck: AppCheckMode = 'enforce',
) {
    return { access: 'admin', appCheck, maxInstances: 3, request, response, owner } as const;
}

/** The row builder of one of M5's narrower accesses (`docs/research/M5-interfaces.md` §1.3), otherwise as `adminCallable`. */
function scoped<Access extends CallableAccess>(access: Access) {
    return <Request extends z.ZodType, Response extends z.ZodType>(
        owner: FunctionOwner,
        request: Request,
        response: Response,
        appCheck: AppCheckMode = 'enforce',
    ) => ({ access, appCheck, maxInstances: 3, request, response, owner }) as const;
}

const memberCallable = scoped('member');
const cityEditor = scoped('cityEditor');
const cityReviewer = scoped('cityReviewer');
const cityOwner = scoped('cityOwner');
const projectOwner = scoped('projectOwner');

/**
 * The callables the admin calls (every one but the local worker's five), with the schemas it validates their answers
 * with. The whole table, the worker's rows included, is `CALLABLES` (`callables.ts`), which the functions and the tests
 * read; the admin imports this one and `CALLABLE_NAMES`, so the worker's schemas stay out of its bundle (M7).
 */
export const ADMIN_CALLABLES = {
    'admin.session': {
        access: 'signedIn',
        appCheck: 'enforce',
        maxInstances: 3,
        request: sessionRequestSchema,
        response: sessionResponseSchema,
        owner: 'fn-admin',
    },
    'admin.claim': {
        access: 'signedIn',
        appCheck: 'consume',
        maxInstances: 2,
        request: claimRequestSchema,
        response: claimResponseSchema,
        owner: 'fn-admin',
    },
    'admin.join': {
        access: 'signedIn',
        appCheck: 'consume',
        maxInstances: 2,
        request: joinRequestSchema,
        response: joinResponseSchema,
        owner: 'fn-admin',
    },
    // M5 (docs/research/M5-interfaces.md §1.3, §1.7): a city's owner invites, removes and sets its admins' roles; its
    // members list them.
    'admins.invite': cityOwner('fn-admin', cityInviteRequestSchema, inviteResponseSchema),
    'admins.revoke': cityOwner('fn-admin', cityRevokeRequestSchema, revokeResponseSchema),
    'admins.list': cityEditor('fn-admin', cityAdminsListRequestSchema, cityAdminsListResponseSchema),
    // M13: a moderator reverts a photo or a place only; the handler checks the entity.
    'history.revert': cityReviewer('fn-admin', revertRequestSchema, revertResponseSchema),
    'telemetry.listGroups': adminCallable('fn-admin', listGroupsRequestSchema, listGroupsResponseSchema),
    'setup.status': adminCallable('fn-setup', statusRequestSchema, setupStatusViewSchema),
    'setup.selfTest': adminCallable('fn-setup', selfTestRequestSchema, selfTestResponseSchema),
    // M5: the project's own settings are its owner's (docs/research/M5-interfaces.md §1.3); a city's viewer token is its owner's.
    'setup.recordCloud': projectOwner('fn-setup', recordCloudRequestSchema, recordCloudResponseSchema),
    'setup.createCity': projectOwner('fn-setup', createCityRequestSchema, createCityResponseSchema),
    'setup.saveMapbox': projectOwner('fn-setup', saveMapboxRequestSchema, saveMapboxResponseSchema, 'consume'),
    'setup.saveUsgs': projectOwner('fn-setup', saveUsgsRequestSchema, saveUsgsResponseSchema, 'consume'),
    'setup.rotatePublicToken': cityOwner('fn-setup', rotatePublicTokenRequestSchema, rotatePublicTokenResponseSchema, 'consume'),
    'setup.analyticsConfig': projectOwner('fn-setup', analyticsConfigRequestSchema, analyticsConfigResponseSchema),
    'publish.rebuildManifest': cityEditor('fn-content', rebuildManifestRequestSchema, rebuildManifestResponseSchema),
    // M31 (docs/research/M31-wikipedia.md §3): the Wikipedia overlay's settings, articles and refresh.
    'wikipedia.manage': cityEditor('fn-content', wikipediaManageRequestSchema, wikipediaManageResponseSchema),
    'photos.reprocess': cityEditor('fn-content', reprocessPhotoRequestSchema, reprocessPhotoResponseSchema),
    'layers.delete': cityEditor('fn-content', layerDeleteRequestSchema, layerDeleteResponseSchema, 'consume'),
    'layers.link': cityEditor('fn-content', layerLinkRequestSchema, layerLinkResponseSchema),
    'imagery.search': cityEditor('fn-imagery', imagerySearchRequestSchema, imagerySearchResponseSchema),
    'imagery.browse': cityEditor('fn-imagery', imageryBrowseRequestSchema, imageryBrowseResponseSchema),
    'imagery.markScene': cityEditor('fn-imagery', imageryMarkSceneRequestSchema, imageryMarkSceneResponseSchema),
    'imagery.import': cityEditor('fn-imagery', imageryImportRequestSchema, imageryImportResponseSchema),
    'imagery.approve': cityEditor('fn-imagery', imageryApproveRequestSchema, imageryApproveResponseSchema),
    'imagery.reject': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryRejectResponseSchema),
    // M20 (§7): only the city's owner confirms a version whose rights wait, so Approve is never stranded.
    'imagery.confirmRights': cityOwner('fn-imagery', imageryConfirmRightsRequestSchema, imageryConfirmRightsResponseSchema),
    // A version that never reached the map, deleted with its job, its log and its own files (S-A125-*).
    'imagery.deleteVersion': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryDeleteVersionResponseSchema),
    'imagery.choose': cityEditor('fn-imagery', imageryChooseRequestSchema, imageryChooseResponseSchema, 'consume'),
    'imagery.studioDone': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryStudioDoneResponseSchema),
    'imagery.saveGcps': cityEditor('fn-imagery', imagerySaveGcpsRequestSchema, imagerySaveGcpsResponseSchema),
    'imagery.crop': cityEditor('fn-imagery', imageryCropRequestSchema, imageryCropResponseSchema),
    'imagery.join': cityEditor('fn-imagery', imageryJoinRequestSchema, imageryJoinResponseSchema),
    'imagery.retry': cityEditor('fn-imagery', imageryRetryRequestSchema, imageryRetryResponseSchema),
    // A frame waiting for points searches again (`functions/src/imagery/locate-again.ts`): what the version page already sends, what Retry answers.
    'imagery.locateAgain': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryRetryResponseSchema),
    // The tile-import wizard (docs/research/M20-import-local.md §19.10): the owner's layout of a series waiting with `layout-check`.
    'imagery.saveLayout': cityEditor('fn-imagery', imagerySaveLayoutRequestSchema, imageryLayoutResponseSchema),
    'imagery.acceptLayout': cityEditor('fn-imagery', imageryAcceptLayoutRequestSchema, imageryLayoutResponseSchema),
    // M20 §19.13: Fix the tiles, a new version of a placed archive series reopened at its tile layout.
    'imagery.relayout': cityEditor('fn-imagery', imageryRelayoutRequestSchema, imageryLayoutResponseSchema),
    // M12 (docs/research/M12-own-tiles.md): the private archive, signed for an hour, so an image is seen before it is approved.
    'imagery.previewUrl': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryPreviewUrlResponseSchema),
    // M16 (docs/research/M16-recalibrate.md): Refine automatically, or the admin's rough points snapped, on a published layer.
    'imagery.recalibrate': cityEditor('fn-imagery', imageryRecalibrateRequestSchema, imageryRecalibrateResponseSchema),
    'imagery.probeTiles': cityEditor('fn-imagery', imageryProbeRequestSchema, imageryProbeResponseSchema),
    // M5: the budget guard is the project's (docs/research/M5-interfaces.md §1.3).
    'imagery.resumeGuard': projectOwner('fn-imagery', imageryResumeGuardRequestSchema, imageryResumeGuardResponseSchema, 'consume'),
    // M4 orders (owner fn-orders, docs/research/M4-interfaces.md §1.4): "I ordered it", "Check now", "Take the mark back".
    'usgs.markOrdered': cityEditor('fn-orders', usgsMarkOrderedRequestSchema, usgsMarkOrderedResponseSchema),
    'usgs.checkOrder': cityEditor('fn-orders', usgsCheckOrderRequestSchema, usgsCheckOrderResponseSchema),
    'usgs.cancelOrder': cityEditor('fn-orders', usgsCancelOrderRequestSchema, usgsCancelOrderResponseSchema),
    // M4 assists and notifications (owner fn-assist-notify, docs/research/M4-interfaces.md §4, §5).
    'assist.suggestTitle': cityEditor('fn-assist-notify', assistSuggestTitleRequestSchema, assistSuggestTitleResponseSchema),
    'assist.translateDraft': cityEditor('fn-assist-notify', assistTranslateDraftRequestSchema, assistTranslateDraftResponseSchema),
    'notify.registerDevice': memberCallable('fn-assist-notify', notifyRegisterDeviceRequestSchema, notifyRegisterDeviceResponseSchema),
    'notify.unregisterDevice': memberCallable(
        'fn-assist-notify',
        notifyUnregisterDeviceRequestSchema,
        notifyUnregisterDeviceResponseSchema,
    ),
    'notify.sendTest': memberCallable('fn-assist-notify', notifySendTestRequestSchema, notifySendTestResponseSchema),
    // M5 many cities (owner fn-cities, docs/research/M5-interfaces.md §1.3, §1.6 to §1.8): the project owner creates cities
    // and sets their budgets; a city's owner sets its admins' roles.
    'cities.create': projectOwner('fn-cities', citiesCreateRequestSchema, citiesCreateResponseSchema),
    'cities.locate': projectOwner('fn-cities', citiesLocateRequestSchema, citiesLocateResponseSchema),
    'cities.setLimits': projectOwner('fn-cities', citiesSetLimitsRequestSchema, citiesSetLimitsResponseSchema),
    // The city's browser tab icon (docs/research/M2-interfaces.md → The city's tab icon): its editors change it, as the theme.
    'cities.setIcon': cityEditor('fn-cities', cityIconRequestSchema, cityIconResponseSchema),
    'admins.setRole': cityOwner('fn-admin', citySetRoleRequestSchema, citySetRoleResponseSchema),
    // M5 static export (owner fn-export, docs/research/M5-interfaces.md §5.3): a city's owners export it and download it.
    'export.start': cityOwner('fn-export', exportStartRequestSchema, exportStartResponseSchema),
    'export.download': cityOwner('fn-export', exportDownloadRequestSchema, exportDownloadResponseSchema),
    // M7 (docs/research/M7-local-worker.md §3): the admin's choice of where a job runs. The local worker's five callables
    // are `WORKER_CALLABLES` (worker-calls.ts).
    'imagery.runOn': cityEditor('fn-imagery', imageryRunOnRequestSchema, imageryRunOnResponseSchema),
    // Pause (the owner's request of 2026-11-13): pause and resume a job, every job, or a computer.
    'imagery.pause': cityEditor('fn-imagery', imageryPauseRequestSchema, imageryPauseResponseSchema),
    // M20 (docs/research/M20-import-local.md §8): one click imports an archive's series; the worker reports them (worker-calls.ts).
    'imagery.archiveImport': cityEditor('fn-imagery', imageryArchiveImportRequestSchema, imageryArchiveImportResponseSchema),
    // Finding 67 of 2026-11-02: the worker command's one-time pairing code, and Disconnect this computer.
    'worker.pairCode': cityEditor('fn-worker', workerPairCodeRequestSchema, workerPairCodeResponseSchema),
    'worker.revoke': cityEditor('fn-worker', workerRevokeRequestSchema, workerRevokeResponseSchema),
    // W5 (household computers): Rename, Pause and Resume in the admin's list of the city's computers.
    'worker.manage': cityEditor('fn-worker', workerManageRequestSchema, workerManageResponseSchema),
    // M13 (docs/research/M13-roles.md): the Contribute page, the review queue, the suggestions.
    ...COMMUNITY_CALLABLES,
} as const satisfies Readonly<Record<string, CallableSpec>>;

export type AdminCallableName = keyof typeof ADMIN_CALLABLES;

/** The local worker's callables (M7, `docs/research/M7-local-worker.md` §2.4): their rows are `WORKER_CALLABLES`. */
export const WORKER_CALLABLE_NAMES = [
    'worker.hello',
    'worker.claim',
    'worker.step',
    'worker.urls',
    'worker.end',
    'worker.archiveReport',
    'worker.archiveCopy',
    'worker.pair',
    'worker.image',
] as const;
export type WorkerCallableName = (typeof WORKER_CALLABLE_NAMES)[number];

/** Every callable's name, the admin's and the worker's: what a deployment holds (`CALLABLES`' keys, its test checks). */
export const CALLABLE_NAMES: readonly string[] = [...Object.keys(ADMIN_CALLABLES), ...WORKER_CALLABLE_NAMES];

/** The public HTTPS endpoints (`onRequest`): no Firebase SDK on the caller's side. */
export const HTTP_ENDPOINTS = {
    'telemetry.reportError': {
        method: 'POST',
        maxBytes: ERROR_REPORT_MAX_BYTES,
        maxInstances: 2,
        request: errorReportSchema,
        owner: 'fn-admin',
    },
    /** Finding 73 of 2026-11-03: the starter file of "Use this computer", as a download (its query, no body). */
    'worker.starter': {
        method: 'GET',
        maxBytes: 0,
        maxInstances: 2,
        request: workerStarterQuerySchema,
        owner: 'fn-worker',
    },
} as const;

export type BackgroundTrigger = 'firestore' | 'storage' | 'taskQueue' | 'schedule' | 'pubsub';

/** Functions nobody calls: what triggers them, and who builds them. */
export const BACKGROUND_FUNCTIONS = {
    'history.onCityWrite': { trigger: 'firestore', source: 'cities/{city}', owner: 'fn-admin' },
    'history.onLayerWrite': { trigger: 'firestore', source: 'cities/{city}/layers/{id}', owner: 'fn-admin' },
    'history.onPhotoWrite': { trigger: 'firestore', source: 'cities/{city}/photos/{id}', owner: 'fn-admin' },
    'history.onPoiWrite': { trigger: 'firestore', source: 'cities/{city}/pois/{id}', owner: 'fn-admin' },
    'history.onPoiCategoryWrite': { trigger: 'firestore', source: 'cities/{city}/poiCategories/{id}', owner: 'fn-admin' },
    // M17 (docs/research/M17-stories.md §2): stories keep their versions and rebuild the manifest as places do.
    'history.onStoryWrite': { trigger: 'firestore', source: 'cities/{city}/stories/{id}', owner: 'fn-admin' },
    'publish.onCityWrite': { trigger: 'firestore', source: 'cities/{city}', owner: 'fn-content' },
    'publish.onLayerWrite': { trigger: 'firestore', source: 'cities/{city}/layers/{id}', owner: 'fn-content' },
    'publish.onPhotoWrite': { trigger: 'firestore', source: 'cities/{city}/photos/{id}', owner: 'fn-content' },
    'publish.onPoiWrite': { trigger: 'firestore', source: 'cities/{city}/pois/{id}', owner: 'fn-content' },
    'publish.onPoiCategoryWrite': { trigger: 'firestore', source: 'cities/{city}/poiCategories/{id}', owner: 'fn-content' },
    'publish.onStoryWrite': { trigger: 'firestore', source: 'cities/{city}/stories/{id}', owner: 'fn-content' },
    'publish.buildManifest': { trigger: 'taskQueue', source: MANIFEST_QUEUE, owner: 'fn-content' },
    'photos.onUpload': { trigger: 'storage', source: 'uploads/photos/{city}/{uid}/{photo}/{file}', owner: 'fn-content' },
    'ops.tick': { trigger: 'schedule', source: OPS_TICK_SCHEDULE, owner: 'fn-content' },
    'ops.onBudget': { trigger: 'pubsub', source: 'budget', owner: 'fn-content' },
    // M6 (docs/research/M6-interfaces.md §3.2): answers the self-test's events probe, so a missing run.invoker shows.
    'ops.onProbe': { trigger: 'firestore', source: 'ops/probe', owner: 'fn-content' },
    'imagery.onJobWrite': { trigger: 'firestore', source: 'cities/{city}/jobs/{id}', owner: 'fn-imagery' },
    'imagery.onRasterUpload': { trigger: 'storage', source: 'uploads/rasters/{city}/{uid}/{upload}/{file}', owner: 'fn-imagery' },
    'imagery.publish': { trigger: 'taskQueue', source: IMAGERY_PUBLISH_QUEUE, owner: 'fn-imagery' },
    'imagery.tick': { trigger: 'schedule', source: IMAGERY_TICK_SCHEDULE, owner: 'fn-imagery' },
    // M4 assists and notifications (owner fn-assist-notify).
    'assist.geocode': { trigger: 'taskQueue', source: ASSIST_GEOCODE_QUEUE, owner: 'fn-assist-notify' },
    'notify.onEvent': { trigger: 'firestore', source: 'notificationEvents/{eventId}', owner: 'fn-assist-notify' },
    // M5 static export (owner fn-export): the zip's build, one task per export.
    'export.build': { trigger: 'taskQueue', source: EXPORT_QUEUE, owner: 'fn-export' },
} as const satisfies Readonly<Record<string, { trigger: BackgroundTrigger; source: string; owner: FunctionOwner }>>;

/** Firebase names a function after its export path: the namespace `admin` and the export `claim` deploy as `admin-claim`. */
export function deployedName(name: string): string {
    return name.replace('.', '-');
}
