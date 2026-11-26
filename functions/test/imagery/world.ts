/**
 * The imagery family's test world (`docs/research/M3-interfaces.md` §9.3): the fn-content fakes (`../publish/fakes.ts`:
 * documents that validate like the adapter, blobs, tasks, a movable clock, `u-admin`), the M2 service fakes (USGS login,
 * secrets, Cloud Run), the M3 fakes (`../support/imagery-fakes.ts`: scenes, remote files, MTS, a blob reader), the lenient
 * `setup/status` reader, and builders of a city, its setup, scenes, layers, layer versions and jobs that start from the
 * golden documents the pipeline writes (`pipeline/tests/contracts/`). Every value is a generated test value.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    opsGuardDocSchema,
    setupStatusDocSchema,
    timestampFromDate,
    usageDocSchema,
    usgsSceneDocSchema,
    type CityDoc,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type SetupStatusDoc,
    type UsageDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';
import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';

import type { ImageryFamilyDeps } from '../../src/imagery/index.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import {
    createFakeMapboxTilesets,
    createFakeRemoteFiles,
    createFakeUsgsScenes,
    createMemoryBlobReader,
    type SceneRecord,
} from '../support/imagery-fakes.js';
import { createFakeCloudRunJobs, createFakeSecretStore } from '../support/platform.js';
import { createFakeUsgsApi } from '../support/services.js';
import { createFakeMapboxUploads } from '../support/uploads-fake.js';

export const CITY = 'bucharest';
export const MAPBOX_USER = 'e2e-mapbox';
export const TILES_TOKEN = 'sk.e2e-tiles-token';
export const NOW = '2026-10-23T08:00:00.000Z';
export const BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } as const;

const CONTRACTS = resolve(import.meta.dirname, '../../../pipeline/tests/contracts');

/** A golden document of the pipeline's contract, as stored. */
function golden(name: string): unknown {
    return JSON.parse(readFileSync(resolve(CONTRACTS, name), 'utf8'));
}

type ImageryTestDeps = ContentDeps & ImageryFamilyDeps;

export interface ImageryWorld {
    readonly deps: ImageryTestDeps;
    readonly secrets: ReturnType<typeof createFakeSecretStore>;
    readonly usgs: ReturnType<typeof createFakeUsgsApi>;
    readonly scenes: ReturnType<typeof createFakeUsgsScenes>;
    readonly remote: ReturnType<typeof createFakeRemoteFiles>;
    readonly tilesets: ReturnType<typeof createFakeMapboxTilesets>;
    /** M7: Mapbox's Uploads API (the tiles token lacks its scopes until `uploads.grantScopes()`). */
    readonly uploads: ReturnType<typeof createFakeMapboxUploads>;
    readonly reader: ReturnType<typeof createMemoryBlobReader>;
    readonly jobs: ReturnType<typeof createFakeCloudRunJobs>;
}

/** A fresh world: the city's secrets stored, nothing else seeded. */
export function imageryWorld(now = NOW, records: Readonly<Record<string, readonly SceneRecord[]>> = {}): ImageryWorld {
    const base = contentDeps(now);
    const secrets = createFakeSecretStore({
        'usgs-username': USGS_CREDENTIALS.approved.username,
        'usgs-app-token': USGS_CREDENTIALS.approved.applicationToken,
        'mapbox-sk-tiles': TILES_TOKEN,
    });
    const usgs = createFakeUsgsApi();
    const scenes = createFakeUsgsScenes(records);
    const remote = createFakeRemoteFiles();
    const tilesets = createFakeMapboxTilesets(MAPBOX_USER, TILES_TOKEN);
    const uploads = createFakeMapboxUploads(tilesets.recipes, MAPBOX_USER, TILES_TOKEN);
    const reader = createMemoryBlobReader(base.blobs);
    const jobs = createFakeCloudRunJobs();
    const setup = {
        readStatus: () => Promise.resolve(base.documents.peek(FIRESTORE_PATHS.setupStatus) as Record<string, unknown> | undefined),
    };
    const deps: ImageryTestDeps = {
        ...base,
        secrets: secrets.secrets,
        usgs: usgs.usgs,
        scenes: scenes.scenes,
        remote: remote.remote,
        tilesets: tilesets.tilesets,
        uploads: uploads.uploads,
        reader: reader.reader,
        jobs: jobs.jobs,
        setup,
        signer: {
            signedDownload: (_bucket, download) => Promise.resolve(`https://signed.example/${download.path}`),
            signedObject: (_bucket, request) =>
                Promise.resolve({
                    url: `https://signed.example/${request.path}?X-Goog-Signature=fake`,
                    method: request.method,
                    headers: {},
                }),
        },
    };
    return { deps, secrets, usgs, scenes, remote, tilesets, uploads, reader, jobs };
}

export function at(iso: string) {
    return timestampFromDate(new Date(iso));
}

const T0 = at('2026-10-01T08:00:00.000Z');

export async function seedCity(world: ImageryWorld, overrides: Partial<CityDoc> = {}): Promise<void> {
    const city: CityDoc = {
        name: { ro: 'București' },
        bounds: BOUNDS,
        mapbox: { user: MAPBOX_USER },
        // A city on Mapbox's path: most of this suite is that path; M12's own tiles have their own suites, on the default.
        imagery: { targetYears: [1966, 1976, 1977, 1978, 1980], publishThroughMapbox: true },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
    await world.deps.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, city);
}

