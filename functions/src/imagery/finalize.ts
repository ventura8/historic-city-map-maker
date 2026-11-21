/**
 * The publisher's last step (`docs/research/M3-interfaces.md` §2.2, §7.2 step 4, §7.3 `finalize`, §7.5): in one
 * transaction the layer is created (its first version) or pointed at the new tiles (a later one: its presentation is
 * kept), the previous version is superseded, this one is published, the job succeeds, and the month's counters move:
 * the compute units counted and the reservation released for MTS, one more Studio upload for the free path, the
 * megabytes and one more publish of Mapbox's Uploads API for its free path (M7, `docs/research/M7-local-worker.md` §6: no
 * compute units). The version records the path (`mapbox.via`). The manifest is rebuilt by `publish.onLayerWrite`. M8: a
 * join also ends the frames it is made of (`finalize-join.ts`). M12 (`docs/research/M12-own-tiles.md`): tiles from the project's own
 * bucket: the layer's source is the archive, Mapbox's counters do not move, a tileset an earlier version left at Mapbox stays on record
 * for the layer's deletion, and the job's Mapbox steps are marked skipped. Such a publish still needs its version `approved`: a
 * rejection during the copy wins.
 */
import {
    DEM_ATTRIBUTION,
    FIRESTORE_PATHS,
    MAPBOX_FREE_COMPUTE_UNITS,
    SENSOR_SPECS,
    LANDSAT_ATTRIBUTION,
    USGS_ATTRIBUTION,
    isLandsatDataset,
    creditLine,
    layerRightsOf,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type MtsPrecision,
    type Schema,
    type UsageDoc,
} from '@hcm/shared';

