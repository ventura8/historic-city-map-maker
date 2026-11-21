import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerLabelFor,
    usgsSceneDocSchema,
    yearOfDate,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { refuseNewRasterJob } from './limits.js';
import { pickDefined, requireCity, stampOf } from './records.js';
import { markNotScanned } from './scene-rank.js';
import { trueSensor } from './scene-record.js';
import { requireUsgs, usgsDownloads, withUsgs } from './usgs-session.js';
import { createWork, jobIdFor, reserveLayerId, type NewWork } from './versions.js';

/**
 * `imagery.import` (admin; `docs/research/M3-interfaces.md` §1, §4.1; S-A12-*): the one click of the happy path. An
 * already scanned frame gets a `usgs-import` job and its layer version, under a layer id reserved from the version's
 * label, and the scene is marked imported, all in one transaction; the dispatcher starts the pipeline from there. M4
 * (`docs/research/M4-interfaces.md` §1.2, §1.5): the order watch starts the same import when USGS delivers a bought scan
 * (`startImport`), and an import of a scene that has an order moves the order to `importing` in the same transaction.
 */
export type ImportDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'usgs' | 'scenes' | 'setup'>;

type Request = CallableRequest<'imagery.import'>;

async function requireScene(deps: ImportDeps, request: Request): Promise<UsgsSceneDoc> {
    const scene = await deps.documents.get(FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return scene;
}

/** `apiError.imagery.alreadyImported` naming the layer (its label once it exists, else its reserved id). */
export async function alreadyImported(deps: Pick<Ports, 'documents'>, cityId: string, layerId: string): Promise<ApiError> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    return new ApiError('apiError.imagery.alreadyImported', { layer: layer?.label.ro ?? layerId });
}

/**
 * USGS confirms the frame can be downloaded now (`download-options`), else `apiError.imagery.notScanned`, and the scene
 * records that it is not (no longer) free, so its card stops offering an Import that always fails (CR-M3-47).
 */
export async function confirmScanned(deps: ImportDeps, cityId: string, scene: UsgsSceneDoc): Promise<void> {
    const options = await withUsgs(deps, (apiKey) => deps.scenes.downloadOptions(apiKey, scene.dataset, [scene.entityId]));
    if (!options.some((option) => option.entityId === scene.entityId && option.available)) {
        await markNotScanned(deps, cityId, scene.entityId);
        throw new ApiError('apiError.imagery.notScanned');
    }
}

/** M4: the scene's order once its import started (`importing`, with the job), or none for a scene that has none. */
function orderImporting(order: UsgsSceneDoc['order'], jobId: string): Pick<UsgsSceneDoc, 'order'> {
    return order === undefined ? {} : { order: { ...order, state: 'importing', importJobId: jobId } };
}

