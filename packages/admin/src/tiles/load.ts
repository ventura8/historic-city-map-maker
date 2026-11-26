/**
 * The tile-import wizard's files (`docs/research/M20-import-local.md` §19.11): `layout.json` read and checked against its schema, the
 * sheets' and the weak seams' sprites and the stitched preview as `blob:` addresses (each released when the wizard closes or reads
 * a newer layout).
 */
import { layoutFileSchema, RASTER_PATHS, validate, type LayoutFile, type VersionFile } from '@hcm/shared';

import type { FilePort } from '../imagery/files.js';

/** Where a version's files are. */
export interface VersionPlace {
    readonly cityId: string;
    readonly layerId: string;
    readonly versionId: string;
}

export interface LoadedLayout {
    readonly file: LayoutFile;
    readonly thumbs: string | null;
    readonly seams: string | null;
    readonly stitched: string | null;
}

function pathOf(place: VersionPlace, file: VersionFile): string {
    return RASTER_PATHS.version(place.cityId, place.layerId, place.versionId, file);
}

function parsed(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

/** `layout.json`, or null when it is missing, no JSON, or not the contract's shape. */
async function layoutOf(files: FilePort, place: VersionPlace): Promise<LayoutFile | null> {
    const blob = await files.read(pathOf(place, 'layout.json'));
    if (blob === null) {
        return null;
    }
    const result = validate(layoutFileSchema, parsed(await blob.text()));
    return result.ok ? result.value : null;
}

/** The layout and its pictures; null when `layout.json` cannot be read. */
export async function loadLayout(files: FilePort, place: VersionPlace, previewPath: string): Promise<LoadedLayout | null> {
    const file = await layoutOf(files, place);
    if (file === null) {
        return null;
    }
    const [thumbs, seams, stitched] = await Promise.all([
        files.url(pathOf(place, 'thumbs.jpg')),
        files.url(pathOf(place, 'seams.jpg')),
        files.url(previewPath),
    ]);
    return { file, thumbs, seams, stitched };
}

/** Frees a loaded layout's addresses. */
export function releaseLayout(files: FilePort, loaded: LoadedLayout | null): void {
    const urls = loaded === null ? [] : [loaded.thumbs, loaded.seams, loaded.stitched];
    for (const url of urls.filter((one): one is string => one !== null)) {
        files.release(url);
    }
}