/** `setup/status` with USGS approved for downloads and Mapbox set up for `MAPBOX_USER`; override an area to change it. */
export async function seedSetup(world: ImageryWorld, overrides: Partial<SetupStatusDoc> = {}): Promise<void> {
    const status: SetupStatusDoc = {
        usgs: { state: 'ok', role: 'download' },
        mapbox: { state: 'ok', user: MAPBOX_USER },
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
    await world.deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, status);
}

export async function seedGuard(world: ImageryWorld, state: 'green' | 'red'): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, { state, updatedBy: 'system:ops', updatedAt: T0 });
}

/** A world with the city, its setup and a green guard. */
export async function readyWorld(now = NOW, records: Readonly<Record<string, readonly SceneRecord[]>> = {}): Promise<ImageryWorld> {
    const world = imageryWorld(now, records);
    await seedCity(world);
    await seedSetup(world);
    await seedGuard(world, 'green');
    return world;
}

function scene(entityId: string, overrides: Partial<UsgsSceneDoc> = {}): UsgsSceneDoc {
    return {
        entityId,
        dataset: 'corona2',
        sensor: 'KH-4A',
        acquisitionDate: '1966-07-12',
        status: 'candidate',
        downloadAvailable: true,
        footprint: [
            { lat: 44.35, lng: 25.95 },
            { lat: 44.35, lng: 26.25 },
            { lat: 44.52, lng: 26.25 },
            { lat: 44.52, lng: 25.95 },
        ],
        resolutionM: 2.75,
        coverage: 0.6,
        browse: { state: 'none', sourceUrl: `https://ims.cr.usgs.gov/browse/declass1/${entityId}.jpg` },
        rank: { score: 80, reasons: [{ code: 'free' }], version: 1 },
        harvestedAt: T0,
        updatedBy: 'system:imagery',
        updatedAt: T0,
        ...overrides,
    };
}

export async function seedScene(world: ImageryWorld, entityId: string, overrides: Partial<UsgsSceneDoc> = {}): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.usgsScene(CITY, entityId), usgsSceneDocSchema, scene(entityId, overrides));
}

/** The golden rendered version (`version.awaiting-approval.json`) moved into this world's city. */
export function renderedVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return { ...(golden('version.awaiting-approval.json') as LayerVersionDoc), ...overrides };
}

/** The golden version's output (the render the pipeline registered). */
export function goldenOutput(): NonNullable<LayerVersionDoc['output']> {
    const output = renderedVersion().output;
    if (output === undefined) {
        throw new Error('the golden version has no output');
    }
    return output;
}

/** The golden version's georeference (automatic pairs, poly2, two checks). */
export function goldenGeoref(): NonNullable<LayerVersionDoc['georef']> {
    const georef = renderedVersion().georef;
    if (georef === undefined) {
        throw new Error('the golden version has no georeference');
    }
    return georef;
}

/** The golden version waiting for points (`version.needs-gcps.json`). */
export function needsGcpsVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return { ...(golden('version.needs-gcps.json') as LayerVersionDoc), ...overrides };
}

/** The golden archive series parked with `layout-check` (`version.layout-check.json`): its tiles wait for the owner. */
export function layoutCheckVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return { ...(golden('version.layout-check.json') as LayerVersionDoc), ...overrides };
}

/** The golden running job (`job.usgs-import.running.json`). */
export function runningJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return { ...(golden('job.usgs-import.running.json') as JobDoc), ...overrides };
}

export async function seedVersion(world: ImageryWorld, id: string, version: LayerVersionDoc): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.layerVersion(CITY, id), layerVersionDocSchema, version);
}

export async function seedJob(world: ImageryWorld, id: string, job: JobDoc): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, id), jobDocSchema, job);
}

function layer(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1966,
        label: { ro: 'KH-4A Corona, 12 iulie 1966' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: `${MAPBOX_USER}.hcm-bucharest-kh-4a-corona-1966` },
        minzoom: 10,
        maxzoom: 16,
        order: 3,
        opacity: 0.8,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: `${MAPBOX_USER}.hcm-bucharest-kh-4a-corona-1966`, origin: 'mts', publishedSourceSha: 'd'.repeat(64) },
        updatedBy: 'u-admin',
        updatedAt: T0,
        ...overrides,
    };
}

export async function seedLayer(world: ImageryWorld, id: string, overrides: Partial<LayerDoc> = {}): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.layer(CITY, id), layerDocSchema, layer(overrides));
}

export async function seedUsage(world: ImageryWorld, month: string, overrides: Partial<UsageDoc> = {}): Promise<void> {
    const usage: UsageDoc = {
        month,
        computeUnits: 0,
        computeUnitBudget: 20,
        uploadedMb: 0,
        publishes: 0,
        updatedBy: 'system:imagery',
        updatedAt: T0,
        ...overrides,
    };
    await world.deps.documents.set(FIRESTORE_PATHS.usage(month), usageDocSchema, usage);
}

export function readJob(world: ImageryWorld, id: string): Promise<JobDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.job(CITY, id), jobDocSchema);
}

export function readVersion(world: ImageryWorld, id: string): Promise<LayerVersionDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.layerVersion(CITY, id), layerVersionDocSchema);
}

export function readLayer(world: ImageryWorld, id: string): Promise<LayerDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.layer(CITY, id), layerDocSchema);
}

export function readScene(world: ImageryWorld, id: string): Promise<UsgsSceneDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.usgsScene(CITY, id), usgsSceneDocSchema);
}

export function readUsage(world: ImageryWorld, month: string): Promise<UsageDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.usage(month), usageDocSchema);
}