/** The scene as a transaction reads it, still free (M8: a join reads all its scenes before its first write). */
export async function readFreeScene(transaction: DocumentTransaction, cityId: string, entityId: string): Promise<UsgsSceneDoc> {
    const current = await transaction.get(FIRESTORE_PATHS.usgsScene(cityId, entityId), usgsSceneDocSchema);
    if (current === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (current.status === 'imported' && current.layerId !== undefined) {
        throw new ApiError('apiError.imagery.alreadyImported', { layer: current.layerId });
    }
    return current;
}

/**
 * The job and its version are created, the scene (as `readFreeScene` read it) is marked imported and its order, M4,
 * `importing`. `partOf` (M8): the join this frame is imported for.
 */
export async function writeImport(transaction: DocumentTransaction, work: NewWork, stored: UsgsSceneDoc, partOf?: string): Promise<void> {
    const scene = { ...stored, sensor: trueSensor(stored) };
    const label = layerLabelFor(scene.sensor, scene.acquisitionDate);
    await createWork(transaction, work, {
        origin: 'usgs',
        source: {
            kind: 'usgs',
            entityId: scene.entityId,
            dataset: scene.dataset,
            sensor: scene.sensor,
            acquisitionDate: scene.acquisitionDate,
        },
        label,
        year: yearOfDate(scene.acquisitionDate),
        date: scene.acquisitionDate,
        sensor: scene.sensor,
        ...(partOf === undefined ? {} : { partOf }),
    });
    await transaction.set(FIRESTORE_PATHS.usgsScene(work.cityId, scene.entityId), usgsSceneDocSchema, {
        ...scene,
        status: 'imported',
        layerId: work.layerId,
        ...orderImporting(scene.order, work.jobId),
        ...stampOf(work.createdBy, work.now),
    });
}

/** USGS must have approved downloads (the `download` role); before that only the search works. */
export function refuseWithoutDownloads(usgs: Awaited<ReturnType<typeof requireUsgs>>): void {
    if (!usgsDownloads(usgs)) {
        throw new ApiError('apiError.usgs.accessPending');
    }
}

/** The scene, once it is known, not imported yet (or imported and asked `again`) and already scanned, with USGS downloads approved. */
async function importableScene(deps: ImportDeps, request: Request): Promise<UsgsSceneDoc> {
    const usgs = await requireUsgs(deps.setup);
    const scene = await requireScene(deps, request);
    if (scene.status === 'imported' && scene.layerId !== undefined && request.again !== true) {
        throw await alreadyImported(deps, request.cityId, scene.layerId);
    }
    if (!scene.downloadAvailable) {
        throw new ApiError('apiError.imagery.notScanned');
    }
    refuseWithoutDownloads(usgs);
    return scene;
}

/** Who starts an import, of which scene, when (`createdBy`: the admin who clicked Import, or who ordered the scan). */
export interface ImportStart {
    readonly cityId: string;
    readonly scene: UsgsSceneDoc;
    readonly createdBy: string;
    readonly now: Date;
    /** Where it runs when the city's choice is `local` (`Placement`, `docs/research/M7-local-worker.md` §4.5). */
    readonly runOn?: 'local';
}

/** The `usgs-import` job of a scene: its id and parameters, under `layerId`. */
export function importWork(start: ImportStart, layerId: string): NewWork {
    const { cityId, scene, now } = start;
    return {
        cityId,
        jobId: jobIdFor('im', now, scene.entityId),
        type: 'usgs-import',
        params: { entityId: scene.entityId, dataset: scene.dataset, sensor: trueSensor(scene) },
        layerId,
        createdBy: start.createdBy,
        now,
        ...pickDefined(start, ['runOn']),
    };
}

/**
 * The scene imported once more into its own layer (`again`): a new version beside the old one, which it replaces once approved.
 * The transaction reads the scene again: it must still be imported into that layer.
 */
async function startImportAgain(
    deps: Pick<Ports, 'documents'>,
    start: ImportStart,
    layerId: string,
): Promise<{ jobId: string; layerId: string }> {
    const work = importWork(start, layerId);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(FIRESTORE_PATHS.usgsScene(start.cityId, start.scene.entityId), usgsSceneDocSchema);
        if (current?.layerId !== layerId) {
            throw new ApiError('apiError.conflict');
        }
        await writeImport(transaction, work, current);
    });
    return { jobId: work.jobId, layerId };
}

/**
 * The import of a scanned scene once every check passed: a layer id reserved from its label, then the job, its version
 * and the scene (and its order) in one transaction. Used by `imagery.import` and by the order watch (M4).
 */
export async function startImport(deps: Pick<Ports, 'documents'>, start: ImportStart): Promise<{ jobId: string; layerId: string }> {
    const { cityId, scene } = start;
    const layerId = await reserveLayerId(deps.documents, cityId, layerLabelFor(trueSensor(scene), scene.acquisitionDate).ro);
    const work = importWork(start, layerId);
    await deps.documents.transaction(async (transaction) =>
        writeImport(transaction, work, await readFreeScene(transaction, cityId, scene.entityId)),
    );
    return { jobId: work.jobId, layerId };
}

async function imageryImport(deps: ImportDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.import'>> {
    await requireCity(deps.documents, request.cityId);
    const scene = await importableScene(deps, request);
    const now = deps.clock.now();
    const placement = await refuseNewRasterJob(deps.documents, now, request.cityId);
    await confirmScanned(deps, request.cityId, scene);
    const start = { cityId: request.cityId, scene, createdBy: caller.uid, now, ...placement };
    const again = request.again === true && scene.status === 'imported' ? scene.layerId : undefined;
    const { jobId, layerId } = again === undefined ? await startImport(deps, start) : await startImportAgain(deps, start, again);
    deps.log.info('usgs scene imported', {
        uid: caller.uid,
        cityId: request.cityId,
        entityId: scene.entityId,
        jobId,
        layerId,
        again: again !== undefined,
    });
    return { jobId, versionId: jobId, layerId };
}

/** The `imagery-import` callable. */
export function importFunction(getDeps: () => ImportDeps & CallableDeps) {
    return defineCallable('imagery.import', imageryImport, getDeps);
}
