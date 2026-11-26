/**
 * What the imagery screens read of the private bucket and how they draw it (`docs/research/M3-interfaces.md` §3.4,
 * §10): browse copies, scan previews, the reference images, a version's preview and its Studio file, read with the
 * Storage SDK (`getBlob`: the admin's rules allow admins to read, and no address of USGS or of the bucket ever reaches
 * a page as a link). `FilePort` is the Storage adapter (`../firebase/files.ts`); `PicturePort` decodes an image into a
 * canvas (`./pictures.ts`), which the admin map shows as a canvas source: a `blob:` address is no source Mapbox may
 * fetch under the admin's CSP.
 */

/** A file of the private bucket as the pages use it. */
export interface FilePort {
    /** The object at `path`, or null when it is missing or the read was refused. */
    read(path: string): Promise<Blob | null>;
    /** A `blob:` address of the object (an image's source), or null; `release` frees it. */
    url(path: string): Promise<string | null>;
    release(url: string): void;
    /** Saves the object under `name` (the browser's download); false when it could not be read. */
    save(path: string, name: string): Promise<boolean>;
}

/** No bucket reads (a services object without the imagery section): every image is unavailable. */
export const NO_FILES: FilePort = {
    read: () => Promise.resolve(null),
    url: () => Promise.resolve(null),
    release: () => undefined,
    save: () => Promise.resolve(false),
};

/** A canvas holding a picture: a Mapbox canvas source draws it. */
export interface Picture {
    /** The `HTMLCanvasElement` (structural: the admin's logic never touches the DOM itself). */
    readonly canvas: object;
    readonly width: number;
    readonly height: number;
}

/** The warped preview's drawing: one triangle of the source picture into the target, through a canvas transform. */
export interface PictureTriangle {
    /** The triangle's corners in the target's pixels (the canvas is clipped to it). */
    readonly clip: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
    /** `setTransform(a, b, c, d, e, f)` mapping the source's pixels onto the target's. */
    readonly transform: readonly [number, number, number, number, number, number];
}

export interface PicturePort {
    /**
     * The image in a canvas at most `maxSide` pixels on its long side; null when `read` finds nothing or it is no image. `read` is
     * called when its turn comes: this and the next two make one picture at a time.
     */
    decode(read: () => Promise<Blob | null>, maxSide: number): Promise<Picture | null>;
    /** A `blob:` address (`FilePort.release` frees it) of the image's middle, at most `side` square, or null likewise. */
    thumbnail(read: () => Promise<Blob | null>, side: number): Promise<string | null>;
    /** The same of the whole image, at most `maxSide` long. */
    preview(read: () => Promise<Blob | null>, maxSide: number): Promise<string | null>;
    /** An empty canvas of the given size (the georeferencer's warped preview). */
    blank(width: number, height: number): Picture;
    /** Clears `target` and draws `source` into it, triangle by triangle. */
    draw(target: Picture, source: Picture, triangles: readonly PictureTriangle[]): void;
}