import { compact, omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { joinFrameWrites, readJoinFrames, retiredByJoin, retiredLayer } from './finalize-join.js';
import { provenanceOf } from './finalize-provenance.js';
import { IMAGERY_WRITER, stampOf, withStep, type Stamp } from './records.js';

export type FinalizeDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

interface FinishedVersion {
    readonly cityId: string;
    readonly jobId: string;
    readonly versionId: string;
}

interface MapboxFinish extends FinishedVersion {
    readonly origin: 'mts' | 'studio' | 'uploads';
    readonly tilesetId: string;
    readonly sourceId?: string;
    /** km² processed per precision, as the MTS job reported it (the estimate's calibration). */
    readonly precisions?: Readonly<Record<MtsPrecision, number>>;
}

/** M12: the archive copied to the public bucket. */
interface OwnFinish extends FinishedVersion {
    readonly origin: 'own';
    readonly path: string;
    readonly url: string;
    readonly bytes: number;
}

export type Finish = MapboxFinish | OwnFinish;

type Output = NonNullable<LayerVersionDoc['output']>;

/** A file name or label that says it shows a plan or a map (else an aerial photograph). */
const MAP_OPACITY = 0.85;
const MAP_WORDS = /\b(?:plan|planul|harta|hart[aă]|map)\b/i;

type Apply = (transaction: DocumentTransaction) => Promise<void>;

function setting<T>(path: string, schema: Schema<T>, data: T): Apply {
    return (transaction) => transaction.set(path, schema, data);
}

/** An upload's own file name, else the version's label. */
function nameOf(version: LayerVersionDoc): string {
    return version.source?.kind === 'upload' ? (version.source.originalName ?? version.label.ro) : version.label.ro;
}

/** A USGS frame is a satellite layer; M20: an archive series is a map (`docs/research/M20-import-local.md` §9). */
function knownKindOf(version: LayerVersionDoc): LayerDoc['kind'] | undefined {
    if (version.source?.kind === 'usgs' || version.sensor !== undefined) {
        return 'satellite';
    }
    return version.origin === 'archive' ? 'map' : undefined;
}

function kindOf(version: LayerVersionDoc): LayerDoc['kind'] {
    return knownKindOf(version) ?? (MAP_WORDS.test(nameOf(version)) ? 'map' : 'aerial');
}

/** M20 (§9): a drawn map starts at 0.85, so the streets beneath it show; every other layer at 1. */
function opacityOf(version: LayerVersionDoc): number {
    return version.origin === 'archive' ? MAP_OPACITY : 1;
}

/** USGS's courtesy credit, or an upload's own name until the admin writes one; a frame fitted over terrain adds the DEM's notice (M15). */
function attributionOf(version: LayerVersionDoc): string {
    // M20 (docs/research/M20-import-local.md §7): an archive series credits its author, title, year, licence and the scan's source.
    return version.rights === undefined ? ownAttribution(version) : creditLine(version.rights, version.label.ro);
}

function ownAttribution(version: LayerVersionDoc): string {
    const own = version.source?.kind === 'upload' ? nameOf(version).slice(0, 500) : usgsCredit(version);
    return version.georef?.terrain === undefined ? own : `${own}; ${DEM_ATTRIBUTION}`.slice(0, 500);
}

/** M25: a Landsat scene credits NASA and USGS as they ask; a declassified frame USGS EROS. */
function usgsCredit(version: LayerVersionDoc): string {
    return version.source?.kind === 'usgs' && isLandsatDataset(version.source.dataset) ? LANDSAT_ATTRIBUTION : USGS_ATTRIBUTION;
}

function mapboxOf(finish: MapboxFinish, output: Output): NonNullable<LayerDoc['mapbox']> {
    return compact<NonNullable<LayerDoc['mapbox']>>({
        tilesetId: finish.tilesetId,
        sourceId: finish.sourceId,
        publishedSourceSha: finish.origin === 'mts' ? output.cogSha256 : undefined,
        origin: finish.origin,
    });
}

interface Held {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc & { readonly output: Output };
    readonly layer: LayerDoc | undefined;
    readonly previous: LayerVersionDoc | undefined;
    readonly usage: UsageDoc | undefined;
    readonly usageMonth: string;
}

/** A new layer from its first published version: on top of the others, on the public map (auto-publish means it). */
function newLayer(version: LayerVersionDoc, order: number, stamp: Stamp): Omit<LayerDoc, 'source' | 'minzoom' | 'maxzoom' | 'status'> {
    return compact<Omit<LayerDoc, 'source' | 'minzoom' | 'maxzoom' | 'status'>>({
        year: version.year,
        date: version.date,
        label: version.label,
        description: undefined,
        kind: kindOf(version),
        sensor: version.sensor === undefined ? undefined : SENSOR_SPECS[version.sensor].name,
        attribution: attributionOf(version),
        bounds: undefined,
        order,
        opacity: opacityOf(version),
        defaultVisible: false,
        adjustments: undefined,
        rights: version.rights === undefined ? undefined : layerRightsOf(version.rights),
        published: true,
        provenance: undefined,
        mapbox: undefined,
        currentVersion: undefined,
        pendingVersion: undefined,
        retired: undefined,
        createdAt: stamp.updatedAt,
        ...stamp,
    });
}

/** Where the layer's tiles now are; a publish of its own keeps `mapbox` as the layer had it (a tileset there is deleted with the layer). */
function sourceOf(finish: Finish, output: Output): Pick<LayerDoc, 'source' | 'mapbox'> | Pick<LayerDoc, 'source'> {
    if (finish.origin === 'own') {
        return { source: { type: 'pmtiles', url: finish.url } };
    }
    return { source: { type: 'mapbox', tilesetId: finish.tilesetId }, mapbox: mapboxOf(finish, output) };
}

/** The layer as the new tiles leave it: a new one from the version, or the existing one with its presentation kept. */
function layerAfter(held: Held, finish: Finish, order: number, stamp: Stamp): LayerDoc {
    const { version, layer } = held;
    const tiles = {
        ...sourceOf(finish, version.output),
        minzoom: version.output.minzoom,
        maxzoom: version.output.maxzoom,
        bounds: version.output.bounds,
        provenance: provenanceOf(version, layer),
        currentVersion: finish.versionId,
        status: 'ready' as const,
        ...stamp,
    };
    const base = layer === undefined ? newLayer(version, order, stamp) : withoutOwnMark(layer, finish.versionId);
    return { ...base, ...tiles };
}

/**
 * The layer without this version's pending mark. M16 (`docs/research/M16-recalibrate.md` §5): another version's stays, a refine of this one
 * that took the mark while it was approved and publishing (`recalibrate-replace.ts`), or it would wait for approval with no mark on its layer.
 */
function withoutOwnMark(layer: LayerDoc, versionId: string): LayerDoc {
    return layer.pendingVersion === versionId ? omit(layer, ['pendingVersion']) : layer;
}

function publishedVersion(held: Held, finish: Finish, stamp: Stamp): LayerVersionDoc {
    if (finish.origin === 'own') {
        const own = { path: finish.path, url: finish.url, bytes: finish.bytes, publishedAt: stamp.updatedAt };
        return { ...held.version, state: 'published', own, ...stamp };
    }
    const mapbox = compact<NonNullable<LayerVersionDoc['mapbox']>>({
        tilesetId: finish.tilesetId,
        sourceId: finish.sourceId,
        jobId: held.job.mapboxJobId,
        origin: finish.origin,
        precisions: finish.precisions,
        publishedAt: stamp.updatedAt,
        via: finish.origin,
    });
    return { ...held.version, state: 'published', mapbox, ...stamp };
}

/** The MTS tiles the publisher was waiting for are there once the job is finalized (the Studio path has no such step). */
function tilesDone(job: JobDoc, stamp: Stamp): JobDoc {
    return job.steps?.['tiles']?.status === 'running' ? withStep(job, 'tiles', 'done', stamp.updatedAt) : job;
}

/** M12: what a publish of its own never does at Mapbox shows as skipped on the job's page. */
const MAPBOX_STEPS = ['guard', 'upload', 'publish', 'tiles'] as const;

function withoutMapbox(job: JobDoc, stamp: Stamp): JobDoc {
    return MAPBOX_STEPS.reduce((marked, step) => withStep(marked, step, 'skipped', stamp.updatedAt), job);
}

function succeededJob(held: Held, finish: Finish, stamp: Stamp): JobDoc {
    const walked = finish.origin === 'own' ? withoutMapbox(held.job, stamp) : tilesDone(held.job, stamp);
    const job = withStep(walked, 'finalize', 'done', stamp.updatedAt);
    return { ...omit(job, ['waitReason', 'error', 'lease']), status: 'succeeded', finishedAt: stamp.updatedAt, progress: 1, ...stamp };
}

function studioUsage(usage: UsageDoc, stamp: Stamp): UsageDoc {
    return { ...usage, studioUploads: (usage.studioUploads ?? 0) + 1, ...stamp };
}

/** MTS counts the estimate (the measured units once the calibration is verified), one publish and the bytes uploaded. */
function mtsUsage(usage: UsageDoc, held: Held, finish: MapboxFinish, stamp: Stamp): UsageDoc {
    const reservations = Object.fromEntries(Object.entries(usage.reservations ?? {}).filter(([id]) => id !== finish.versionId));
    const units = held.version.estimate?.computeUnits ?? 0;
    const counted = {
        computeUnits: usage.computeUnits + units,
        publishes: usage.publishes + 1,
        uploadedMb: usage.uploadedMb + (held.version.output.cogBytes ?? 0) / 1e6,
    };
    return { ...usage, ...counted, reservations, ...stamp };
}

/** The Uploads API counts the Studio file's megabytes and one publish; no compute units (nothing was reserved). */
function uploadsUsage(usage: UsageDoc, held: Held, stamp: Stamp): UsageDoc {
    const megabytes = (held.version.output.studioBytes ?? 0) / 1e6;
    return {
        ...usage,
        uploadsApiMb: (usage.uploadsApiMb ?? 0) + megabytes,
        uploadsApiPublishes: (usage.uploadsApiPublishes ?? 0) + 1,
        ...stamp,
    };
}

const USAGE_BY_ORIGIN: Readonly<
    Record<MapboxFinish['origin'], (usage: UsageDoc, held: Held, finish: MapboxFinish, stamp: Stamp) => UsageDoc>
> = {
    mts: mtsUsage,
    studio: (usage, _held, _finish, stamp) => studioUsage(usage, stamp),
    uploads: (usage, held, _finish, stamp) => uploadsUsage(usage, held, stamp),
};

function usageAfter(held: Held, finish: MapboxFinish, stamp: Stamp): UsageDoc {
    const usage = held.usage ?? {
        month: held.usageMonth,
        computeUnits: 0,
        computeUnitBudget: MAPBOX_FREE_COMPUTE_UNITS,
        uploadedMb: 0,
        publishes: 0,
        ...stamp,
    };
    return USAGE_BY_ORIGIN[finish.origin](usage, held, finish, stamp);
}

/** The month whose counter the publish is booked in: where its reservation was taken (the guard), else now. */
function bookedMonth(version: LayerVersionDoc, now: Date): string {
    const checkedAt = version.guard?.checkedAt;
    return usageMonth(checkedAt === undefined ? now : timestampToDate(checkedAt));
}

function hasOutput(version: LayerVersionDoc | undefined): version is Held['version'] {
    return version?.output !== undefined;
}

/** A rendered version; M12: a publish of its own has no state of its own to hold the version, so a rejection during its copy ends it here. */
function publishable(finish: Finish, version: LayerVersionDoc | undefined): version is Held['version'] {
    return hasOutput(version) && (finish.origin !== 'own' || version.state === 'approved');
}

/** Mapbox's month counter moves for Mapbox's paths alone. */
function usageWrite(held: Held, finish: Finish, stamp: Stamp): Apply | undefined {
    return finish.origin === 'own'
        ? undefined
        : setting(FIRESTORE_PATHS.usage(held.usageMonth), usageDocSchema, usageAfter(held, finish, stamp));
}

/** Every document the step touches, read first; undefined when the job or its rendered version is gone. */
async function readHeld(transaction: DocumentTransaction, finish: Finish, now: Date): Promise<Held | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(finish.cityId, finish.jobId), jobDocSchema);
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(finish.cityId, finish.versionId), layerVersionDocSchema);
    if (job === undefined || !publishable(finish, version)) {
        return undefined;
    }
    const layer = await transaction.get(FIRESTORE_PATHS.layer(finish.cityId, version.layerId), layerDocSchema);
    const previousId = layer?.currentVersion;
    const previous =
        previousId === undefined
            ? undefined
            : await transaction.get(FIRESTORE_PATHS.layerVersion(finish.cityId, previousId), layerVersionDocSchema);
    const month = bookedMonth(version, now);
    const usage = await transaction.get(FIRESTORE_PATHS.usage(month), usageDocSchema);
    return { job, version, layer, previous, usage, usageMonth: month };
}

