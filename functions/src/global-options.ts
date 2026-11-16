import type { BACKGROUND_FUNCTIONS, CallableName, HTTP_ENDPOINTS } from '@hcm/shared';
import { setGlobalOptions, type GlobalOptions } from 'firebase-functions/options';

/** Every function of the registry (`@hcm/shared` → `CALLABLES`, `HTTP_ENDPOINTS`, `BACKGROUND_FUNCTIONS`). */
export type FunctionName = CallableName | keyof typeof HTTP_ENDPOINTS | keyof typeof BACKGROUND_FUNCTIONS;

/** The runtime service accounts of security review §1.1 (created by the bootstrap; never the compute default). */
export type RuntimeAccount = 'fn-admin' | 'fn-events' | 'fn-crash';

/**
 * Who each function runs as (security review §1.1, `docs/research/M2-interfaces.md` §4.3, CR-M2-8, CR-M2-13,
 * CR-M2-29). `fn-admin@` holds the secrets, Firebase Auth and the Management and Error Reporting viewer roles, so it
 * runs every callable and `ops.*` (`DECISIONS-for-review.md` §19b: the tick retires Mapbox tokens and deletes stale
 * accounts); `fn-events@` runs the Firestore and Storage triggers and the manifest builder; `fn-crash@`, an account with
 * no role at all, runs the public crash endpoint, which only writes a log entry (Cloud Run collects a function's own
 * log lines without a role; `DECISIONS-for-review.md` §42f). A new registry name fails to compile until it is listed here.
 */
export const RUNTIME_ACCOUNTS: Readonly<Record<FunctionName, RuntimeAccount>> = {
    'admin.session': 'fn-admin',
    'admin.claim': 'fn-admin',
    'admin.join': 'fn-admin',
    'admins.invite': 'fn-admin',
    'admins.revoke': 'fn-admin',
    'admins.list': 'fn-admin',
    'history.revert': 'fn-admin',
    'telemetry.listGroups': 'fn-admin',
    'setup.status': 'fn-admin',
    'setup.selfTest': 'fn-admin',
    'setup.recordCloud': 'fn-admin',
    'setup.createCity': 'fn-admin',
    'setup.saveMapbox': 'fn-admin',
    'setup.saveUsgs': 'fn-admin',
    'setup.rotatePublicToken': 'fn-admin',
    'setup.analyticsConfig': 'fn-admin',
    'publish.rebuildManifest': 'fn-admin',
    'photos.reprocess': 'fn-admin',
    'layers.delete': 'fn-admin',
    'layers.link': 'fn-admin',
    'telemetry.reportError': 'fn-crash',
    'history.onCityWrite': 'fn-events',
    'history.onLayerWrite': 'fn-events',
    'history.onPhotoWrite': 'fn-events',
    'history.onPoiWrite': 'fn-events',
    'history.onPoiCategoryWrite': 'fn-events',
    'history.onStoryWrite': 'fn-events',
    'publish.onCityWrite': 'fn-events',
    'publish.onLayerWrite': 'fn-events',
    'publish.onPhotoWrite': 'fn-events',
    'publish.onPoiWrite': 'fn-events',
    'publish.onPoiCategoryWrite': 'fn-events',
    'publish.onStoryWrite': 'fn-events',
    'publish.buildManifest': 'fn-events',
    'photos.onUpload': 'fn-events',
    'ops.tick': 'fn-admin',
    'ops.onBudget': 'fn-admin',
    // M6 (docs/research/M6-interfaces.md §3.2): the events probe is delivered by Eventarc, so it runs as the trigger account.
    'ops.onProbe': 'fn-events',
    'imagery.search': 'fn-admin',
    'imagery.browse': 'fn-admin',
    'imagery.markScene': 'fn-admin',
    'imagery.listSuperseded': 'fn-admin',
    'imagery.deleteSuperseded': 'fn-admin',
    'imagery.import': 'fn-admin',
    'imagery.approve': 'fn-admin',
    'imagery.reject': 'fn-admin',
    'imagery.confirmRights': 'fn-admin',
    'imagery.deleteVersion': 'fn-admin',
    'imagery.choose': 'fn-admin',
    'imagery.studioDone': 'fn-admin',
    'imagery.saveGcps': 'fn-admin',
    'imagery.crop': 'fn-admin',
    'imagery.join': 'fn-admin',
    'imagery.retry': 'fn-admin',
    'imagery.locateAgain': 'fn-admin',
    'imagery.saveLayout': 'fn-admin',
    'imagery.acceptLayout': 'fn-admin',
    'imagery.previewUrl': 'fn-admin',
    'imagery.recalibrate': 'fn-admin',
    'imagery.runOn': 'fn-admin',
    'imagery.pause': 'fn-admin',
    'imagery.archiveImport': 'fn-admin',
    'imagery.probeTiles': 'fn-admin',
    'imagery.resumeGuard': 'fn-admin',
    // M4 orders (docs/research/M4-interfaces.md §1.4): the order card's callables, as every callable, fn-admin@ (USGS secrets).
    'usgs.markOrdered': 'fn-admin',
    'usgs.checkOrder': 'fn-admin',
    'usgs.cancelOrder': 'fn-admin',
    'imagery.onJobWrite': 'fn-events',
    'imagery.onRasterUpload': 'fn-events',
    'imagery.publish': 'fn-events',
    'imagery.tick': 'fn-events',
    // M4 assists and notifications (docs/research/M4-interfaces.md §4.4): the callables as fn-admin@ (Vertex AI, FCM's
    // dry run), the Nominatim queue's worker and the fan-out (FCM sends) as fn-events@.
    'assist.suggestTitle': 'fn-admin',
    'assist.translateDraft': 'fn-admin',
    'notify.registerDevice': 'fn-admin',
    'notify.unregisterDevice': 'fn-admin',
    'notify.sendTest': 'fn-admin',
    'assist.geocode': 'fn-events',
    'notify.onEvent': 'fn-events',
    // M5 many cities (docs/research/M5-interfaces.md §1.3): the project owner's cities callables and a city owner's roles.
    'cities.create': 'fn-admin',
    'cities.locate': 'fn-admin',
    'cities.setLimits': 'fn-admin',
    'cities.setIcon': 'fn-admin',
    'admins.setRole': 'fn-admin',
    // M13 (docs/research/M13-roles.md).
    'contribute.context': 'fn-admin',
    'contribute.request': 'fn-admin',
    'contribute.decide': 'fn-admin',
    'review.decide': 'fn-admin',
    'suggestions.submit': 'fn-admin',
    'suggestions.decide': 'fn-admin',
    'contributors.setBlocked': 'fn-admin',
    // M5 static export (docs/research/M5-interfaces.md §5.3, §5.5): the callables as fn-admin@, which signs the download
    // address with its own signBlob; the build as fn-events@, which reads the public bucket and writes the private one.
    'export.start': 'fn-admin',
    'export.download': 'fn-admin',
    'export.build': 'fn-events',
    // M7 (docs/research/M7-local-worker.md §2.4): the local worker's callables as fn-admin@, which reads the USGS secrets
    // for the M2M calls it makes for a worker and signs the worker's object addresses with its own signBlob.
    'worker.hello': 'fn-admin',
    'worker.claim': 'fn-admin',
    'worker.step': 'fn-admin',
    'worker.urls': 'fn-admin',
    'worker.end': 'fn-admin',
    // Finding 67 (docs/research/M7-local-worker.md §2.6): pairing mints a custom token with fn-admin@'s own signBlob.
    'worker.pair': 'fn-admin',
    'worker.pairCode': 'fn-admin',
    'worker.revoke': 'fn-admin',
    'worker.manage': 'fn-admin',
    // Finding 72: the starter's supervisor asks the installed image (finding 74: the job's, run.jobs.get, else setup/status).
    'worker.image': 'fn-admin',
    // Finding 73: the starter file itself, filled from the templates beside the bundle (no Google call).
    'worker.starter': 'fn-admin',
    'worker.archiveReport': 'fn-admin',
    'worker.archiveCopy': 'fn-admin',
};

