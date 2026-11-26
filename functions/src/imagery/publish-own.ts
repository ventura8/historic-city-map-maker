/**
 * Publishing from the project's own bucket (`docs/research/M12-own-tiles.md`; S-A70-*): the default since the owner's decision of
 * 2026-11-07. After Approve, or the policy's approval, the version's private archive is copied to the public bucket, immutable, and the
 * layer points at it; `publish.onLayerWrite` rebuilds the manifest. No Mapbox compute units, tileset or token, and no guard but the
 * budget's. Everything here may run twice: the copy lands on the same name, and `finalizeVersion` needs the version still `approved`, so
 * a rejection during the copy wins and its copy is taken back. A version with no COG can only publish this way, whatever the city
 * chose later; one still without tiles waits for the sweep (`own-tiles-sweep.ts`).
 */
import {
    FIRESTORE_PATHS,
    PUBLISH_MAX_ATTEMPTS,
    STORAGE_PATHS,
    cityDocSchema,
    imagerySettingsOf,
    isOwnTiles,
    jobDocSchema,
    layerVersionDocSchema,
    publicObjectUrl,
    type JobDoc,
    type LayerVersionDoc,
    type VersionTiles,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { Ports } from '../ports/index.js';
import { finalizeVersion, type FinalizeDeps } from './finalize.js';
import { IMAGERY_WRITER, appendJobLog, stampOf } from './records.js';

export type OwnDeps = FinalizeDeps & Pick<Ports, 'blobs' | 'config'>;

/** A published archive never changes: its name carries its version. */
export const OWN_TILES_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** What a publish start read. */
export interface OwnStart {
    readonly cityId: string;
    readonly jobId: string;
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly versionId: string;
}

/** A publish Mapbox already works on stays there: its tiles are paid for. */
function atMapbox(job: JobDoc, version: LayerVersionDoc): boolean {
    return job.status === 'mts_processing' || version.mapbox !== undefined;
}

/** True when this publish goes through the project's own bucket: the city's choice, or a version with no COG for Mapbox to take. */
export async function publishesOwn(deps: Pick<Ports, 'documents'>, start: OwnStart): Promise<boolean> {
    if (atMapbox(start.job, start.version)) {
        return false;
    }
    const city = await deps.documents.get(FIRESTORE_PATHS.city(start.cityId), cityDocSchema);
    return !imagerySettingsOf(city?.imagery).publishThroughMapbox || start.version.output?.cogPath === undefined;
}

/** One more start counted on the job (every delivery of the task, a Retry included), or `attemptsExhausted`. */
async function countAttempt(deps: OwnDeps, start: OwnStart): Promise<void> {
    const path = FIRESTORE_PATHS.job(start.cityId, start.jobId);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const attempts = job?.publishAttempts ?? 0;
        if (attempts >= PUBLISH_MAX_ATTEMPTS) {
            throw new ApiError('apiError.imagery.attemptsExhausted', { attempts: String(attempts) });
        }
        if (job !== undefined) {
            await transaction.set(path, jobDocSchema, { ...job, publishAttempts: attempts + 1, ...stampOf(IMAGERY_WRITER, now) });
        }
    });
}

/** The archive in the public bucket; `tilesGone` when the private one is gone or is not the version's own (a worker wrote its path). */
async function copyToPublic(deps: OwnDeps, start: OwnStart, tiles: VersionTiles, path: string): Promise<void> {
    const mine = isOwnTiles(start.cityId, start.version.layerId, start.versionId, tiles);
    if (!mine || (await deps.blobs.stat('private', tiles.path)) === undefined) {
        throw new ApiError('apiError.imagery.tilesGone');
    }
    await deps.blobs.copy({ bucket: 'private', path: tiles.path }, { bucket: 'public', path }, { cacheControl: OWN_TILES_CACHE_CONTROL });
}

/**
 * A publish that stopped with a copy possibly made (its attempts ran out, or `finalizeVersion` threw): the copy goes unless the version is
 * published with it (a finalize that committed before it threw), and the failure goes on. A run killed outright leaves its copy to the
 * next delivery, or to the Reject or dismissal that ends the version (`deleteVersionTiles`).
 */
async function takeBack(deps: OwnDeps, start: OwnStart, path: string, error: unknown): Promise<never> {
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(start.cityId, start.versionId), layerVersionDocSchema);
    if (version?.own === undefined) {
        await deps.blobs.delete('public', path);
        deps.log.info('own tiles taken back: the publish stopped', { cityId: start.cityId, jobId: start.jobId });
    }
    throw error;
}

/** Published: the private archive goes, so the version's tiles are stored once (its picture stays for Work). */
async function published(deps: OwnDeps, start: OwnStart, tiles: VersionTiles): Promise<void> {
    await appendJobLog(deps, start.cityId, start.jobId, {
        level: 'info',
        step: 'finalize',
        message: `Published ${String(tiles.bytes)} bytes of own tiles.`,
    });
    await deps.blobs.delete('private', tiles.path);
}

/** Copied, then published; a version rejected meanwhile, or a publish that stopped, keeps nothing in the public bucket. */
async function publishTiles(deps: OwnDeps, start: OwnStart, tiles: VersionTiles): Promise<void> {
    const { cityId, jobId, versionId } = start;
    const path = STORAGE_PATHS.layerTiles(cityId, start.version.layerId, versionId);
    const stopped = (error: unknown) => takeBack(deps, start, path, error);
    await countAttempt(deps, start).catch(stopped);
    await copyToPublic(deps, start, tiles, path);
    const url = publicObjectUrl(deps.config.buckets.public, path);
    const finish = { origin: 'own', cityId, jobId, versionId, path, url, bytes: tiles.bytes } as const;
    if (await finalizeVersion(deps, finish).catch(stopped)) {
        await published(deps, start, tiles);
        return;
    }
    await deps.blobs.delete('public', path);
    deps.log.info('own tiles taken back: the version moved on', { cityId, jobId });
}

/** The publish of an approved version, or nothing: a redelivered task after the end, or a version whose tiles the sweep still owes. */
export async function publishOwn(deps: OwnDeps, start: OwnStart): Promise<void> {
    const tiles = start.version.output?.tiles;
    if (start.version.state !== 'approved') {
        return;
    }
    if (tiles === undefined) {
        deps.log.info('publish waits for its tiles', { cityId: start.cityId, jobId: start.jobId });
        return;
    }
    await publishTiles(deps, start, tiles);
}