/** The previous published version of the layer becomes `superseded`. */
function supersede(held: Held, finish: Finish, stamp: Stamp): Apply | undefined {
    const previous = held.previous;
    if (previous?.state !== 'published' || previous.jobId === finish.versionId) {
        return undefined;
    }
    return setting(FIRESTORE_PATHS.layerVersion(finish.cityId, previous.jobId), layerVersionDocSchema, {
        ...previous,
        state: 'superseded',
        ...stamp,
    });
}

/** The top of the layer stack (a new layer goes there). */
async function topOrder(deps: FinalizeDeps, cityId: string): Promise<number> {
    const layers = await deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema);
    return layers.documents.reduce((top, layer) => Math.max(top, layer.data.order + 1), 0);
}

/** Publishes the version (see the module comment); false when the job or its rendered version is gone. */
export async function finalizeVersion(deps: FinalizeDeps, finish: Finish): Promise<boolean> {
    const order = await topOrder(deps, finish.cityId);
    const now = deps.clock.now();
    const stamp = stampOf(IMAGERY_WRITER, now);
    const done = await deps.documents.transaction(async (transaction) => {
        const held = await readHeld(transaction, finish, now);
        if (held === undefined) {
            return false;
        }
        const frames = await readJoinFrames(transaction, finish.cityId, held.version);
        const retiredBy = await retiredByJoin(transaction, finish.cityId, held.version);
        const layer = retiredLayer(layerAfter(held, finish, order, stamp), retiredBy, stamp);
        const writes = [
            ...joinFrameWrites(frames, held.version.layerId, finish.versionId, stamp),
            setting(FIRESTORE_PATHS.layer(finish.cityId, held.version.layerId), layerDocSchema, layer),
            supersede(held, finish, stamp),
            setting(
                FIRESTORE_PATHS.layerVersion(finish.cityId, finish.versionId),
                layerVersionDocSchema,
                publishedVersion(held, finish, stamp),
            ),
            setting(FIRESTORE_PATHS.job(finish.cityId, finish.jobId), jobDocSchema, succeededJob(held, finish, stamp)),
            usageWrite(held, finish, stamp),
        ];
        for (const write of writes) {
            await write?.(transaction);
        }
        return true;
    });
    deps.log.info('layer version published', { cityId: finish.cityId, jobId: finish.jobId, origin: finish.origin, done });
    return done;
}
