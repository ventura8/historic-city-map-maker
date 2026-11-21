/**
 * The harvest's writes (`docs/research/M3-interfaces.md` §3.1–§3.5): each found record kept as a `usgsScenes/{entityId}` document
 * with its camera, footprint, coverage, download availability and rank. An existing document keeps the admin's status and note, its
 * layer and its browse copy, and (M4) its order and EarthExplorer dataset id. Lesson 676: each dataset is stored as soon as its own
 * search ends (`storeDataset`), `WRITE_CONCURRENCY` documents at a time, and only the ids written and the few frames whose browse
 * copy is made at once are kept (`StoreTally`), so a run's memory does not grow with what it found and a run the server stops later
 * keeps every dataset it stored.
 */
import {
    BROWSE_PREFETCH,
    FIRESTORE_PATHS,
    rankScene,
    timestampFromDate,
    usgsSceneDocSchema,
    validate,
    type CityDoc,
    type RankedScene,
    type UsgsDataset,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { compact } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { copyBrowse } from './browse.js';
import { inBatches } from './harvest-target.js';
import { IMAGERY_WRITER, pickDefined, stampOf } from './records.js';
import { browseSourceOf, sceneFields, type SceneFields, type SceneRecord } from './scene-record.js';
import { rankContextOf, type ShownYear } from './versions.js';

type StoreDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'remote' | 'blobs' | 'images'>;

/**
 * Browse copies made at once by the prefetch: one, since each decodes its image to estimate its clouds (live, 2026-11-13: five at once
 * took the search past its 256 MiB and the server stopped it).
 */
const BROWSE_CONCURRENCY = 1;
/** Scene documents written at once. */
const WRITE_CONCURRENCY = 25;

export interface RankWorld {
    readonly targetYears: readonly number[];
    readonly shown: readonly ShownYear[];
    readonly bounds: CityDoc['bounds'];
    /** M4: EarthExplorer's id of each dataset by its alias, as this run's `dataset-search` read them (none when it failed). */
    readonly eeIds: ReadonlyMap<string, string>;
    /** The city's scenes before this run, by entity id. */
    readonly known: ReadonlyMap<string, UsgsSceneDoc>;
}

/** What a run stored so far: the ids it wrote, how many were new, and the best frames waiting for a browse copy. */
export class StoreTally {
    readonly written = new Set<string>();
    added = 0;
    #browse: UsgsSceneDoc[] = [];

    /** Counts `docs` and keeps the `BROWSE_PREFETCH` best-ranked of them (and of the earlier ones) still without a browse copy. */
    add(docs: readonly UsgsSceneDoc[], known: ReadonlyMap<string, UsgsSceneDoc>): void {
        for (const doc of docs) {
            this.added += known.has(doc.entityId) || this.written.has(doc.entityId) ? 0 : 1;
            this.written.add(doc.entityId);
        }
        const pending = docs.filter((doc) => doc.browse.state === 'none' && doc.browse.sourceUrl !== undefined);
        this.#browse = [...this.#browse, ...pending].sort((left, right) => right.rank.score - left.rank.score).slice(0, BROWSE_PREFETCH);
    }

    get browse(): readonly UsgsSceneDoc[] {
        return this.#browse;
    }

    get updated(): number {
        return this.written.size - this.added;
    }
}

/** The browse record a harvested scene gets: the existing copy when its source did not move, else to be copied. */
function browseFor(existing: UsgsSceneDoc | undefined, sourceUrl: string | undefined, now: Date): UsgsSceneDoc['browse'] {
    if (sourceUrl === undefined) {
        return { state: 'failed', error: 'apiError.imagery.browseUnavailable', checkedAt: timestampFromDate(now) };
    }
    return existing?.browse.sourceUrl === sourceUrl && existing.browse.state === 'copied' ? existing.browse : { state: 'none', sourceUrl };
}

/** A scene's rank against the city's target years and the years its layers show (its own import left out). */
function rankOf(fields: RankedScene, layerId: string | undefined, world: RankWorld): UsgsSceneDoc['rank'] {
    const others = world.shown.filter((shown) => shown.layerId !== layerId);
    return rankScene(fields, rankContextOf(world.targetYears, others));
}

type Kept = Pick<UsgsSceneDoc, 'status' | 'createdAt' | 'note' | 'layerId' | 'order' | 'eeDatasetId' | 'unusable' | 'cloudEstimate'>;

/**
 * What a harvest keeps of a scene it knew: the admin's triage and note, the layer of its import, its creation, and (M4)
 * its order, which only the order callables and the watch write, and the EarthExplorer id an earlier run or order read; the
 * owner's "not useful" and the clouds measured on its browse image (2026-11-13).
 */
function keptOf(existing: UsgsSceneDoc | undefined, at: UsgsSceneDoc['harvestedAt']): Kept {
    if (existing === undefined) {
        return { status: 'candidate', createdAt: at };
    }
    const { status, note, layerId, order, eeDatasetId, unusable, cloudEstimate } = existing;
    return compact<Kept>({ status, note, layerId, order, eeDatasetId, unusable, cloudEstimate, createdAt: existing.createdAt ?? at });
}

/** The scene's EarthExplorer dataset id: this run's for its dataset, else the one it kept. */
function eeDatasetIdOf(dataset: UsgsDataset, kept: Kept, world: RankWorld): Pick<UsgsSceneDoc, 'eeDatasetId'> {
    const eeDatasetId = world.eeIds.get(dataset) ?? kept.eeDatasetId;
    return eeDatasetId === undefined ? {} : { eeDatasetId };
}

function sceneDoc(fields: SceneFields, sourceUrl: string | undefined, world: RankWorld, now: Date): UsgsSceneDoc {
    const existing = world.known.get(fields.entityId);
    const at = timestampFromDate(now);
    const kept = keptOf(existing, at);
    return {
        ...fields,
        ...kept,
        ...eeDatasetIdOf(fields.dataset, kept, world),
        browse: browseFor(existing, sourceUrl, now),
        rank: rankOf({ ...fields, ...pickDefined(kept, ['cloudEstimate']) }, kept.layerId, world),
        harvestedAt: at,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** The document of one record, or undefined for a record the harvest skips (no valid id, footprint or date). */
function docOf(dataset: UsgsDataset, record: SceneRecord, world: RankWorld, now: Date): UsgsSceneDoc | undefined {
    const fields = sceneFields(record, dataset, world.bounds);
    if (fields === undefined) {
        return undefined;
    }
    const doc = sceneDoc(fields, browseSourceOf(record), world, now);
    return validate(usgsSceneDocSchema, doc).ok ? doc : undefined;
}

/** Where a run stores: its city, what it ranks against, and its tally. */
export interface StoreTarget {
    readonly cityId: string;
    readonly world: RankWorld;
    readonly tally: StoreTally;
}

/** Writes one dataset's records (each entity once) and counts them in the tally; returns how many documents it wrote. */
export async function storeDataset(
    deps: StoreDeps,
    target: StoreTarget,
    found: { readonly dataset: UsgsDataset; readonly records: readonly SceneRecord[] },
): Promise<number> {
    const { cityId, world, tally } = target;
    const now = deps.clock.now();
    const docs = new Map<string, UsgsSceneDoc>();
    for (const record of found.records) {
        const doc = docOf(found.dataset, record, world, now);
        if (doc === undefined) {
            deps.log.warn('usgs scene skipped', { cityId, dataset: found.dataset, entityId: record.entityId });
            continue;
        }
        docs.set(doc.entityId, doc);
    }
    const written = [...docs.values()];
    await inBatches(written, WRITE_CONCURRENCY, (doc) =>
        deps.documents.set(FIRESTORE_PATHS.usgsScene(cityId, doc.entityId), usgsSceneDocSchema, doc),
    );
    tally.add(written, world.known);
    return written.length;
}

/**
 * Scenes this harvest did not see keep their record but are ranked again against today's layers and target years (and
 * the current `RANKING_VERSION`), so the list compares like with like; only a changed rank is written.
 */
export async function rerankUnseen(deps: StoreDeps, cityId: string, world: RankWorld, tally: StoreTally): Promise<void> {
    const changed = [...world.known]
        .filter(([id]) => !tally.written.has(id))
        .map(([id, scene]) => ({ id, scene, rank: rankOf(scene, scene.layerId, world) }))
        .filter(({ scene, rank }) => JSON.stringify(rank) !== JSON.stringify(scene.rank));
    await inBatches(changed, WRITE_CONCURRENCY, ({ id, scene, rank }) =>
        deps.documents.set(FIRESTORE_PATHS.usgsScene(cityId, id), usgsSceneDocSchema, {
            ...scene,
            rank,
            ...stampOf(IMAGERY_WRITER, deps.clock.now()),
        }),
    );
}

/**
 * The best-ranked frames without a browse copy get one, each on its own (a failure is recorded on the scene), and its clouds
 * measured; the plan is written once after them (the run's date plan step).
 */
export async function prefetchBrowse(deps: StoreDeps, cityId: string, tally: StoreTally): Promise<void> {
    await inBatches(tally.browse, BROWSE_CONCURRENCY, (scene) => copyBrowse(deps, cityId, scene, false).catch(() => undefined));
}
