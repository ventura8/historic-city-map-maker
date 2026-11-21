/**
 * M25 (`docs/research/M25-landsat.md` §4): `imagery.tick`'s Landsat part. For a city that leaves `imagery.landsatAuto` on (the default),
 * the best harvested Landsat scene of each year from `landsatFrom` to `landsatTo` (1984 to the current year by default) is imported on
 * its own, oldest year first, at most `LANDSAT_AUTO_PER_TICK` a tick in the cloud. While the city's own computers run the worker (seen
 * within `WORKER_FRESH_SECONDS`), one import per online worker, at most `LANDSAT_AUTO_MAX_PER_TICK`, each placed on the computer
 * (`runOn: 'local'`): there they cost nothing and the daily cap, which guards the Cloud Run spend, does not count them. A year already holding a Landsat import is done; a scene is a candidate
 * only when it is free, holds the city, its cloud is recorded and at most `LANDSAT_AUTO_MAX_CLOUD`, and nobody rejected it; among a
 * year's candidates the highest rank wins (the season counts in it), then the clearer one. Each import is an ordinary
 * `usgs-import` (`startImport`): the budget guard and the daily cap refuse it as any other (the scene waits for a later tick), and
 * USGS must have approved downloads.
 */
import {
    CITY_MIN_COVERAGE_PCT,
    FIRESTORE_PATHS,
    LANDSAT_AUTO_MAX_CLOUD,
    LANDSAT_AUTO_MAX_PER_TICK,
    LANDSAT_AUTO_PER_TICK,
    WORKER_FRESH_SECONDS,
    cityDocSchema,
    imagerySettingsOf,
    isLandsatDataset,
    landsatYearsOf,
    timestampToDate,
    usgsSceneDocSchema,
    workerDocSchema,
    yearOfDate,
    type CityDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';
import { sourcesOf } from '@hcm/shared/sources';

import type { Ports } from '../ports/index.js';
import { startImport } from './import.js';
import { refuseNewRasterJob, refuseWhileGuardRed, type Placement } from './limits.js';
import { IMAGERY_WRITER, usgsRecord } from './records.js';
import { usgsDownloads, usgsSearchable } from './usgs-session.js';

export type LandsatAutoDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'setup'>;

/** A scene that holds the city under few enough clouds (an unrecorded cover is never clear enough). */
function clearOverCity(scene: UsgsSceneDoc): boolean {
    return scene.coverage * 100 >= CITY_MIN_COVERAGE_PCT && (scene.cloudCover ?? Number.POSITIVE_INFINITY) <= LANDSAT_AUTO_MAX_CLOUD;
}

/** True for a Landsat scene the tick may import: free, over the city, clear enough, never rejected or imported. */
function candidate(scene: UsgsSceneDoc): boolean {
    return isLandsatDataset(scene.dataset) && scene.status === 'candidate' && scene.downloadAvailable && clearOverCity(scene);
}

function cloudOf(scene: UsgsSceneDoc): number {
    return scene.cloudCover ?? 0;
}

/** The better of two scenes of a year: the higher rank, then the clearer, then the earlier entity id (a stable choice). */
function better(left: UsgsSceneDoc, right: UsgsSceneDoc): UsgsSceneDoc {
    const order = right.rank.score - left.rank.score || cloudOf(left) - cloudOf(right) || left.entityId.localeCompare(right.entityId);
    return order <= 0 ? left : right;
}

/** The years that already hold a Landsat import (any state: one per year is the default). */
function importedYears(scenes: readonly UsgsSceneDoc[]): ReadonlySet<number> {
    return new Set(
        scenes
            .filter((scene) => isLandsatDataset(scene.dataset) && scene.status === 'imported')
            .map((scene) => yearOfDate(scene.acquisitionDate)),
    );
}

/** The scene to import for each wanted year that has none yet, oldest year first. */
export function landsatPicks(scenes: readonly UsgsSceneDoc[], years: readonly number[]): UsgsSceneDoc[] {
    const done = importedYears(scenes);
    const best = new Map<number, UsgsSceneDoc>();
    for (const scene of scenes.filter(candidate)) {
        const year = yearOfDate(scene.acquisitionDate);
        const kept = best.get(year);
        best.set(year, kept === undefined ? scene : better(kept, scene));
    }
    return years.filter((year) => !done.has(year)).flatMap((year) => best.get(year) ?? []);
}

/** True when USGS is set up with downloads approved; else the part waits (nothing to say: the Setup card says it). */
async function downloadsApproved(deps: LandsatAutoDeps): Promise<boolean> {
    const record = await usgsRecord(deps.setup);
    return usgsSearchable(record) && usgsDownloads(record);
}

/** How many of the city's workers were seen within `WORKER_FRESH_SECONDS` (at most `LANDSAT_AUTO_MAX_PER_TICK` are read). */
async function onlineWorkers(deps: Pick<Ports, 'documents'>, cityId: string, now: Date): Promise<number> {
    const seen = await deps.documents.query(FIRESTORE_PATHS.workers(cityId), workerDocSchema, {
        orderBy: ['lastSeenAt', 'desc'],
        limit: LANDSAT_AUTO_MAX_PER_TICK,
    });
    const since = now.getTime() - WORKER_FRESH_SECONDS * 1000;
    return seen.documents.filter((worker) => timestampToDate(worker.data.lastSeenAt).getTime() > since).length;
}

/** The city exists, keeps Landsat's own imports on, and has Landsat among its sources (M28). */
function importsLandsat(city: CityDoc | undefined, landsatAuto: boolean): city is CityDoc {
    return city !== undefined && landsatAuto && sourcesOf(city.sources).landsat;
}

/**
 * The scenes this tick imports for the city: none when it turned the switch off, left Landsat out of its sources (M28), or USGS
 * cannot download.
 */
async function picksFor(deps: LandsatAutoDeps, cityId: string, perTick: number): Promise<UsgsSceneDoc[]> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    const settings = imagerySettingsOf(city?.imagery);
    if (!importsLandsat(city, settings.landsatAuto) || !(await downloadsApproved(deps))) {
        return [];
    }
    const scenes = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema);
    return landsatPicks(
        scenes.documents.map((scene) => scene.data),
        landsatYearsOf(settings, deps.clock.now().getUTCFullYear()),
    ).slice(0, perTick);
}

