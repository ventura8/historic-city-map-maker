import { isHttpsUrl, validateManifest, type Manifest, type Photo, type PhotoImage } from '@hcm/shared';

import { SiteBuildError, issuesText } from './errors.js';

/**
 * The manifest a site serves as `data/manifest.json`: the source manifest with
 *
 * - every relative photo image moved to `media/<photo id>/<file name>` (relative to the manifest, so the site's
 *   `data/` folder is self-contained; the schema allows no `..`), copied from the site's media folder;
 * - the Mapbox public token of the build (`MAPBOX_PUBLIC_TOKEN`, a `pk.` token URL-restricted to the site).
 *
 * https images stay where they are (their origin joins the CSP). The result is validated again, so a bad token or
 * a broken source never reaches the page.
 */

/** One photo derivative to copy: `from` is relative to the site's media folder, `to` to the site's `data/` folder. */
interface MediaCopy {
    /** The photo it belongs to (its folder may be an addition's, `additions.ts`). */
    readonly photoId: string;
    readonly from: string;
    readonly to: string;
}

export interface PreparedManifest {
    readonly manifest: Manifest;
    readonly media: readonly MediaCopy[];
}

/** The folder, below the site's `data/`, that holds the photo derivatives. */
const MEDIA_FOLDER = 'media';

function fileName(url: string): string {
    return url.slice(url.lastIndexOf('/') + 1);
}

function moveImage(photoId: string, url: string, media: MediaCopy[]): string {
    if (isHttpsUrl(url)) {
        return url;
    }
    const target = `${MEDIA_FOLDER}/${photoId}/${fileName(url)}`;
    media.push({ photoId, from: `${photoId}/${fileName(url)}`, to: target });
    return target;
}

function movePhoto(photo: Photo, media: MediaCopy[]): Photo {
    const image: PhotoImage = {
        ...photo.image,
        web: moveImage(photo.id, photo.image.web, media),
        thumb: moveImage(photo.id, photo.image.thumb, media),
    };
    return { ...photo, image };
}

function checked(input: unknown, what: string): Manifest {
    const result = validateManifest(input);
    if (!result.ok) {
        throw new SiteBuildError(`${what}: invalid manifest\n${issuesText(result.issues)}`);
    }
    return result.value;
}

/** The site's manifest and the media copies it needs; throws SiteBuildError when the source or the result is invalid. */
export function prepareManifest(source: unknown, token: string, what = 'manifest'): PreparedManifest {
    const manifest = checked(source, what);
    const media: MediaCopy[] = [];
    const photos = manifest.photos.map((photo) => movePhoto(photo, media));
    const city = { ...manifest.city, mapbox: { publicToken: token } };
    return { manifest: checked({ ...manifest, city, photos }, `${what} (with the build's token)`), media };
}
