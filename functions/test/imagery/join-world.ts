/**
 * The frames of a join for the join tests (`docs/research/M8-join-interfaces.md`): the imagery world with scenes of one date
 * of one KH-9 pass whose footprints cover the west and the east of the city, each imported or not, and rendered versions, jobs
 * and a join version built from the golden documents the pipeline writes. Every value is a generated test value.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { JobDoc, LayerVersionDoc, UsgsSceneDoc } from '@hcm/shared';

import { NOW, at, readJob, readVersion, renderedVersion, seedJob, seedScene, seedVersion, type ImageryWorld } from './world.js';

export const DATE = '1972-08-08';
export const F039 = 'D3C1202-200149F039';
export const F040 = 'D3C1202-200149F040';
export const F041 = 'D3C1202-200149F041';
export const WEST = [
    { lat: 44.25, lng: 25.8 },
    { lat: 44.25, lng: 26.1 },
    { lat: 44.65, lng: 26.1 },
    { lat: 44.65, lng: 25.8 },
];
export const EAST = [
    { lat: 44.25, lng: 26.1 },
    { lat: 44.25, lng: 26.4 },
    { lat: 44.65, lng: 26.4 },
    { lat: 44.65, lng: 26.1 },
];

/** A candidate scene of the date, free. */
export function frameFields(overrides: Partial<UsgsSceneDoc> = {}): Partial<UsgsSceneDoc> {
    return { dataset: 'declassiii', sensor: 'KH-9-pan', acquisitionDate: DATE, footprint: WEST, ...overrides };
}

function frameSource(entityId: string): NonNullable<LayerVersionDoc['source']> {
    return { kind: 'usgs', entityId, dataset: 'declassiii', sensor: 'KH-9-pan', acquisitionDate: DATE };
}

/** A version of a frame's import: rendered and waiting for approval unless `overrides` says. */
export function partVersion(id: string, entityId: string, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        jobId: id,
        layerId: `layer-${entityId.slice(-4).toLowerCase()}`,
        source: frameSource(entityId),
        date: DATE,
        year: 1972,
        sensor: 'KH-9-pan',
        createdAt: at(NOW),
        ...overrides,
    });
}

export function partJob(id: string, layerId: string, overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        waitReason: 'approval',
        params: { entityId: F039, dataset: 'declassiii', sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId,
        versionId: id,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** A scene imported, its version `v-<entity>` and that version's job as given. */
export async function seedPart(
    world: ImageryWorld,
    entityId: string,
    version: Partial<LayerVersionDoc> = {},
    job: Partial<JobDoc> = {},
): Promise<{ readonly versionId: string; readonly layerId: string }> {
    const versionId = `v-${entityId.slice(-4).toLowerCase()}`;
    const doc = partVersion(versionId, entityId, version);
    await seedScene(world, entityId, frameFields({ status: 'imported', layerId: doc.layerId }));
    await seedVersion(world, versionId, doc);
    await seedJob(world, versionId, partJob(versionId, doc.layerId, job));
    return { versionId, layerId: doc.layerId };
}

const CONTRACTS = resolve(import.meta.dirname, '../../../pipeline/tests/contracts');

/** The golden join version (`version.join.json`). */
export function joinVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    const golden = JSON.parse(readFileSync(resolve(CONTRACTS, 'version.join.json'), 'utf8')) as LayerVersionDoc;
    return { ...golden, createdAt: at(NOW), ...overrides };
}

/** A join job over the given frames, born waiting for them. */
export function joinJob(id: string, parts: readonly { versionId: string; layerId: string }[], overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'layer-join',
        status: 'queued',
        waitReason: 'parts',
        params: { parts: parts.map(({ versionId, layerId }) => ({ versionId, layerId })), sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'layer-join',
        versionId: id,
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** A join's source naming the given frames. */
export function joinSource(parts: readonly { versionId: string; layerId: string; entityId: string }[]): LayerVersionDoc['source'] {
    return {
        kind: 'join',
        parts: parts.map((part) => ({ ...part, dataset: 'declassiii', sensor: 'KH-9-pan', acquisitionDate: DATE })),
    };
}

/** A join on `layer-join` of the two frames F039 and F040 (their versions seeded as parts held by it). */
export async function seedJoinOfTwo(
    world: ImageryWorld,
    id: string,
    version: Partial<LayerVersionDoc> = {},
    job: Partial<JobDoc> = {},
): Promise<readonly { versionId: string; layerId: string; entityId: string }[]> {
    const first = await seedPart(world, F039, { partOf: id });
    const second = await seedPart(world, F040, { partOf: id });
    const parts = [
        { ...first, entityId: F039 },
        { ...second, entityId: F040 },
    ];
    await seedVersion(world, id, joinVersion({ jobId: id, layerId: 'layer-join', source: joinSource(parts), ...version }));
    await seedJob(world, id, joinJob(id, parts, { status: 'awaiting_approval', waitReason: 'approval', ...job }));
    return parts;
}

/** A version that must be there. */
export async function requireVersion(world: ImageryWorld, id: string): Promise<LayerVersionDoc> {
    const version = await readVersion(world, id);
    if (version === undefined) {
        throw new Error(`no version ${id}`);
    }
    return version;
}

/** A job that must be there. */
export async function requireJob(world: ImageryWorld, id: string): Promise<JobDoc> {
    const job = await readJob(world, id);
    if (job === undefined) {
        throw new Error(`no job ${id}`);
    }
    return job;
}
