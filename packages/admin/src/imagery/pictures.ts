/**
 * `PicturePort` over the page (`./files.ts`): `createImageBitmap` decodes a blob (no CSP source is needed for it), a
 * canvas holds the picture at most `maxSide` pixels long, and the warped preview is drawn triangle by triangle, each
 * clipped and mapped with `setTransform`. A browse image can be 37,440 x 1,920 px, and an `<img>` of it keeps 288 MB of pixels
 * per row and froze the tab (2026-11-07): a thumbnail is decoded small off the main thread (`createImageBitmap`'s resize), and a
 * thumbnail and a page's preview are shown as small JPEGs, `blob:` addresses the admin's CSP already allows. All three, the map's
 * full-size decode too, read and make one picture at a time. The scope is
 * injected (`globalThis` in the entry), so the node tests drive it with a recording fake.
 */
import type { Picture, PicturePort, PictureTriangle } from './files.js';

/** What the adapter draws with (`CanvasRenderingContext2D`, structurally). */
export interface Context2d {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    clip(): void;
    drawImage(image: object, x: number, y: number, width?: number, height?: number): void;
}

export interface CanvasLike {
    width: number;
    height: number;
    getContext(kind: '2d'): Context2d | null;
    toBlob(done: (blob: Blob | null) => void, type: string, quality: number): void;
}

interface Bitmap {
    readonly width: number;
    readonly height: number;
    close(): void;
}

/** One side of the decoded bitmap (the browser keeps the proportions) and how it shrinks. */
interface BitmapSize {
    readonly resizeWidth?: number;
    readonly resizeHeight?: number;
    readonly resizeQuality?: 'medium';
}

export interface PictureScope {
    createImageBitmap(blob: Blob, size?: BitmapSize): Promise<Bitmap>;
    readonly document: { createElement(tag: 'canvas'): CanvasLike };
    readonly URL: { createObjectURL(blob: Blob): string };
}

/** What a shown picture is saved as: small, and browse images are grey film with no transparency. */
const SHOWN_TYPE = 'image/jpeg';
const SHOWN_QUALITY = 0.85;

function canvasOf(scope: PictureScope, width: number, height: number): CanvasLike {
    const canvas = scope.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

function pictureOf(canvas: CanvasLike): Picture {
    return { canvas, width: canvas.width, height: canvas.height };
}

async function decoded(scope: PictureScope, blob: Blob, maxSide: number): Promise<Picture | null> {
    let bitmap: Bitmap;
    try {
        bitmap = await scope.createImageBitmap(blob);
    } catch {
        return null;
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = canvasOf(scope, bitmap.width * scale, bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return pictureOf(canvas);
}

/** The canvas as a `blob:` address (`FilePort.release` frees it); null when the browser could not encode it. */
function addressOf(scope: PictureScope, canvas: CanvasLike): Promise<string | null> {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => {
                resolve(blob === null ? null : scope.URL.createObjectURL(blob));
            },
            SHOWN_TYPE,
            SHOWN_QUALITY,
        );
    });
}

/** Decoded with its shorter side `side` long, whichever it is: its proportions are known only once it is decoded. */
async function smallBitmap(scope: PictureScope, blob: Blob, side: number): Promise<Bitmap> {
    const wide = await scope.createImageBitmap(blob, { resizeHeight: side, resizeQuality: 'medium' });
    if (wide.width >= side) {
        return wide;
    }
    wide.close();
    return scope.createImageBitmap(blob, { resizeWidth: side, resizeQuality: 'medium' });
}

/** The middle of the image, at most `side` square, as the list's `object-fit: cover` showed it; never held at full size. */
async function thumbnail(scope: PictureScope, blob: Blob, side: number): Promise<string | null> {
    let bitmap: Bitmap;
    try {
        bitmap = await smallBitmap(scope, blob, side);
    } catch {
        return null;
    }
    const canvas = canvasOf(scope, Math.min(side, bitmap.width), Math.min(side, bitmap.height));
    canvas.getContext('2d')?.drawImage(bitmap, (canvas.width - bitmap.width) / 2, (canvas.height - bitmap.height) / 2);
    bitmap.close();
    return addressOf(scope, canvas);
}

/** The whole image at most `maxSide` long: a scene's page never shows it larger. */
async function preview(scope: PictureScope, blob: Blob, maxSide: number): Promise<string | null> {
    const picture = await decoded(scope, blob, maxSide);
    return picture === null ? null : addressOf(scope, picture.canvas as CanvasLike);
}

function drawTriangle(context: Context2d, source: Picture, triangle: PictureTriangle): void {
    const [first, second, third] = triangle.clip;
    context.save();
    context.beginPath();
    context.moveTo(...first);
    context.lineTo(...second);
    context.lineTo(...third);
    context.closePath();
    context.clip();
    context.setTransform(...triangle.transform);
    context.drawImage(source.canvas, 0, 0);
    context.restore();
}

function draw(target: Picture, source: Picture, triangles: readonly PictureTriangle[]): void {
    const context = (target.canvas as CanvasLike).getContext('2d');
    if (context === null) {
        return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    for (const triangle of triangles) {
        drawTriangle(context, source, triangle);
    }
}

/** A picture of what `read` finds, each read and made after the last: a large image is decoded whole for a moment. */
type Turn = <T>(read: () => Promise<Blob | null>, make: (blob: Blob) => Promise<T | null>) => Promise<T | null>;

function oneAtATime(): Turn {
    let last: Promise<unknown> = Promise.resolve();
    return <T>(read: () => Promise<Blob | null>, make: (blob: Blob) => Promise<T | null>): Promise<T | null> => {
        const shrink = async (): Promise<T | null> => {
            const blob = await read();
            return blob === null ? null : make(blob);
        };
        const turn = last.then(shrink, shrink);
        last = turn;
        return turn;
    };
}

export function browserPictures(scope: PictureScope): PicturePort {
    const inTurn = oneAtATime();
    return {
        decode: (read, maxSide) => inTurn(read, (blob) => decoded(scope, blob, maxSide)),
        thumbnail: (read, side) => inTurn(read, (blob) => thumbnail(scope, blob, side)),
        preview: (read, maxSide) => inTurn(read, (blob) => preview(scope, blob, maxSide)),
        blank: (width, height) => pictureOf(canvasOf(scope, width, height)),
        draw,
    };
}
