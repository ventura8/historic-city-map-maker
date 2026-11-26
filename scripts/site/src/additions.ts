import {
    correctedPhoto,
    creditsNamingAuthors,
    legacyCorrectionsSchema,
    validate,
    validateManifest,
    type LegacyCorrections,
    type Manifest,
    type Photo,
} from '@hcm/shared';

import { SiteBuildError, issuesText } from './errors.js';
import type { SiteFileSystem } from './files.js';

/**
 * A seed manifest joined by its additions (`site.json` → `additions`; `docs/research/M5-interfaces.md` → *The 2023
 * additions*, *Directions from the old site*): the old site's 2023 additions live in their own seed folder because
 * `seed/bucharest/` stays as migrated. The site serves
 *
 * - the seed's photos, then each addition's, in order (an id twice fails the build);
 * - every photo corrected by its folder's `corrections.json` (`correctedPhoto`: the old site's later place and
 *   direction, for a photo that still holds the migrated ones);
 * - the seed's credits naming every photo author (`creditsNamingAuthors`: the additions bring Studiourile Buftea);
 * - each photo's derivatives from the folder it came from (`mediaOf`).
 */

export interface JoinedManifest {
    /** The joined manifest, validated again by the build (`prepareManifest`). */
    readonly manifest: unknown;
    /** The folder holding a photo's derivatives, by photo id. */
    readonly mediaOf: ReadonlyMap<string, string>;
}

interface Folder {
    readonly manifest: Manifest;
    readonly media: string;
    readonly corrections: LegacyCorrections;
}

function readJson(files: SiteFileSystem, path: string): unknown {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: site.json → additions names its folder`);
    }
    try {
        return JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
}

function checkedManifest(input: unknown, path: string): Manifest {
    const result = validateManifest(input);
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid manifest\n${issuesText(result.issues)}`);
    }
    return result.value;
}

/** A folder's corrections; none without the file. */
function correctionsIn(files: SiteFileSystem, dir: string): LegacyCorrections {
    const path = `${dir}/corrections.json`;
    if (!files.isFile(path)) {
        return {};
    }
    const result = validate(legacyCorrectionsSchema, readJson(files, path));
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid corrections\n${issuesText(result.issues)}`);
    }
    return result.value;
}

function addition(files: SiteFileSystem, dir: string): Folder {
    const path = `${dir}/manifest.static.json`;
    return { manifest: checkedManifest(readJson(files, path), path), media: `${dir}/derived`, corrections: correctionsIn(files, dir) };
}

/** Every folder's photos, in order, with their media folder; an id two folders share fails the build. */
function joinedPhotos(folders: readonly Folder[]): { readonly photos: Photo[]; readonly mediaOf: Map<string, string> } {
    const mediaOf = new Map<string, string>();
    const photos: Photo[] = [];
    for (const { manifest, media } of folders) {
        for (const photo of manifest.photos) {
            if (mediaOf.has(photo.id)) {
                throw new SiteBuildError(`${media}: the photo id "${photo.id}" is already the one of a photo before it`);
            }
            mediaOf.set(photo.id, media);
            photos.push(photo);
        }
    }
    return { photos, mediaOf };
}

/** `source` (the seed manifest, `media` its derivatives) joined by the seed folders `dirs`; `source` alone without any. */
export function joinAdditions(source: unknown, media: string, dirs: readonly string[], files: SiteFileSystem): JoinedManifest {
    if (dirs.length === 0) {
        return { manifest: source, mediaOf: new Map() };
    }
    const base: Folder = { manifest: checkedManifest(source, 'the seed manifest'), media, corrections: {} };
    const folders = [base, ...dirs.map((dir) => addition(files, dir))];
    const corrections = Object.assign({}, ...folders.map((folder) => folder.corrections)) as LegacyCorrections;
    const joined = joinedPhotos(folders);
    const photos = joined.photos.map((photo) => correctedPhoto(photo, corrections));
    const city = { ...base.manifest.city, credits: creditsNamingAuthors(base.manifest.city.credits, photos) };
    return { manifest: { ...base.manifest, city, photos }, mediaOf: joined.mediaOf };
}
