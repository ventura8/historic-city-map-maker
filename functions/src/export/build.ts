import '../global-options.js';

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
    EXPORT_LIMITS,
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityExportDocSchema,
    exportTaskSchema,
    layerDocSchema,
    layerVersionDocSchema,
    publicObjectUrl,
    rasterExportable,
    systemWriter,
    timestampFromDate,
    validate,
    validateManifest,
    type CityExportDoc,
    type ExportTask,
    type Manifest,
} from '@hcm/shared';
import { onTaskDispatched } from 'firebase-functions/tasks';

import { ApiError } from '../api/api-error.js';
import { runAs } from '../global-options.js';
import type { BucketRole } from '../ports/blob-store.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { planExport, type ExportPlan, type ExportRaster, type PlannedEntry, type PlannedSource } from './plan.js';
import { ZipLimitError, zipMethodFor, zipStream, type ZipEntry } from './zip.js';

export type ExportBuildDeps = Pick<Ports, 'documents' | 'blobs' | 'reader' | 'writer' | 'kit' | 'clock' | 'log' | 'config'>;

export type BuildOutcome = 'ready' | 'failed' | 'skipped';

const DAY_MS = 86_400_000;

/** Object sizes are read this many at a time (a city may hold thousands of photo files). */
const STAT_CONCURRENCY = 16;

/** What the central directory and the headers add per entry at most (the name twice, the fixed parts, the descriptor). */
const ENTRY_OVERHEAD = 30 + 16 + 46;
const END_OVERHEAD = 22;

/** The export would pass `EXPORT_LIMITS.maxBytes`: `apiError.export.tooLarge {size, max}`. */
function tooLarge(size: number): ApiError {
    return new ApiError('apiError.export.tooLarge', { size: String(size), max: String(EXPORT_LIMITS.maxBytes) });
}

function recordPath(task: ExportTask): string {
    return FIRESTORE_PATHS.cityExport(task.cityId, task.exportId);
}

function stamped(deps: ExportBuildDeps, record: CityExportDoc, changes: Partial<CityExportDoc>): CityExportDoc {
    return { ...record, ...changes, updatedBy: systemWriter('export'), updatedAt: timestampFromDate(deps.clock.now()) };
}

/** `queued` → `building`; a redelivered task, or one whose record is gone or past queued, builds nothing. */
async function claim(deps: ExportBuildDeps, task: ExportTask): Promise<CityExportDoc | undefined> {
    return deps.documents.transaction(async (transaction) => {
        const record = await transaction.get(recordPath(task), cityExportDocSchema);
        if (record?.state !== 'queued') {
            return undefined;
        }
        const building = stamped(deps, record, { state: 'building', startedAt: timestampFromDate(deps.clock.now()) });
        await transaction.set(recordPath(task), cityExportDocSchema, building);
        return building;
    });
}

/** The city's published manifest, from the public bucket (`apiError.export.noManifest` when there is none). */
async function publishedManifest(deps: ExportBuildDeps, cityId: string): Promise<Manifest> {
    const bytes = await deps.blobs.read('public', STORAGE_PATHS.manifest(cityId)).catch((error: unknown) => {
        throw error instanceof UpstreamError && error.failure === 'notFound' ? new ApiError('apiError.export.noManifest') : error;
    });
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
    if (!manifest.ok) {
        throw new ApiError('apiError.internal');
    }
    return manifest.value;
}

/** The current version of a layer whose scan may travel (a USGS frame, `rasterExportable`), or undefined. */
async function exportableVersion(deps: ExportBuildDeps, cityId: string, layerId: string): Promise<string | undefined> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    return layer !== undefined && rasterExportable(layer.provenance) ? layer.currentVersion : undefined;
}

/** A layer's scan when it may travel: its current version's Cloud-Optimized GeoTIFF. */
async function rasterOf(deps: ExportBuildDeps, cityId: string, layerId: string): Promise<ExportRaster[]> {
    const versionId = await exportableVersion(deps, cityId, layerId);
    if (versionId === undefined) {
        return [];
    }
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
    return version?.output?.cogPath === undefined ? [] : [{ layerId, path: version.output.cogPath }];
}

/** What travels when the scans are asked for: a Mapbox layer's COG, or (M12) the archive a layer of its own is served from. */
interface Travelling {
    readonly rasters: readonly ExportRaster[];
    readonly archives: readonly string[];
}

async function archiveOf(deps: ExportBuildDeps, cityId: string, layerId: string): Promise<string[]> {
    return (await exportableVersion(deps, cityId, layerId)) === undefined ? [] : [layerId];
}

