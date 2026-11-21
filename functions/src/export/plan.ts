/**
 * What one static export holds (M5, `docs/research/M5-interfaces.md` §5.1, §5.2), pure: from the published manifest,
 * the layers whose scans may travel and the kit, the list of the zip's files with where each one's bytes come from, the
 * city's `city.json` and the export's counts. The task (`./build.ts`) reads, plans, sums the sizes, then streams.
 */
import {
    EXPORT_LAYOUT,
    exportPhotoPath,
    exportRasterPath,
    exportTilesPath,
    restrictedPhotoIds,
    type CityExportDoc,
    type Layer,
    type Manifest,
    type Photo,
    type PhotoVariant,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { BucketRole } from '../ports/blob-store.js';
import type { KitFile } from '../ports/export-kit.js';
import { exportReadme, rightsDocument } from './documents.js';
import { exportPage } from './page.js';

/** Where an entry's bytes come from: text the export writes, an object of a bucket, or a file of the kit. */
export type PlannedSource =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'object'; readonly bucket: BucketRole; readonly path: string }
    | { readonly kind: 'kit'; readonly file: KitFile };

export interface PlannedEntry {
    readonly name: string;
    readonly source: PlannedSource;
}

/** A layer whose scan travels (a USGS frame, `rasterExportable`): its current version's Cloud-Optimized GeoTIFF. */
export interface ExportRaster {
    readonly layerId: string;
    /** The COG in the private bucket (`layerVersion.output.cogPath`). */
    readonly path: string;
}

export interface PlanInput {
    readonly manifest: Manifest;
    /** `https://storage.googleapis.com/<public bucket>/`: a photo file under it travels, its address made relative. */
    readonly publicPrefix: string;
    /** The scans asked for and allowed (empty without `rasters`). */
    readonly rasters: readonly ExportRaster[];
    /** M12: the layers among them served from the public bucket: their archive travels instead of a COG, none else's address changes. */
    readonly archives: readonly string[];
    /** The starter kit's `index.html` as committed (`exportPage` fills it for the city). */
    readonly kitPage: string;
    /** The kit's README, which the export's preface goes before. */
    readonly kitReadme: string;
    readonly engine: readonly KitFile[];
    /** The export's day (the README names it). */
    readonly madeAt: Date;
    /** The city's own tab icon (32 px, a `data:` address); absent, the page keeps the kit's default. */
    readonly icon?: string;
}

type ExportCounts = NonNullable<CityExportDoc['counts']>;

export interface ExportPlan {
    readonly entries: readonly PlannedEntry[];
    readonly counts: ExportCounts;
}

const VARIANTS: readonly PhotoVariant[] = ['web', 'thumb'];

/** The object path of a public-bucket address, or undefined for any other address (it stays as it is). */
function publicPath(url: string, prefix: string): string | undefined {
    return url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
}

interface PhotoFiles {
    readonly photo: Photo;
    readonly entries: readonly PlannedEntry[];
}

/** One image's files in the public bucket, added to `entries` as `name(variant)`; the image with those relative addresses. */
function imageFiles<T extends Pick<Photo['image'], PhotoVariant>>(
    image: T,
    prefix: string,
    name: (variant: PhotoVariant) => string,
    entries: PlannedEntry[],
): T {
    const local = { ...image };
    for (const variant of VARIANTS) {
        const path = publicPath(image[variant], prefix);
        if (path !== undefined) {
            entries.push({ name: name(variant), source: { kind: 'object', bucket: 'public', path } });
            local[variant] = name(variant);
        }
    }
    return local;
}

/** A photo whose files are in the public bucket: its files (its versions' too) under `photos/<id>/`, its addresses relative. */
function photoFiles(photo: Photo, prefix: string): PhotoFiles {
    const entries: PlannedEntry[] = [];
    const image = imageFiles(photo.image, prefix, (variant) => exportPhotoPath(photo.id, variant), entries);
    const versions: NonNullable<Photo['versions']> = {};
    for (const kind of ['improved', 'colorized'] as const) {
        const version = photo.versions?.[kind];
        if (version !== undefined) {
            versions[kind] = imageFiles(version, prefix, (variant) => exportPhotoPath(photo.id, variant, kind), entries);
        }
    }
    return { photo: { ...photo, image, ...(photo.versions === undefined ? {} : { versions }) }, entries };
}

