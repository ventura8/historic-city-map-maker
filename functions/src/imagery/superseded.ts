import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';

type ListRequest = CallableRequest<'imagery.listSuperseded'>;
type DeleteRequest = CallableRequest<'imagery.deleteSuperseded'>;

type SupersededDeps = Pick<Ports, 'documents' | 'blobs' | 'clock' | 'log'>;

interface SupersededOwn {
    readonly versionId: string;
    readonly layerId: string;
    readonly year: number;
    readonly updatedAt: string;
    readonly ownPath: string;
    readonly ownUrl: string;
    readonly tilePaths: readonly string[];
}

interface RemoveContext {
    readonly cityId: string;
    readonly callerUid: string;
    readonly now: Date;
}

function listedOwn(version: LayerVersionDoc): version is LayerVersionDoc & { own: NonNullable<LayerVersionDoc['own']> } {
    return version.state === 'superseded' && version.own !== undefined && version.own.removedAt === undefined;
}

function shownPath(version: Pick<LayerVersionDoc, 'layerId'>, ownUrl: string): { layerId: string; ownUrl: string } {
    return { layerId: version.layerId, ownUrl };
}

async function ownShownAgain(
    deps: SupersededDeps,
    cityId: string,
    source: { layerId: string; ownUrl: string },
): Promise<boolean> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, source.layerId), layerDocSchema);
    return layer?.source.type === 'pmtiles' && layer.source.url === source.ownUrl;
}

function parentFolder(path: string): string {
    return path.slice(0, path.lastIndexOf('/') + 1);
}

async function listedVersion(
    deps: SupersededDeps,
    cityId: string,
    versionId: string,
    version: LayerVersionDoc,
): Promise<SupersededOwn | null> {
    if (!listedOwn(version) || (await ownShownAgain(deps, cityId, shownPath(version, version.own.url)))) {
        return null;
    }
    const tilePaths = await deps.blobs.list('public', parentFolder(version.own.path));
    return {
        versionId,
        layerId: version.layerId,
        year: version.year,
        updatedAt: timestampToDate(version.updatedAt).toISOString(),
        ownPath: version.own.path,
        ownUrl: version.own.url,
        tilePaths,
    };
}

async function listedSuperseded(deps: SupersededDeps, cityId: string): Promise<readonly SupersededOwn[]> {
    const versions = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', '==', 'superseded']],
    });
    const rows = await Promise.all(versions.documents.map(({ id, data }) => listedVersion(deps, cityId, id, data)));
    return rows.filter((row) => row !== null);
}

function ownMatches(version: LayerVersionDoc, listed: SupersededOwn): boolean {
    return version.own?.path === listed.ownPath && version.own?.url === listed.ownUrl;
}

async function removability(
    deps: SupersededDeps,
    context: RemoveContext,
    listed: SupersededOwn,
): Promise<{ path: string; version: LayerVersionDoc } | null> {
    const path = FIRESTORE_PATHS.layerVersion(context.cityId, listed.versionId);
    const version = await deps.documents.get(path, layerVersionDocSchema);
    if (version === undefined || !listedOwn(version) || !ownMatches(version, listed)) {
        return null;
    }
    const active = await ownShownAgain(deps, context.cityId, shownPath(version, version.own.url));
    return active ? null : { path, version };
}

async function imageryListSuperseded(
    deps: SupersededDeps,
    _caller: VerifiedCaller,
    request: ListRequest,
): Promise<CallableResponse<'imagery.listSuperseded'>> {
    const listed = await listedSuperseded(deps, request.cityId);
    const byLayer = new Map<string, CallableResponse<'imagery.listSuperseded'>['layers'][number]>();
    for (const row of listed) {
        const layer = byLayer.get(row.layerId) ?? { layerId: row.layerId, versions: [] };
        layer.versions.push({ versionId: row.versionId, year: row.year, updatedAt: row.updatedAt, tileCount: row.tilePaths.length });
        byLayer.set(row.layerId, layer);
    }
    const layers = [...byLayer.values()].sort((left, right) => left.layerId.localeCompare(right.layerId));
    for (const layer of layers) {
        layer.versions.sort((left, right) => left.year - right.year || left.versionId.localeCompare(right.versionId));
    }
    return { layers, versions: listed.length, tiles: listed.reduce((sum, row) => sum + row.tilePaths.length, 0) };
}

async function markRemoved(
    deps: SupersededDeps,
    removable: { path: string; version: LayerVersionDoc },
    context: RemoveContext,
): Promise<void> {
    await deps.documents.set(removable.path, layerVersionDocSchema, {
        ...removable.version,
        own: { ...removable.version.own, removedAt: timestampFromDate(context.now) },
        updatedBy: context.callerUid,
        updatedAt: timestampFromDate(context.now),
    });
}

async function deleteListedVersion(
    deps: SupersededDeps,
    listed: SupersededOwn,
    context: RemoveContext,
): Promise<{ deletedVersion: boolean; deletedTiles: number }> {
    const safe = await removability(deps, context, listed);
    if (safe === null) {
        return { deletedVersion: false, deletedTiles: 0 };
    }
    try {
        await Promise.all(listed.tilePaths.map((path) => deps.blobs.delete('public', path)));
        await markRemoved(deps, safe, context);
        return { deletedVersion: true, deletedTiles: listed.tilePaths.length };
    } catch (error) {
        deps.log.warn('superseded own tiles delete failed', {
            cityId: context.cityId,
            layerId: listed.layerId,
            versionId: listed.versionId,
            error: String(error),
        });
        return { deletedVersion: false, deletedTiles: 0 };
    }
}

async function imageryDeleteSuperseded(
    deps: SupersededDeps,
    caller: VerifiedCaller,
    request: DeleteRequest,
): Promise<CallableResponse<'imagery.deleteSuperseded'>> {
    const listed = await listedSuperseded(deps, request.cityId);
    let deletedVersions = 0;
    let deletedTiles = 0;
    const context = { cityId: request.cityId, callerUid: caller.uid, now: deps.clock.now() };
    for (const version of listed) {
        const result = await deleteListedVersion(deps, version, context);
        deletedVersions += result.deletedVersion ? 1 : 0;
        deletedTiles += result.deletedTiles;
    }
    deps.log.info('superseded own tiles deleted', { uid: caller.uid, cityId: request.cityId, deletedVersions, deletedTiles });
    return { deletedVersions, deletedTiles };
}

export function listSupersededFunction(getDeps: () => SupersededDeps & CallableDeps) {
    return defineCallable('imagery.listSuperseded', imageryListSuperseded, getDeps);
}

export function deleteSupersededFunction(getDeps: () => SupersededDeps & CallableDeps) {
    return defineCallable('imagery.deleteSuperseded', imageryDeleteSuperseded, getDeps);
}
