import { RASTER_PATHS, type VersionFile } from '@hcm/shared';
import { translateAdminTiles, type AdminTilesKey } from '@hcm/shared/admin-tiles';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import type { ContentWorld } from '../../support/content.js';
import { uploadObject } from '../../support/imagery-store.js';
import { seedCity, seedJob } from '../../support/ops.js';

/**
 * The tile-import wizard's world (docs/research/M20-import-local.md §19.11): an archive series of the content world's own city parked
 * with `layout-check`, as the worker leaves it: its job waiting for the owner, its version with the layout's summary, and the
 * version's files (`layout.json`, `thumbs.jpg`, `seams.jpg`, `stitched.jpg`) in the private bucket. The pipeline's answer to a
 * preview is written the same way (`answerPreview`): the worker is the boundary, and its writes are what it leaves.
 */

export const SERIES = 'ar-mw993zri-s-4054e55659a3';
const LAYER = 'atlas-1911';
const AT = new Date('2026-11-12T08:00:00Z');
const CONTRACTS = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts');

interface Quality {
    readonly placedPct: number;
    readonly seamMedian: number;
    readonly seamRmsPx: number;
    readonly verdict: 'good' | 'check' | 'poor';
}

const CHECK: Quality = { placedPct: 80, seamMedian: 0.48, seamRmsPx: 6.5, verdict: 'check' };
export const GOOD: Quality = { placedPct: 100, seamMedian: 0.82, seamRmsPx: 1.1, verdict: 'good' };
export const POOR: Quality = { placedPct: 20, seamMedian: -0.1, seamRmsPx: 40, verdict: 'poor' };

/** A wizard text. */
export function tilesText(lang: 'ro' | 'en', key: AdminTilesKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminTiles(lang, key, params);
}

function layoutFile(revision: number, quality: Quality): Record<string, unknown> {
    const sample = JSON.parse(readFileSync(resolve(CONTRACTS, 'layout.sample.json'), 'utf8')) as Record<string, unknown>;
    return { ...sample, revision, quality };
}

function grey(width: number, height: number, shade: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade - 20 } } })
        .jpeg()
        .toBuffer();
}

async function store(world: ContentWorld, file: VersionFile, bytes: Buffer, type: string): Promise<void> {
    await uploadObject(RASTER_PATHS.version(world.city, LAYER, SERIES, file), new Uint8Array(bytes), type);
}

function versionOf(world: ContentWorld, revision: number, quality: Quality): Record<string, unknown> {
    const stitched = {
        ...{ previewPath: RASTER_PATHS.version(world.city, LAYER, SERIES, 'stitched.jpg'), previewScale: 0.5, width: 5900, height: 3950 },
        ...{ method: 'names', parts: 5, joined: 4, leftOut: [{ name: 'atlas/blank.jpg', reason: 'blank' }], leftOutCount: 1 },
        layout: { rows: 2, cols: 2, revision, quality, weakSeams: [{ a: 1, b: 3, side: 'below', score: 0.21 }] },
    };
    return {
        ...{ layerId: LAYER, jobId: SERIES, origin: 'archive', state: 'needs_gcps', year: 1911, label: { ro: 'Atlasul 1911' } },
        source: { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-4054e55659a3', sheetCount: 5 },
        help: { reason: 'layout-check', note: 'The tiles need a look.', at: AT, stitched },
        ...{ createdBy: world.uid, createdAt: AT, updatedBy: 'system:pipeline', updatedAt: AT },
    };
}

/** The layout's files: `layout.json` unless `withLayout` is false, and the three pictures. */
async function storeFiles(world: ContentWorld, revision: number, quality: Quality, withLayout: boolean): Promise<void> {
    if (withLayout) {
        await store(world, 'layout.json', Buffer.from(JSON.stringify(layoutFile(revision, quality))), 'application/json');
    }
    await store(world, 'thumbs.jpg', await grey(640, 128, 170), 'image/jpeg');
    await store(world, 'seams.jpg', await grey(512, 512, 150), 'image/jpeg');
    await store(world, 'stitched.jpg', await grey(590, 395, 190), 'image/jpeg');
}

export interface SeriesOptions {
    readonly quality?: Quality;
    /** False: the worker never wrote `layout.json` (the wizard says it cannot read the layout). */
    readonly withLayout?: boolean;
}

/** The series' job as the worker leaves it parked for the owner: waiting with its version, `place` done. */
async function seedWaitingJob(world: ContentWorld): Promise<void> {
    await seedJob(
        world,
        SERIES,
        {
            ...{ type: 'archive-series', status: 'awaiting_gcps', waitReason: 'gcps', layerId: LAYER, versionId: SERIES },
            params: {
                ...{ archiveId: 'ar-0123456789abcdef', seriesId: 's-4054e55659a3', class: 'atlas', sheets: 5 },
                ...{ encoding: 'lineart', order: 0, referenceLayerIds: [] },
            },
            ...{ runOn: 'local', localOnly: true, createdBy: world.uid, attempt: 1 },
            steps: { gather: { status: 'done' }, place: { status: 'done' }, export: { status: 'pending' } },
        },
        AT,
    );
}

/** The city, the parked series' job and version at revision 2, and its files. */
export async function seedWaitingSeries(world: ContentWorld, options: SeriesOptions = {}): Promise<void> {
    const quality = options.quality ?? CHECK;
    await seedCity(world, AT);
    await seedWaitingJob(world);
    await storeFiles(world, 2, quality, options.withLayout ?? true);
    await world.emulators.setDocument(`cities/${world.city}/layerVersions/${SERIES}`, versionOf(world, 2, quality));
}

/** What the worker leaves after placing the series again: a newer layout (`revision`), its job and version waiting with it again. */
export async function answerPreview(world: ContentWorld, revision: number, quality: Quality): Promise<void> {
    await store(world, 'layout.json', Buffer.from(JSON.stringify(layoutFile(revision, quality))), 'application/json');
    await seedWaitingJob(world);
    await world.emulators.setDocument(`cities/${world.city}/layerVersions/${SERIES}`, versionOf(world, revision, quality));
}

/** The series' version as Firestore holds it. */
export async function seriesVersion(world: ContentWorld): Promise<Record<string, unknown> | undefined> {
    return world.emulators.document(`cities/${world.city}/layerVersions/${SERIES}`);
}
