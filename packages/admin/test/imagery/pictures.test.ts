import { describe, expect, it } from 'vitest';

import { browserPictures, type CanvasLike, type Context2d, type PictureScope } from '../../src/imagery/pictures.js';

interface Recorded {
    readonly canvases: CanvasLike[];
    readonly calls: string[];
    /** What each `createImageBitmap` was asked for: what the page decodes, and how large it keeps it. */
    readonly sizes: unknown[];
}

interface ScopeOptions {
    readonly fail?: boolean;
    readonly noContext?: boolean;
    /** The image's real size (a bitmap comes back at it, or resized keeping its proportions as a browser does). */
    readonly image?: readonly [number, number];
    readonly noBlob?: boolean;
}

/** What `createImageBitmap` answers of an image of `[width, height]`: one side asked for, the other in proportion. */
function resized(
    [width, height]: readonly [number, number],
    size: { resizeWidth?: number; resizeHeight?: number } = {},
): readonly [number, number] {
    if (size.resizeHeight !== undefined) {
        return [Math.round((width * size.resizeHeight) / height), size.resizeHeight];
    }
    return size.resizeWidth === undefined ? [width, height] : [size.resizeWidth, Math.round((height * size.resizeWidth) / width)];
}

function scope(options: ScopeOptions = {}): PictureScope & Recorded {
    const canvases: CanvasLike[] = [];
    const calls: string[] = [];
    const sizes: unknown[] = [];
    const context = new Proxy({} as Context2d, {
        get:
            (_target, name: string) =>
            (...args: unknown[]) => {
                calls.push(`${name}(${args.map((arg) => (typeof arg === 'number' ? String(arg) : 'image')).join(',')})`);
            },
    });
    return {
        canvases,
        calls,
        sizes,
        createImageBitmap: (blob, size) => {
            sizes.push(size);
            const [width, height] = resized(options.image ?? [8000, 4000], size);
            return options.fail === true
                ? Promise.reject(new Error(`not an image: ${blob.type}`))
                : Promise.resolve({ width, height, close: () => calls.push('close') });
        },
        URL: { createObjectURL: (blob) => `blob:${blob.type}:${String(blob.size)}` },
        document: {
            createElement: () => {
                const canvas = {
                    width: 0,
                    height: 0,
                    getContext: () => (options.noContext === true ? null : context),
                    toBlob: (done: (blob: Blob | null) => void, type: string) => {
                        done(options.noBlob === true ? null : new Blob(['small'], { type }));
                    },
                };
                canvases.push(canvas);
                return canvas;
            },
        },
    };
}

describe('pictures drawn in a canvas', () => {
    it('happyPath_aBlobIsDecodedIntoACanvasAtMostMaxSideLong', async () => {
        const page = scope();

        const picture = await browserPictures(page).decode(() => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })), 2000);

        expect(picture).toMatchObject({ width: 2000, height: 1000 });
        expect(page.calls).toEqual(['drawImage(image,0,0,2000,1000)', 'close']);
    });

    it('badPath_aBlobThatIsNoImageIsNone', async () => {
        await expect(browserPictures(scope({ fail: true })).decode(() => Promise.resolve(new Blob(['x'])), 2000)).resolves.toBeNull();
    });

    it('happyPath_theWarpClearsThenDrawsEachTriangleClipped', () => {
        const page = scope();
        const pictures = browserPictures(page);
        const target = pictures.blank(100.4, 0.2);
        const source = pictures.blank(10, 10);

        pictures.draw(target, source, [
            {
                clip: [
                    [0, 0],
                    [10, 0],
                    [0, 10],
                ],
                transform: [2, 0, 0, 2, 5, 5],
            },
        ]);

        expect([target.width, target.height]).toEqual([100, 1]);
        expect(page.calls).toEqual([
            'setTransform(1,0,0,1,0,0)',
            'clearRect(0,0,100,1)',
            'save()',
            'beginPath()',
            'moveTo(0,0)',
            'lineTo(10,0)',
            'lineTo(0,10)',
            'closePath()',
            'clip()',
            'setTransform(2,0,0,2,5,5)',
            'drawImage(image,0,0)',
            'restore()',
        ]);
    });

    it('badPath_aCanvasWithoutAContextDrawsNothing', async () => {
        const page = scope({ noContext: true });
        const pictures = browserPictures(page);

        pictures.draw(pictures.blank(10, 10), pictures.blank(10, 10), [
            {
                clip: [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                ],
                transform: [1, 0, 0, 1, 0, 0],
            },
        ]);
        const decoded = await pictures.decode(() => Promise.resolve(new Blob(['x'])), 100);

        expect(page.calls).toEqual(['close']);
        expect(decoded).toMatchObject({ width: 100, height: 50 });
    });
});

