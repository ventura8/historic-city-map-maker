/**
 * The plan of whole-city dates (`docs/research/M8-join-interfaces.md` §1, §2, §5): `cities/{city}/imageryPlans/dates`, written
 * here because the admin's scene list is paged and filtered, so a neighbouring frame could be missing from it. Rewritten after a
 * harvest, when a frame's or a join's work stopped somewhere (a state on a row may have changed), after a layer's deletion freed its
 * scenes, and by the tick when a city has none yet (a deploy finds frames already waiting, and no job moves). A scene the admin rejected takes no part. A date already shown
 * through a published join has no row: extending a published join is delete and start again (§9).
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    datePlanDocSchema,
    imagerySettingsOf,
    isLandsatDataset,
    layerVersionDocSchema,
    planDates,
    timestampFromDate,
    usgsSceneDocSchema,
    type DatePlanFrame,
    type JobDoc,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { isUsablePart, newestIn, usablePartIn } from './join-parts.js';
import { pickDefined } from './records.js';

export type DatePlanDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Versions = readonly StoredDocument<LayerVersionDoc>[];

/** The states whose `output.bounds` a usable frame was rendered to. */
function renderedFields(version: LayerVersionDoc): Pick<DatePlanFrame, 'renderedBounds'> {
    return version.output === undefined || !isUsablePart(version) ? {} : { renderedBounds: version.output.bounds };
}

/**
 * M9: the outline `locate` measured through the proved map (`docs/research/M9-calibration.md` §5), else the one `export` read off the
 * render's alpha, however it was fitted: since a render's grid is the whole window, its box no longer says where the frame lies.
 */
function outlineFields(version: LayerVersionDoc): Pick<DatePlanFrame, 'measuredOutline'> {
    const outline = version.calibration?.outline ?? version.output?.outline;
    return outline === undefined ? {} : { measuredOutline: outline };
}

/** The version a scene's frame stands on: the one a join would take, else its newest (one that failed still shows). */
function versionOfScene(scene: UsgsSceneDoc, byLayer: ReadonlyMap<string, Versions>): StoredDocument<LayerVersionDoc> | undefined {
    const versions = byLayer.get(scene.layerId ?? '') ?? [];
    return usablePartIn(versions) ?? newestIn(versions);
}

function frameOf(scene: UsgsSceneDoc, version: StoredDocument<LayerVersionDoc> | undefined): DatePlanFrame {
    const imported =
        version === undefined
            ? {}
            : { versionId: version.id, state: version.data.state, ...renderedFields(version.data), ...outlineFields(version.data) };
    return {
        entityId: scene.entityId,
        date: scene.acquisitionDate,
        sensor: scene.sensor,
        free: scene.downloadAvailable,
        footprint: scene.footprint,
        ...pickDefined(scene, ['displayId', 'corners']),
        ...(scene.cloudEstimate === undefined ? {} : { cloudPercent: scene.cloudEstimate.percent }),
        ...imported,
    };
}

function isJoin(version: StoredDocument<LayerVersionDoc> | undefined): boolean {
    return version?.data.source?.kind === 'join';
}

function versionsByLayer(versions: Versions): ReadonlyMap<string, Versions> {
    const byLayer = new Map<string, StoredDocument<LayerVersionDoc>[]>();
    for (const version of versions) {
        byLayer.set(version.data.layerId, [...(byLayer.get(version.data.layerId) ?? []), version]);
    }
    return byLayer;
}

/**
 * The frames the plan chooses from: scenes the admin did not reject, on dates no published join shows yet (a scene the owner marked not
 * useful is `rejected` with its reason, so it leaves the plan the same way). M25: never a Landsat scene,
 * which holds the whole city on its own.
 */
function framesOf(scenes: readonly UsgsSceneDoc[], versions: Versions): DatePlanFrame[] {
    const byLayer = versionsByLayer(versions);
    const standing = scenes
        .filter((scene) => scene.status !== 'rejected' && !isLandsatDataset(scene.dataset))
        .map((scene) => [scene, versionOfScene(scene, byLayer)] as const);
    const joined = new Set(standing.filter(([, version]) => isJoin(version)).map(([scene]) => scene.acquisitionDate));
    return standing.filter(([scene]) => !joined.has(scene.acquisitionDate)).map(([scene, version]) => frameOf(scene, version));
}

