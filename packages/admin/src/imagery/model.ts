/**
 * The Imagery area's items (`docs/research/M3-interfaces.md` §3.3, §10.2): a harvested USGS scene as the list shows it
 * and the filters over it (free only by default, datasets, years, hide rejected; free first, then the score, then the
 * oldest date), an unfinished layer version and where it stands (in progress, or waiting for the admin), and its job's
 * progress and wait.
 */
import {
    SENSOR_SPECS,
    type ApiErrorCode,
    type JobDoc,
    type JobStatus,
    type JobWaitReason,
    type LayerVersionDoc,
    type LayerVersionState,
    type LngLat,
    type RankReasonEntry,
    type Sensor,
    type UsgsDataset,
    type UnusableReason,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { Stored, StoreFailure } from '../content/services.js';
import { orderFieldsOf, type OrderFields } from './orders/model.js';

/** M4 (`docs/research/M4-interfaces.md` §1.7): with its acquisition state, its order and its EarthExplorer page. */
export interface SceneItem extends OrderFields {
    readonly id: string;
    readonly displayId: string;
    readonly dataset: UsgsDataset;
    readonly sensor: Sensor;
    /** `KH-4A Corona`. */
    readonly sensorName: string;
    readonly date: string;
    readonly year: number;
    readonly status: UsgsSceneDoc['status'];
    /** Already scanned: Import is free. */
    readonly free: boolean;
    readonly cloudCover: number | null;
    readonly resolutionM: number;
    readonly coverage: number;
    readonly score: number;
    readonly reasons: readonly RankReasonEntry[];
    /** `[lng, lat]`, open. */
    readonly footprint: readonly LngLat[];
    /** North-west, north-east, south-east, south-west, when the metadata lists them. */
    readonly corners: readonly [LngLat, LngLat, LngLat, LngLat] | null;
    readonly browse: { readonly state: UsgsSceneDoc['browse']['state']; readonly path: string | null; readonly error: ApiErrorCode | null };
    readonly layerId: string | null;
    /** The owner's report of 2026-11-13: set aside as not useful, and why (null: not marked). */
    readonly unusable: UnusableReason | null;
    /** The share of the city the browse image shows clouded (null: not measured). */
    readonly cloudCity: number | null;
}

/** The routed scene read by its id (a scene the filters hide or past the list's page): loading, then the scene, null or why not. */
export interface NamedScene {
    readonly loading: boolean;
    readonly scene: SceneItem | null;
    /** The read stopped (the page offers Try again): "not found" would be a guess. */
    readonly failure: StoreFailure | null;
}

/** No routed scene is read. */
export const NO_NAMED_SCENE: NamedScene = { loading: false, scene: null, failure: null };

/** The scene `id` names in the list, the orders or its own read; null while none has it. */
export function sceneNamed(id: string, lists: readonly (readonly SceneItem[])[], named: NamedScene): SceneItem | null {
    return lists.flat().find((scene) => scene.id === id) ?? (named.scene?.id === id ? named.scene : null);
}

const lngLat = (point: { readonly lat: number; readonly lng: number }): LngLat => [point.lng, point.lat];

/** An optional field as the items keep it: null when absent. */
export function orNull<T>(value: T | undefined): T | null {
    return value ?? null;
}

function cornersOf(scene: UsgsSceneDoc): SceneItem['corners'] {
    const corners = scene.corners;
    return corners === undefined ? null : [lngLat(corners.nw), lngLat(corners.ne), lngLat(corners.se), lngLat(corners.sw)];
}

function browseOf(browse: UsgsSceneDoc['browse']): SceneItem['browse'] {
    return { state: browse.state, path: orNull(browse.path), error: orNull(browse.error) };
}

export function sceneItemOf(doc: Stored<UsgsSceneDoc>): SceneItem {
    const scene = doc.data;
    return {
        ...{ id: doc.id, displayId: orNull(scene.displayId) ?? scene.entityId, dataset: scene.dataset, sensor: scene.sensor },
        ...{ sensorName: SENSOR_SPECS[scene.sensor].name, date: scene.acquisitionDate, year: Number(scene.acquisitionDate.slice(0, 4)) },
        ...{ status: scene.status, free: scene.downloadAvailable, cloudCover: orNull(scene.cloudCover), resolutionM: scene.resolutionM },
        ...{ coverage: scene.coverage, score: scene.rank.score, reasons: scene.rank.reasons, footprint: scene.footprint.map(lngLat) },
        ...{ corners: cornersOf(scene), browse: browseOf(scene.browse), layerId: orNull(scene.layerId) },
        ...{ unusable: orNull(scene.unusable?.reason), cloudCity: orNull(scene.cloudEstimate?.percent) },
        ...orderFieldsOf(scene),
    };
}

export interface SceneFilters {
    /** On by default: a scene that must be bought first is M4's. */
    readonly freeOnly: boolean;
    /** None: every dataset. */
    readonly datasets: readonly UsgsDataset[];
    readonly fromYear: number | null;
    readonly toYear: number | null;
    readonly hideRejected: boolean;
}

export const DEFAULT_FILTERS: SceneFilters = { freeOnly: true, datasets: [], fromYear: null, toYear: null, hideRejected: true };

const inDataset = (filters: SceneFilters, scene: SceneItem): boolean =>
    filters.datasets.length === 0 || filters.datasets.includes(scene.dataset);

const inYears = (filters: SceneFilters, scene: SceneItem): boolean =>
    scene.year >= (filters.fromYear ?? -Infinity) && scene.year <= (filters.toYear ?? Infinity);

const allowed = (filters: SceneFilters, scene: SceneItem): boolean =>
    (scene.free || !filters.freeOnly) && (scene.status !== 'rejected' || !filters.hideRejected);

function shown(filters: SceneFilters, scene: SceneItem): boolean {
    return allowed(filters, scene) && inDataset(filters, scene) && inYears(filters, scene);
}

/** The scenes the filters keep, free first, then the best score, then the oldest. */
export function visibleScenes(scenes: readonly SceneItem[], filters: SceneFilters): SceneItem[] {
    return scenes
        .filter((scene) => shown(filters, scene))
        .toSorted((a, b) => Number(b.free) - Number(a.free) || b.score - a.score || a.date.localeCompare(b.date));
}

/** Lesson 728: below this many kept scenes, a narrowing filter reads the next page by itself. */
export const FILTERED_MIN = 50;

const narrowing = (filters: SceneFilters): boolean => filters.datasets.length > 0 || filters.fromYear !== null || filters.toYear !== null;

/**
 * Lesson 728: the scenes are read best score first, a page at a time, and the source and year filters keep only what that page holds;
 * Bucharest's 1991 and 2008 Landsat 5 scenes (score 68) lay past the first 100 and Find showed only 1984 and 1985. While a source or
 * year filter keeps fewer than `FILTERED_MIN`, the next page is read by itself (once per page read: `askedAt` is the item count the
 * last such read was asked at).
 */
export function wantsMore(
    list: { status: string; hasMore: boolean; items: readonly unknown[] },
    filters: SceneFilters,
    kept: number,
    askedAt: number,
): boolean {
    const more = list.status === 'ready' && list.hasMore && list.items.length !== askedAt;
    return more && narrowing(filters) && kept < FILTERED_MIN;
}

/** A version's states before it is published or ended (the Imagery area's "In progress" and "Needs you"). */
export const OPEN_VERSION_STATES: readonly LayerVersionState[] = [
    'processing',
    'needs_gcps',
    'awaiting_approval',
    'approved',
    'publishing',
    'failed',
];

export interface VersionItem {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
    readonly origin: LayerVersionDoc['origin'];
    readonly state: LayerVersionState;
    readonly updatedAt: string;
    /** It waits for the admin: points, an approval, a compute-unit choice, the Studio upload, or a retry or dismissal. */
    readonly needsYou: boolean;
    readonly checkpointRmseM: number | null;
    /** M8: the join that holds this frame (a stale one is ignored: the join ended). */
    readonly partOf: string | null;
    /** M8: the USGS frames it is made of: a frame's own, a join's all, none for an upload. */
    readonly entityIds: readonly string[];
    /** The version it was made from (a recalibration, a crop, a georeferencing again): that one cannot be deleted while it is. */
    readonly basedOn: string | null;
    /** M12: the small picture Work's waiting row shows (null: none yet). */
    readonly thumbPath: string | null;
}

/** The USGS frames a version's source names. */
function entityIdsOf(source: LayerVersionDoc['source']): readonly string[] {
    if (source?.kind === 'join') {
        return source.parts.map((part) => part.entityId);
    }
    return source?.kind === 'usgs' ? [source.entityId] : [];
}

const WAITING_FOR_ADMIN: readonly LayerVersionState[] = ['needs_gcps', 'awaiting_approval', 'failed'];

/**
 * An approved version the compute-unit guard stopped (over the month, at the tileset cap, a file too large) waits for the
 * admin's choice, or for the Studio upload they chose; one deferred to next month waits for the date (CR-M3-47).
 */
function stoppedForChoice(version: LayerVersionDoc): boolean {
    const guard = version.guard;
    return version.state === 'approved' && guard !== undefined && guard.verdict !== 'within' && guard.choice !== 'defer';
}

export function versionItemOf(doc: Stored<LayerVersionDoc>): VersionItem {
    const version = doc.data;
    return {
        ...{ id: doc.id, layerId: version.layerId, label: version.label, year: version.year, origin: version.origin, state: version.state },
        updatedAt: isoOf(version.updatedAt),
        needsYou: WAITING_FOR_ADMIN.includes(version.state) || stoppedForChoice(version),
        checkpointRmseM: orNull(version.georef?.checkpointRmseM),
        partOf: orNull(version.partOf),
        entityIds: entityIdsOf(version.source),
        basedOn: orNull(version.basedOn),
        thumbPath: orNull(version.output?.tiles?.thumbPath),
    };
}

/** An unfinished job of the city as the Imagery area reads it: its progress and why it waits. */
export interface JobProgress {
    readonly id: string;
    readonly status: JobStatus;
    /** 0 to 1, or null. */
    readonly progress: number | null;
    readonly step: string | null;
    readonly waitReason: JobWaitReason | null;
    /** When a waiting job tries again (USGS maintenance, a deferral). */
    readonly retryAt: string | null;
    readonly attempt: number;
}

/** A timestamp as an ISO string, or null when absent. */
export function isoOrNull(timestamp: JobDoc['retryAt']): string | null {
    return timestamp === undefined ? null : isoOf(timestamp);
}

export function jobProgressOf(doc: Stored<JobDoc>): JobProgress {
    const job = doc.data;
    return {
        ...{ id: doc.id, status: job.status, progress: orNull(job.progress), step: orNull(job.step), waitReason: orNull(job.waitReason) },
        ...{ retryAt: isoOrNull(job.retryAt), attempt: orNull(job.attempt) ?? 0 },
    };
}

/** Whether the newest harvest is older than `days` (or there is none). */
export function harvestIsStale(newest: string | null, now: number, days: number): boolean {
    return newest === null || now - Date.parse(newest) > days * 86_400_000;
}