describe('the browse images a page shows', () => {
    const FILE = new Blob(['huge'], { type: 'image/jpeg' });
    const read = (): Promise<Blob | null> => Promise.resolve(FILE);

    it('happyPath_aHugeImageIsNeverDecodedAtFullSizeForAThumbnail', async () => {
        const page = scope({ image: [37_440, 1920] });

        const url = await browserPictures(page).thumbnail(read, 128);

        // Asked of the decoder itself, off the main thread: no full-size bitmap ever reaches the page.
        expect(page.sizes).toEqual([{ resizeHeight: 128, resizeQuality: 'medium' }]);
        expect(page.canvases.map(({ width, height }) => [width, height])).toEqual([[128, 128]]);
        // The middle of the 2,496 px strip, as the row's `object-fit: cover` showed it, and the bitmap is let go.
        expect(page.calls).toEqual(['drawImage(image,-1184,0)', 'close']);
        expect(url).toBe('blob:image/jpeg:5');
    });

    it('happyPath_aTallImageIsDecodedAgainBySmallWidthNotStretched', async () => {
        const page = scope({ image: [1920, 37_440] });

        await browserPictures(page).thumbnail(read, 128);

        expect(page.sizes).toEqual([
            { resizeHeight: 128, resizeQuality: 'medium' },
            { resizeWidth: 128, resizeQuality: 'medium' },
        ]);
        expect(page.canvases.map(({ width, height }) => [width, height])).toEqual([[128, 128]]);
        expect(page.calls).toEqual(['close', 'drawImage(image,0,-1184)', 'close']);
    });

    it('badPath_aFileThatIsNoImageOrIsMissingHasNoThumbnail', async () => {
        const refused = browserPictures(scope({ fail: true }));
        const fine = browserPictures(scope());

        await expect(refused.thumbnail(read, 128)).resolves.toBeNull();
        await expect(refused.preview(read, 2048)).resolves.toBeNull();
        await expect(fine.thumbnail(() => Promise.resolve(null), 128)).resolves.toBeNull();
    });

    it('badPath_aCanvasTheBrowserCannotEncodeHasNoAddress', async () => {
        await expect(browserPictures(scope({ noBlob: true })).thumbnail(read, 128)).resolves.toBeNull();
    });

    it('happyPath_thePreviewIsTheWholeImageAtMostMaxSideLong', async () => {
        const page = scope({ image: [37_440, 1920] });

        const url = await browserPictures(page).preview(read, 2048);

        expect(page.canvases.map(({ width, height }) => [width, height])).toEqual([[2048, 105]]);
        expect(url).toBe('blob:image/jpeg:5');
    });

    it('happyPath_theMapsFullSizeDecodeWaitsItsTurnWithTheOthers', async () => {
        const pictures = browserPictures(scope());
        const answers: ((blob: Blob | null) => void)[] = [];
        const order: string[] = [];
        const first = pictures.preview(() => {
            order.push('preview read');
            return new Promise((resolve) => answers.push(resolve));
        }, 2048);

        const map = pictures.decode(() => {
            order.push('map read');
            return read();
        }, 2048);
        await Promise.resolve();
        await Promise.resolve();
        const whileThePreviewRuns = [...order];
        answers[0]?.(FILE);

        await first;
        await expect(map).resolves.not.toBeNull();
        expect(whileThePreviewRuns).toEqual(['preview read']);
        expect(order).toEqual(['preview read', 'map read']);
    });

    it('badPath_aDecodeOfNothingReadIsNone', async () => {
        await expect(browserPictures(scope()).decode(() => Promise.resolve(null), 2048)).resolves.toBeNull();
    });

    it('happyPath_picturesAreMadeOneAtATimeEvenAfterAFailure', async () => {
        const pictures = browserPictures(scope());
        const order: string[] = [];
        const answers: ((blob: Blob | null) => void)[] = [];

        const first = pictures.thumbnail(() => {
            order.push('first read');
            return new Promise((resolve) => answers.push(resolve));
        }, 128);
        const second = pictures.preview(() => {
            order.push('second read');
            return Promise.reject(new Error('offline'));
        }, 2048);
        const third = pictures.thumbnail(() => {
            order.push('third read');
            return read();
        }, 128);
        await Promise.resolve();
        await Promise.resolve();
        const whileTheFirstRuns = [...order];
        answers[0]?.(FILE);

        await expect(first).resolves.not.toBeNull();
        await expect(second).rejects.toThrow('offline');
        await expect(third).resolves.not.toBeNull();
        expect(whileTheFirstRuns).toEqual(['first read']);
        expect(order).toEqual(['first read', 'second read', 'third read']);
    });
});
