import type { Logger } from '@hcm/shared';

import type { AdminDirectory } from './admin-directory.js';
import type { AuthAdmin } from './auth-admin.js';
import type { BlobReader } from './blob-reader.js';
import type { BlobStore } from './blob-store.js';
import type { BlobWriter } from './blob-writer.js';
import type { Clock } from './clock.js';
import type { CloudRunJobs } from './cloud-run-jobs.js';
import type { DocumentStore } from './documents.js';
import type { ErrorReporter } from './error-reporter.js';
import type { ExportKit } from './export-kit.js';
import type { FirebaseManagement } from './firebase-management.js';
import type { Geocoder } from './geocoder.js';
import type { GoogleIam } from './google-iam.js';
import type { ImageProcessor } from './image-processor.js';
import type { MapboxApi } from './mapbox-api.js';
import type { MapboxTilesets } from './mapbox-tilesets.js';
import type { MapboxUploads } from './mapbox-uploads.js';
import type { PushSender } from './push-sender.js';
import type { RemoteFiles } from './remote-files.js';
import type { RuntimeConfig } from './runtime-config.js';
import type { SecretStore } from './secret-store.js';
import type { SetupRecords } from './setup-records.js';
import type { StarterTemplates } from './starter-templates.js';
import type { TaskQueue } from './task-queue.js';
import type { Translator } from './translator.js';
import type { UsgsApi } from './usgs-api.js';
import type { UrlSigner } from './url-signer.js';
import type { UsgsScenes } from './usgs-scenes.js';

/**
 * Every outside dependency of the handlers (docs/research/M2-interfaces.md §4). A handler declares the ports it uses
 * with `Pick<Ports, ...>`; tests pass the in-memory fakes of `functions/test/support/`, deps.ts (the composition root,
 * owned by the integrator) passes the adapters. Two M0 ports stay beside `documents`: `admins` is the bare existence
 * check of `admins/{uid}` (like the rules' `exists()`, used by the access rule of `functions/src/api/access.ts`),
 * `setup` the lenient read of `setup/status` (`setup.status` projects it field by field, so one malformed field never
 * breaks the Setup Assistant); every write of either document goes through `documents` and its strict schema.
 */
export interface Ports {
    readonly log: Logger;
    readonly clock: Clock;
    readonly config: RuntimeConfig;
    readonly documents: DocumentStore;
    readonly auth: AuthAdmin;
    readonly secrets: SecretStore;
    readonly iam: GoogleIam;
    readonly firebase: FirebaseManagement;
    readonly errors: ErrorReporter;
    readonly tasks: TaskQueue;
    readonly blobs: BlobStore;
    readonly images: ImageProcessor;
    readonly mapbox: MapboxApi;
    readonly usgs: UsgsApi;
    readonly jobs: CloudRunJobs;
    /** M3 (docs/research/M3-interfaces.md §9): MTS publishing, USGS scenes, outside addresses from data, large reads. */
    readonly tilesets: MapboxTilesets;
    readonly scenes: UsgsScenes;
    readonly remote: RemoteFiles;
    readonly reader: BlobReader;
    /** M4 (docs/research/M4-interfaces.md §4, §5): Nominatim, Vertex AI Gemini, FCM web push. */
    readonly geocoder: Geocoder;
    readonly translator: Translator;
    readonly push: PushSender;
    /** M5 (docs/research/M5-interfaces.md §5): the static export's streamed zip, its signed download, the kit it carries. */
    readonly writer: BlobWriter;
    readonly signer: UrlSigner;
    readonly kit: ExportKit;
    /** M7 (docs/research/M7-local-worker.md §6): Mapbox's Uploads API, the free publish path of a small file. */
    readonly uploads: MapboxUploads;
    /** Finding 73 of 2026-11-03: the starter files' templates `worker.starter` fills. */
    readonly starters: StarterTemplates;
    readonly admins: AdminDirectory;
    readonly setup: SetupRecords;
}