/**
 * The export's `city.json`: the photos' files beside it, and no analytics at all (the project's GA4 and Firebase ids and
 * its crash endpoint stay the project's: an export sends nothing anywhere). The viewer token stays (README: replace it).
 */
function exportedManifest(manifest: Manifest, photos: readonly Photo[], layers: readonly Layer[]): Manifest {
    // M13 §5: an export has no backend to contribute to, and its gallery of unplaced photos would have nowhere to send anyone.
    return {
        ...omit(manifest, ['contributeUrl', 'unplaced', 'stories']),
        city: { ...manifest.city, analytics: {} },
        photos: [...photos],
        layers: [...layers],
        ...exportedStories(manifest.stories, photos),
    };
}

/** M17 §4: the stories travel; a story's link to a photo the export leaves out (an unplaced one) goes. */
function exportedStories(stories: Manifest['stories'], photos: readonly Photo[]): Pick<Manifest, 'stories'> {
    if (stories === undefined) {
        return {};
    }
    const carried = new Set(photos.map((photo) => photo.id));
    return {
        stories: stories.map((story) => {
            const photoIds = story.photoIds?.filter((id) => carried.has(id));
            return { ...omit(story, ['photoIds']), ...(photoIds === undefined || photoIds.length === 0 ? {} : { photoIds }) };
        }),
    };
}

interface LayerFiles {
    readonly layer: Layer;
    readonly entries: readonly PlannedEntry[];
}

/** M12: a layer whose archive may travel: the file beside the page, its address relative; any other keeps its public address. */
function layerFiles(layer: Layer, input: PlanInput): LayerFiles {
    const path = layer.source.type === 'pmtiles' ? publicPath(layer.source.url, input.publicPrefix) : undefined;
    if (path === undefined || !input.archives.includes(layer.id)) {
        return { layer, entries: [] };
    }
    const name = exportTilesPath(layer.id);
    return {
        layer: { ...layer, source: { type: 'pmtiles', url: name } },
        entries: [{ name, source: { kind: 'object', bucket: 'public', path } }],
    };
}

function text(name: string, value: string): PlannedEntry {
    return { name, source: { kind: 'text', text: value } };
}

/** Every file of the export, the city's `city.json` among them, and what the export's record counts. */
export function planExport(input: PlanInput): ExportPlan {
    const photos = input.manifest.photos.map((photo) => photoFiles(photo, input.publicPrefix));
    const layers = input.manifest.layers.map((layer) => layerFiles(layer, input));
    const manifest = exportedManifest(
        input.manifest,
        photos.map((files) => files.photo),
        layers.map((files) => files.layer),
    );
    const restricted = new Set(restrictedPhotoIds(input.manifest.photos));
    const rights = input.manifest.photos.filter((photo) => restricted.has(photo.id));
    const readme = exportReadme({
        manifest,
        rasters: input.rasters.length + input.archives.length,
        kitReadme: input.kitReadme,
        madeAt: input.madeAt,
    });
    const entries: PlannedEntry[] = [
        text(EXPORT_LAYOUT.page, exportPage(input.kitPage, manifest, input.icon)),
        text(EXPORT_LAYOUT.manifest, `${JSON.stringify(manifest, null, 2)}\n`),
        text(EXPORT_LAYOUT.readme, readme),
        text(EXPORT_LAYOUT.rights, rightsDocument(manifest.city.name, rights)),
        ...input.engine.map((file) => ({ name: `${EXPORT_LAYOUT.engineFolder}/${file.path}`, source: { kind: 'kit', file } }) as const),
        ...photos.flatMap((files) => files.entries),
        ...layers.flatMap((files) => files.entries),
        ...input.rasters.map((raster) => ({
            name: exportRasterPath(raster.layerId),
            source: { kind: 'object', bucket: 'private', path: raster.path } as const,
        })),
    ];
    return {
        entries,
        counts: {
            photos: manifest.photos.length,
            restrictedPhotos: rights.length,
            layers: manifest.layers.length,
            rasters: input.rasters.length + input.archives.length,
            pois: manifest.pois?.length ?? 0,
        },
    };
}