async function travellingOf(deps: ExportBuildDeps, cityId: string, manifest: Manifest, asked: boolean): Promise<Travelling> {
    if (!asked) {
        return { rasters: [], archives: [] };
    }
    const own = (layer: Manifest['layers'][number]) => layer.source.type === 'pmtiles';
    const [rasters, archives] = await Promise.all([
        Promise.all(manifest.layers.filter((layer) => !own(layer)).map((layer) => rasterOf(deps, cityId, layer.id))),
        Promise.all(manifest.layers.filter(own).map((layer) => archiveOf(deps, cityId, layer.id))),
    ]);
    return { rasters: rasters.flat(), archives: archives.flat() };
}

/**
 * The city's own tab icon at 32 px as a `data:` address for the page, or undefined (none yet, or unreadable): the page
 * then keeps the kit's default, the Layers panel's map glyph.
 */
async function cityIcon(deps: ExportBuildDeps, cityId: string): Promise<string | undefined> {
    const bytes = await deps.blobs.read('public', STORAGE_PATHS.cityIcon(cityId, 32)).catch(() => undefined);
    return bytes === undefined ? undefined : `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

async function prepare(deps: ExportBuildDeps, task: ExportTask, record: CityExportDoc): Promise<ExportPlan> {
    const manifest = await publishedManifest(deps, task.cityId);
    const [travelling, texts, engine, icon] = await Promise.all([
        travellingOf(deps, task.cityId, manifest, record.rasters),
        deps.kit.texts(),
        deps.kit.engineFiles(),
        cityIcon(deps, task.cityId),
    ]);
    return planExport({
        manifest,
        publicPrefix: publicObjectUrl(deps.config.buckets.public, ''),
        ...travelling,
        kitPage: texts.page,
        kitReadme: texts.readme,
        engine,
        madeAt: deps.clock.now(),
        ...(icon === undefined ? {} : { icon }),
    });
}

/** The size of one entry's bytes before compression (a missing object is `UpstreamError` `notFound`). */
async function sizeOf(deps: ExportBuildDeps, source: PlannedSource): Promise<number> {
    switch (source.kind) {
        case 'text':
            return Buffer.byteLength(source.text, 'utf8');
        case 'kit':
            return source.file.bytes;
        case 'object': {
            const stat = await deps.blobs.stat(source.bucket, source.path);
            if (stat === undefined) {
                throw new UpstreamError('cloud-storage', 'notFound', { status: 404 });
            }
            return stat.size;
        }
    }
}

/** One entry's share of the archive at most: its bytes uncompressed, its name twice and the zip's fixed records. */
async function entrySize(deps: ExportBuildDeps, entry: PlannedEntry): Promise<number> {
    return (await sizeOf(deps, entry.source)) + ENTRY_OVERHEAD + 2 * Buffer.byteLength(entry.name, 'utf8');
}

/** An upper bound of the archive's size: every file uncompressed, plus the zip's own records. */
async function measure(deps: ExportBuildDeps, entries: readonly PlannedEntry[]): Promise<number> {
    let total = END_OVERHEAD;
    for (let start = 0; start < entries.length; start += STAT_CONCURRENCY) {
        const sizes = await Promise.all(entries.slice(start, start + STAT_CONCURRENCY).map((entry) => entrySize(deps, entry)));
        total += sizes.reduce((sum, size) => sum + size, 0);
    }
    return total;
}

function textBytes(text: string): AsyncIterable<Uint8Array> {
    return Readable.from([Buffer.from(text, 'utf8')], { objectMode: false });
}

async function* objectBytes(
    deps: ExportBuildDeps,
    source: { readonly bucket: BucketRole; readonly path: string },
): AsyncGenerator<Uint8Array> {
    const opened = await deps.reader.open(source.bucket, source.path);
    yield* opened.body as AsyncIterable<Uint8Array>;
}

function bodyOf(deps: ExportBuildDeps, source: PlannedSource): () => AsyncIterable<Uint8Array> {
    switch (source.kind) {
        case 'text':
            return () => textBytes(source.text);
        case 'kit':
            return () => source.file.open();
        case 'object':
            return () => objectBytes(deps, source);
    }
}

function zipEntries(deps: ExportBuildDeps, entries: readonly PlannedEntry[]): ZipEntry[] {
    return entries.map((entry) => ({ name: entry.name, method: zipMethodFor(entry.name), body: bodyOf(deps, entry.source) }));
}

export interface Written {
    bytes: number;
    readonly hash: ReturnType<typeof createHash>;
}

/**
 * The archive's chunks as they pass to the bucket: counted, hashed, and stopped past `maxBytes` (a file that grew
 * after its size was read) with `apiError.export.tooLarge`.
 */
export async function* measured(chunks: AsyncIterable<Uint8Array>, written: Written, maxBytes: number): AsyncGenerator<Uint8Array> {
    for await (const chunk of chunks) {
        written.bytes += chunk.length;
        if (written.bytes > maxBytes) {
            throw tooLarge(written.bytes);
        }
        written.hash.update(chunk);
        yield chunk;
    }
}

async function writeZip(
    deps: ExportBuildDeps,
    task: ExportTask,
    plan: ExportPlan,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
    const written: Written = { bytes: 0, hash: createHash('sha256') };
    const chunks = measured(zipStream(zipEntries(deps, plan.entries), deps.clock.now()), written, EXPORT_LIMITS.maxBytes);
    await deps.writer.stream('private', STORAGE_PATHS.cityExport(task.cityId, task.exportId), chunks, { contentType: 'application/zip' });
    return { bytes: written.bytes, sha256: written.hash.digest('hex') };
}

/** The code a failed build records: its own, `tooLarge` for a zip that would need ZIP64, a missing file, or `internal`. */
function failureOf(error: unknown): ApiError {
    if (error instanceof ApiError) {
        return error;
    }
    if (error instanceof ZipLimitError) {
        return tooLarge(EXPORT_LIMITS.maxBytes + 1);
    }
    return new ApiError(error instanceof UpstreamError && error.failure === 'notFound' ? 'apiError.notFound' : 'apiError.internal');
}

async function finish(deps: ExportBuildDeps, task: ExportTask, record: CityExportDoc, changes: Partial<CityExportDoc>): Promise<void> {
    await deps.documents.set(recordPath(task), cityExportDocSchema, stamped(deps, record, changes));
}

async function buildReady(deps: ExportBuildDeps, task: ExportTask, record: CityExportDoc): Promise<void> {
    const plan = await prepare(deps, task, record);
    const estimate = await measure(deps, plan.entries);
    if (estimate > EXPORT_LIMITS.maxBytes) {
        throw tooLarge(estimate);
    }
    const zip = await writeZip(deps, task, plan);
    const finished = deps.clock.now();
    await finish(deps, task, record, {
        state: 'ready',
        bytes: zip.bytes,
        sha256: zip.sha256,
        counts: plan.counts,
        finishedAt: timestampFromDate(finished),
        expiresAt: timestampFromDate(new Date(finished.getTime() + EXPORT_LIMITS.ttlDays * DAY_MS)),
    });
}

/** A failed build: no object stays behind, and the record says why (with the message's parameters). */
async function buildFailed(deps: ExportBuildDeps, task: ExportTask, record: CityExportDoc, error: unknown): Promise<void> {
    const failure = failureOf(error);
    deps.log.error('export failed', { cityId: task.cityId, exportId: task.exportId, code: failure.code, error: String(error) });
    await deps.blobs.delete('private', STORAGE_PATHS.cityExport(task.cityId, task.exportId));
    await finish(deps, task, record, {
        state: 'failed',
        error: failure.code,
        ...(failure.params === undefined ? {} : { errorParams: failure.params }),
        finishedAt: timestampFromDate(deps.clock.now()),
    });
}

/**
 * `export.build` (`docs/research/M5-interfaces.md` §5.3, §5.4): claims a queued export, reads the city's published
 * manifest, plans the files, sums their sizes first (`apiError.export.tooLarge {size, max}` past
 * `EXPORT_LIMITS.maxBytes`, nothing written), streams the zip into `exports/<city>/<export>.zip` and records it `ready`
 * with its size, SHA-256, counts and expiry. Any failure is recorded `failed` with its code, the partial object deleted.
 */
export async function buildExport(deps: ExportBuildDeps, task: ExportTask): Promise<BuildOutcome> {
    const record = await claim(deps, task);
    if (record === undefined) {
        deps.log.info('export task skipped', { cityId: task.cityId, exportId: task.exportId });
        return 'skipped';
    }
    try {
        await buildReady(deps, task, record);
    } catch (error) {
        await buildFailed(deps, task, record, error);
        return 'failed';
    }
    deps.log.info('export ready', { cityId: task.cityId, exportId: task.exportId });
    return 'ready';
}

/**
 * `export-build` (task queue): two builds at a time across the project, one attempt (a failure is recorded on the
 * export, and the owner exports again), at most `EXPORT_LIMITS.buildMinutes` each. A payload the schema refuses is logged
 * and dropped.
 */
export function buildExportFunction(getDeps: () => ExportBuildDeps) {
    return onTaskDispatched(
        {
            retryConfig: { maxAttempts: 1 },
            rateLimits: { maxConcurrentDispatches: 2 },
            memory: '1GiB',
            timeoutSeconds: EXPORT_LIMITS.buildMinutes * 60,
            maxInstances: 2,
            ...runAs('export.build'),
        },
        async (request) => {
            const deps = getDeps();
            const task = validate(exportTaskSchema, request.data);
            if (!task.ok) {
                deps.log.error('export task refused', { issues: task.issues.length });
                return;
            }
            await buildExport(deps, task.value);
        },
    );
}