/** Writes the city's plan again from its scenes and versions (a deleted city has none). */
async function writeDatePlan(deps: DatePlanDeps, cityId: string): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        return;
    }
    const [scenes, versions] = await Promise.all([
        deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema),
        deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema),
    ]);
    const frames = framesOf(
        scenes.documents.map((scene) => scene.data),
        versions.documents,
    );
    const rows = planDates(frames, city.bounds, imagerySettingsOf(city.imagery).targetYears);
    await deps.documents.set(FIRESTORE_PATHS.imageryPlan(cityId), datePlanDocSchema, {
        rows,
        updatedAt: timestampFromDate(deps.clock.now()),
    });
    deps.log.info('date plan rewritten', { cityId, frames: frames.length, rows: rows.length });
}

/** A city's rewrite under way in this instance, and whether a write that came meanwhile asks for one more. */
interface Rewrite {
    done: Promise<void>;
    again: boolean;
}

const rewrites = new Map<string, Rewrite>();

/** Whether a write asked for one more rewrite since the last began; the ask is taken. */
function takeAgain(rewrite: Rewrite): boolean {
    const again = rewrite.again;
    rewrite.again = false;
    return again;
}

/** Rewrites until no write asked for one more while the last ran; the city leaves the map whatever happens. */
async function rewriteUntilSettled(deps: DatePlanDeps, cityId: string, rewrite: Rewrite): Promise<void> {
    try {
        do {
            await writeDatePlan(deps, cityId);
        } while (takeAgain(rewrite));
    } finally {
        rewrites.delete(cityId);
    }
}

/**
 * Writes the city's plan again, one rewrite per city at a time in an instance. Each reads every scene and version of the city
 * (about 480 frames for Bucharest), and `imagery-onJobWrite` takes 80 events at once in 256 MiB: three frames ending together
 * read the city three times over and ran out of memory (Cloud Error Reporting, 2026-11-13; LESSONS 663). A call that comes while
 * one runs waits for one more rewrite that starts after it, so it still sees its own write; any number of them share that one.
 */
export function rewriteDatePlan(deps: DatePlanDeps, cityId: string): Promise<void> {
    const running = rewrites.get(cityId);
    if (running !== undefined) {
        running.again = true;
        return running.done;
    }
    const rewrite: Rewrite = { done: Promise.resolve(), again: false };
    rewrites.set(cityId, rewrite);
    rewrite.done = rewriteUntilSettled(deps, cityId, rewrite);
    return rewrite.done;
}

/** The tick: a city with no plan gets one from what it already has (nothing else writes it until a search or a job moves). */
export async function ensureDatePlan(deps: DatePlanDeps, cityId: string): Promise<void> {
    if ((await deps.documents.get(FIRESTORE_PATHS.imageryPlan(cityId), datePlanDocSchema)) === undefined) {
        await rewriteDatePlan(deps, cityId);
    }
}

/** The jobs a row reads, and the statuses where one rests: its frame's state on the row, what is left to download, a join's outcome. */
const PLANNED_TYPES: ReadonlySet<JobDoc['type']> = new Set<JobDoc['type']>(['usgs-import', 'regeoref', 'layer-join']);
const AT_REST: ReadonlySet<JobDoc['status']> = new Set<JobDoc['status']>([
    'awaiting_gcps',
    'awaiting_approval',
    'failed',
    'cancelled',
    'succeeded',
]);

/** A join rendered changes no row: only its outcome does. */
function restsOnARow(job: JobDoc): boolean {
    return AT_REST.has(job.status) && !(job.type === 'layer-join' && job.status === 'awaiting_approval');
}

/** True when this write of a job changes what the plan knows. */
export function datePlanChangedBy(before: JobDoc | undefined, after: JobDoc): boolean {
    return before?.status !== after.status && PLANNED_TYPES.has(after.type) && restsOnARow(after);
}
