/**
 * What the Mapbox adapter takes from the page, on a real Chromium (the `engine-browser` project of vitest.config.ts):
 * the node tests of test/map hand `createMapboxPort` fakes of animation frames, the ResizeObserver on the map's box and
 * the canvas the sprites are drawn on; here `browserAdapterEnv(window)` is the real thing. No map is created: a Mapbox
 * map load is billed, and the e2e tier runs the real mapbox-gl behind its firewall.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { browserAdapterEnv } from '../../src/map/env.js';
import { PHOTO_CAMERA_ICON, PHOTO_CLUSTER_ICON, drawIcon } from '../../src/map/icons.js';

/** Resolves on the next animation frame. */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

/** How many of the image's pixels are not fully transparent. */
function paintedPixels(data: Uint8ClampedArray): number {
    return data.filter((_value, index) => index % 4 === 3 && data[index] !== 0).length;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('browserAdapterEnv(window)', () => {
    it('happyPath_aRequestedFrameRunsAndACancelledOneNever', async () => {
        const env = browserAdapterEnv(window);
        const ran: string[] = [];

        env.frames.request(() => ran.push('kept'));
        env.frames.cancel(env.frames.request(() => ran.push('cancelled')));
        await nextFrame();
        await nextFrame();

        expect(ran).toEqual(['kept']);
    });

    it('happyPath_theMapBoxIsFollowedUntilObservingStops', async () => {
        const box = document.createElement('div');
        box.style.width = '200px';
        box.style.height = '100px';
        document.body.append(box);
        const sizes: number[] = [];
        const stop = browserAdapterEnv(window).observeResize(box, () => sizes.push(box.clientWidth));
        await expect.poll(() => sizes).toEqual([200]);

        box.style.width = '300px';
        await expect.poll(() => sizes).toEqual([200, 300]);
        stop();
        box.style.width = '400px';
        await nextFrame();
        await nextFrame();

        expect(sizes).toEqual([200, 300]);
    });

    it('happyPath_theSpritesAreDrawnOnARealCanvas', async () => {
        const icons = browserAdapterEnv(window).icons;

        const camera = await drawIcon(PHOTO_CAMERA_ICON, icons);
        const cluster = await drawIcon(PHOTO_CLUSTER_ICON, icons);

        expect([camera?.width, cluster?.width]).toEqual([64, 72]);
        expect(paintedPixels(camera?.data ?? new Uint8ClampedArray())).toBeGreaterThan(64 * 64 * 0.2);
        expect(paintedPixels(cluster?.data ?? new Uint8ClampedArray())).toBeGreaterThan(72 * 72 * 0.2);
    });

    it('badPath_aFontTheBrowserCannotParseIsReportedUnavailable', async () => {
        const icons = browserAdapterEnv(window).icons;

        await expect(icons.loadFont('not a font shorthand')).resolves.toBe(false);
        await expect(icons.loadFont('16px "No Such Family Anywhere"')).resolves.toBe(false);
    });

    it('happyPath_theWebGl2ProbeAgreesWithTheBrowser', () => {
        const supported = document.createElement('canvas').getContext('webgl2') !== null;

        expect(browserAdapterEnv(window).probeWebGL()).toBe(supported);
    });
});
