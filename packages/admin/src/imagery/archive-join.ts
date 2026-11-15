/**
 * "Join with…" on an archive map's page (finding of 2026-11-14, the owner's harti.zip maps; `docs/research/M8-join-interfaces.md`
 * §11): the maps of the same year that could be parts of the same map (the n and S halves of 1978, 1974-01 and -02, a set's
 * sheets), and `imagery.join` with `versionIds` once the owner picks one. A candidate is an archive map of another layer, published
 * or on its way (awaiting approval, approved), with a scan and points of its own: what the callable takes. One version per map:
 * its published one, else its newest.
 */
import { FIRESTORE_PATHS, layerVersionReadSchema, type LayerVersionDoc, type LayerVersionState } from '@hcm/shared';

import { isoOf } from '../content/list.js';
import { readOnce } from '../content/read-once.js';
import type { ContentServices, Stored } from '../content/services.js';
import { callImagery, refusalOf } from './api.js';

/** One map the open one may be joined with. */
export interface ArchiveJoinCandidate {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
    readonly state: LayerVersionState;
}

/** What the open version is, as the candidates are asked for. */
export interface ArchiveJoinBase {
    readonly id: string;
    readonly layerId: string;
    readonly year: number;
}

/** At most this many versions of a year are read: a year has a handful of maps. */
const CANDIDATES_READ = 60;

const USABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'approved', 'awaiting_approval']);

/** A scan with points of its own (not a file's embedded georeference). */
function pointed(version: LayerVersionDoc): boolean {
    const method = version.georef?.method;
    return version.scan !== undefined && method !== undefined && method !== 'embedded';
}

/** The states of a join that ended: its stamp on a map no longer holds it (live 2026-11-15, the 1974 and 1978 joins failed). */
const ENDED: ReadonlySet<LayerVersionDoc['state']> = new Set<LayerVersionDoc['state']>(['failed', 'rejected', 'cancelled', 'superseded']);

/** The joins read beside the maps that ended; a join not read is taken as still holding its maps. */
function endedJoins(docs: readonly Stored<LayerVersionDoc>[]): ReadonlySet<string> {
    return new Set(docs.filter(({ data }) => data.source?.kind === 'join' && ENDED.has(data.state)).map(({ id }) => id));
}

/** An archive map with a scan and its own points, usable and held by no live join: the join can take it. */
function joinable(version: LayerVersionDoc, ended: ReadonlySet<string>): boolean {
    const free = version.partOf === undefined || ended.has(version.partOf);
    return version.source?.kind === 'archive' && USABLE.has(version.state) && pointed(version) && free;
}

/** The published version of a map wins, else the newest. */
function better(one: Stored<LayerVersionDoc>, other: Stored<LayerVersionDoc>): boolean {
    if ((one.data.state === 'published') !== (other.data.state === 'published')) {
        return one.data.state === 'published';
    }
    return isoOf(one.data.updatedAt) > isoOf(other.data.updatedAt);
}

/** Another map than the open one's, which the join can take. */
function otherMap(base: ArchiveJoinBase, doc: Stored<LayerVersionDoc>, ended: ReadonlySet<string>): boolean {
    return doc.id !== base.id && doc.data.layerId !== base.layerId && joinable(doc.data, ended);
}

/** One candidate per map of another layer than the open one's. */
function candidatesOf(base: ArchiveJoinBase, docs: readonly Stored<LayerVersionDoc>[]): ArchiveJoinCandidate[] {
    const best = new Map<string, Stored<LayerVersionDoc>>();
    const ended = endedJoins(docs);
    for (const doc of docs.filter((one) => otherMap(base, one, ended))) {
        const held = best.get(doc.data.layerId);
        if (held === undefined || better(doc, held)) {
            best.set(doc.data.layerId, doc);
        }
    }
    return [...best.values()].map(({ id, data }) => ({ id, layerId: data.layerId, label: data.label, year: data.year, state: data.state }));
}

/** The year's maps the open one may be joined with (none when the read fails: the card then shows nothing). */
export async function archiveJoinCandidates(services: ContentServices, base: ArchiveJoinBase): Promise<ArchiveJoinCandidate[]> {
    const collection = FIRESTORE_PATHS.layerVersions(services.cityId);
    const read = await readOnce(services, collection, layerVersionReadSchema, {
        where: [['year', '==', base.year]],
        limit: CANDIDATES_READ,
    });
    return read.page === null ? [] : candidatesOf(base, read.page.docs);
}

/** `imagery.join` of archive maps: the join version's id, or null with the refusal in plain words in the snackbar. */
export async function joinArchiveMaps(services: ContentServices, versionIds: readonly string[]): Promise<string | null> {
    try {
        return (await callImagery(services.callables, 'imagery.join', { cityId: services.cityId, versionIds: [...versionIds] })).versionId;
    } catch (error) {
        services.notify(refusalOf(error));
        return null;
    }
}

/** The Imagery area's two intents for **Join with…**. */
export function archiveJoinIntents(services: ContentServices): {
    archiveJoinCandidates(version: ArchiveJoinBase): Promise<ArchiveJoinCandidate[]>;
    joinArchive(versionIds: readonly string[]): Promise<string | null>;
} {
    return {
        archiveJoinCandidates: (version) => archiveJoinCandidates(services, version),
        joinArchive: (versionIds) => joinArchiveMaps(services, versionIds),
    };
}
