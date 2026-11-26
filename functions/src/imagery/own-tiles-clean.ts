/**
 * What own tiles leave behind (`docs/research/M12-own-tiles.md`; S-A72-*). A superseded version's public archive stays
 * `LAYER_DELETE_GRACE_DAYS`, then a tick deletes it unless its layer points at it again (a revert from History). A rejected or dismissed
 * version's tiles go at once, a public copy a dead publish left included: nobody will look at them. A deleted layer's public archives go
 * with its files (`layer-delete.ts`).
 */
import {
    FIRESTORE_PATHS,
    LAYER_DELETE_GRACE_DAYS,
    RASTER_PATHS,
    STORAGE_PATHS,
    layerDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    timestampToDate,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type OwnTilesCleanDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs'>;

const DAY_MS = 86_400_000;

function graceOver(version: LayerVersionDoc, now: Date): boolean {
    const limit = now.getTime() - LAYER_DELETE_GRACE_DAYS * DAY_MS;
    return version.own !== undefined && version.own.removedAt === undefined && timestampToDate(version.updatedAt).getTime() <= limit;
}

/** The layer shows this very archive again (a revert from History). */
async function shownAgain(deps: OwnTilesCleanDeps, cityId: string, version: LayerVersionDoc, url: string): Promise<boolean> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, version.layerId), layerDocSchema);
    return layer?.source.type === 'pmtiles' && layer.source.url === url;
}

/** The archive deleted and the version marked, unless the layer shows it. */
async function cleanOne(deps: OwnTilesCleanDeps, cityId: string, stored: StoredDocument<LayerVersionDoc>, now: Date): Promise<void> {
    const own = stored.data.own;
    if (own === undefined || (await shownAgain(deps, cityId, stored.data, own.url))) {
        return;
    }
    await deps.blobs.delete('public', own.path);
    await deps.documents.set(FIRESTORE_PATHS.layerVersion(cityId, stored.id), layerVersionDocSchema, {
        ...stored.data,
        own: { ...own, removedAt: timestampFromDate(now) },
        ...stampOf(IMAGERY_WRITER, now),
    });
    deps.log.info('superseded own tiles removed', { cityId, versionId: stored.id });
}

/** `imagery.tick`'s part: every superseded archive past its grace. */
export async function cleanOwnTiles(deps: OwnTilesCleanDeps, cityId: string, now: Date): Promise<void> {
    const superseded = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', '==', 'superseded']],
    });
    for (const version of superseded.documents.filter(({ data }) => graceOver(data, now))) {
        await cleanOne(deps, cityId, version, now);
    }
}

/**
 * An ended version's tiles, which nobody will look at again: its private archive and picture, by their fixed names in its own folder (never
 * a path its document records: a worker writes those), and a public copy a publish left before it died or the version moved on (S-A70-BAD-
 * LEFT-COPY). A version never published has no public archive in use, so that copy goes too.
 */
export async function deleteVersionTiles(
    deps: Pick<Ports, 'blobs'>,
    cityId: string,
    versionId: string,
    version: LayerVersionDoc,
): Promise<void> {
    await deps.blobs.delete('private', RASTER_PATHS.version(cityId, version.layerId, versionId, 'tiles.pmtiles'));
    await deps.blobs.delete('private', RASTER_PATHS.version(cityId, version.layerId, versionId, 'thumb.webp'));
    if (version.own === undefined) {
        await deps.blobs.delete('public', STORAGE_PATHS.layerTiles(cityId, version.layerId, versionId));
    }
}

/** A deleted layer's public archives; how many went. */
export async function deletePublicTiles(deps: Pick<Ports, 'blobs'>, cityId: string, layerId: string): Promise<number> {
    const paths = await deps.blobs.list('public', STORAGE_PATHS.layerTilesPrefix(cityId, layerId));
    await Promise.all(paths.map((path) => deps.blobs.delete('public', path)));
    return paths.length;
}