/** What firebase-tools and Cloud Run set to the project while the code loads (discovery, the emulator, a cold start). */
type Environment = Readonly<Record<string, string | undefined>>;

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * The project the code is loaded for: `GCLOUD_PROJECT` (firebase-tools sets it for discovery, in Cloud Build as on a
 * terminal, and the emulator sets `demo-hcm`), else `GOOGLE_CLOUD_PROJECT`. Neither is a refusal naming both, never a
 * shorthand account (docs/research/M6-interfaces.md §3.2, S-A55-BAD-NO-PROJECT).
 */
function projectOf(env: Environment): string {
    const project = env['GCLOUD_PROJECT'] ?? env['GOOGLE_CLOUD_PROJECT'] ?? '';
    if (!PROJECT_ID.test(project)) {
        throw new Error('runAs: neither GCLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT names the project the functions are loaded for');
    }
    return project;
}

/**
 * The full e-mail address of a runtime account in the project the code is loaded for. Never firebase-tools' shorthand
 * `fn-admin@`: the function itself accepts it, but firebase-tools 15.33.0 copies it unexpanded into the Cloud Scheduler
 * job's `oidcToken.serviceAccountEmail`, which Scheduler refuses with 400 `INVALID_ARGUMENT`, so the jobs of `ops.tick`
 * and `imagery.tick` were never made (finding 11 of `docs/research/manual-test-2026-10-25.md`; S-A55-HAPPY-SCHEDULER-ACCOUNT).
 */
export function serviceAccountEmail(account: RuntimeAccount, env: Environment = process.env): string {
    return `${account}@${projectOf(env)}.iam.gserviceaccount.com`;
}

/** The deploy option that makes function `name` run as its account. Every trigger spreads it into its options. */
export function runAs(name: FunctionName, env: Environment = process.env): { readonly serviceAccount: string } {
    return { serviceAccount: serviceAccountEmail(RUNTIME_ACCOUNTS[name], env) };
}

/**
 * Defaults for every function (docs/research/PLAN.md "Region"; security review §3.4): everything in us-central1, next
 * to the nam5 Firestore and inside the free tier; a low instance cap as a spend guard (each function sets its own,
 * lower where the registry says so); Cloud Run's concurrency of 80 stated, so a later CPU change cannot silently turn
 * it into 1 (`photos.onUpload` takes one upload at a time); and `fn-events@`, the account with fewer rights, for a
 * function that forgot `runAs`, never the compute default account. Every trigger module imports this file first,
 * because firebase-functions reads the global options when a function is declared.
 */
export const GLOBAL_OPTIONS: GlobalOptions = {
    region: 'us-central1',
    maxInstances: 5,
    concurrency: 80,
    serviceAccount: serviceAccountEmail('fn-events'),
};

setGlobalOptions(GLOBAL_OPTIONS);