/** Where the import runs: on the computer while a worker is online (only the guard refuses it), else as any new job. */
async function placementOf(deps: LandsatAutoDeps, cityId: string, now: Date, workers: number): Promise<Placement> {
    if (workers === 0) {
        return refuseNewRasterJob(deps.documents, now, cityId);
    }
    await refuseWhileGuardRed(deps.documents);
    return { runOn: 'local' };
}

/** One tick of one city: when it runs, and how many of its workers are online. */
interface LandsatTick {
    readonly cityId: string;
    readonly now: Date;
    readonly workers: number;
}

/** One import, or false when the guard or today's cap refuses it (it waits for a later tick). */
async function importOne(deps: LandsatAutoDeps, tick: LandsatTick, scene: UsgsSceneDoc): Promise<boolean> {
    const { cityId, now, workers } = tick;
    let placement: Placement;
    try {
        placement = await placementOf(deps, cityId, now, workers);
    } catch (error) {
        deps.log.info('a landsat import waits', { cityId, entityId: scene.entityId, reason: String(error) });
        return false;
    }
    const { jobId, layerId } = await startImport(deps, { cityId, scene, createdBy: IMAGERY_WRITER, now, ...placement });
    deps.log.info('landsat scene imported on its own', {
        cityId,
        entityId: scene.entityId,
        jobId,
        layerId,
        runOn: placement.runOn ?? 'cloud',
    });
    return true;
}

/** `imagery.tick`'s `landsat` part: one import in the cloud, or one per online worker (at most `LANDSAT_AUTO_MAX_PER_TICK`). */
export async function importLandsat(deps: LandsatAutoDeps, cityId: string, now: Date): Promise<void> {
    const workers = await onlineWorkers(deps, cityId, now);
    const perTick = workers === 0 ? LANDSAT_AUTO_PER_TICK : Math.min(LANDSAT_AUTO_MAX_PER_TICK, Math.max(LANDSAT_AUTO_PER_TICK, workers));
    for (const scene of await picksFor(deps, cityId, perTick)) {
        if (!(await importOne(deps, { cityId, now, workers }, scene))) {
            return;
        }
    }
}
