import { FIRESTORE_PATHS, jobDocSchema, layerVersionDocSchema, type JobDoc, type LayerVersionDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

/**
 * 2026-11-24 (lesson 799): how a stitched series was laid out, for a Redraw at full resolution that finds no parts record in the
 * versions it was drawn from (1895-1899 was placed before records existed). The pipeline rebuilds the record from the same layout
 * (`placing/rebuild.py`) and warps the originals. Only what the worker may not read itself is copied: the layout's method (the archive
 * version's `help.stitched.method`), the series' encoding and grid (its archive job's params) and the zoom it was published at.
 */
export interface RedrawLayout {
    readonly method: 'grid' | 'atlas' | 'pieces' | 'overview' | 'names';
    readonly encoding: 'grey' | 'colour' | 'lineart';
    readonly gridId?: string;
    readonly maxzoom: number;
}

type Documents = Pick<Ports, 'documents'>['documents'];

const METHODS: ReadonlySet<string> = new Set(['grid', 'atlas', 'pieces', 'overview', 'names']);
const ENCODINGS: ReadonlySet<string> = new Set(['grey', 'colour', 'lineart']);

function stitchedMethod(version: LayerVersionDoc | undefined): string | undefined {
    return version?.origin === 'archive' ? version.help?.stitched?.method : undefined;
}

function methodOf(version: LayerVersionDoc | undefined): RedrawLayout['method'] | undefined {
    const method = stitchedMethod(version) ?? '';
    return METHODS.has(method) ? (method as RedrawLayout['method']) : undefined;
}

function zoomOf(versions: readonly (LayerVersionDoc | undefined)[], job: JobDoc): number | undefined {
    const published = versions.find((version) => version?.output?.maxzoom !== undefined)?.output?.maxzoom;
    const asked = job.params['maxzoom'];
    return published ?? (typeof asked === 'number' ? asked : undefined);
}

function layoutFrom(method: RedrawLayout['method'], job: JobDoc, maxzoom: number | undefined): RedrawLayout | undefined {
    if (maxzoom === undefined) {
        return undefined;
    }
    const { encoding, gridId } = job.params;
    const known = typeof encoding === 'string' && ENCODINGS.has(encoding) ? (encoding as RedrawLayout['encoding']) : 'grey';
    return { method, encoding: known, ...(typeof gridId === 'string' ? { gridId } : {}), maxzoom };
}

/** The layout of the archive version among `ids` (nearest first), with its job's encoding and grid; undefined when there is none. */
export async function redrawLayout(documents: Documents, cityId: string, ids: readonly string[]): Promise<RedrawLayout | undefined> {
    const versions = await Promise.all(ids.map((id) => documents.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema)));
    const archive = versions.find((version) => methodOf(version) !== undefined);
    const method = methodOf(archive);
    if (archive === undefined || method === undefined) {
        return undefined;
    }
    const job = await documents.get(FIRESTORE_PATHS.job(cityId, archive.jobId), jobDocSchema);
    return job === undefined ? undefined : layoutFrom(method, job, zoomOf(versions, job));
}

function idsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A redraw retried before it carried its layout gets it now (rg-mwukj3fm); any other job's params are left as they are. */
export async function retryParams(documents: Documents, cityId: string, job: JobDoc): Promise<JobDoc['params'] | undefined> {
    const params = job.params;
    const redraw = job.type === 'regeoref' && params['fullResolution'] === true && params['layout'] === undefined;
    const layout = redraw ? await redrawLayout(documents, cityId, idsOf(params['recordFrom'])) : undefined;
    return layout === undefined ? undefined : { ...params, layout };
}
