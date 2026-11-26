/**
 * The installable app's files (`scripts/site/src/app.ts`, `app-icons.ts`): the manifest beside the page, the three PNG icons
 * the build draws (read back pixel by pixel), the city site's worker and its page lines, and the admin's app
 * (`admin/app.ts`), whose worker is the push worker with lines that keep nothing.
 */
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { appFiles, appRelease, siteAppLines, siteBuildFile, siteWorkerFile } from '../src/app.js';
import { appIconFiles, encodePng, glyphOutlines } from '../src/app-icons.js';
import { ADMIN_APP_FILES } from '../src/admin/app.js';
import { PUSH_SERVICE_WORKER_SOURCE } from '../src/admin/service-worker.js';

/** The RGBA pixels and size of a PNG the build wrote (8-bit RGBA, unfiltered rows). */
function decode(png: Uint8Array): { readonly size: number; readonly pixel: (x: number, y: number) => number[] } {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const size = view.getUint32(16);
    let offset = 8;
    const data: Uint8Array[] = [];
    while (offset < png.length) {
        const length = view.getUint32(offset);
        const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
        if (type === 'IDAT') {
            data.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }
    const rows = inflateSync(Buffer.concat(data));
    const pixel = (x: number, y: number): number[] => {
        const at = y * (size * 4 + 1) + 1 + x * 4;
        return [...rows.subarray(at, at + 4)];
    };
    return { size, pixel };
}

function whitePixels(image: ReturnType<typeof decode>): number {
    let count = 0;
    for (let y = 0; y < image.size; y += 1) {
        for (let x = 0; x < image.size; x += 1) {
            count += image.pixel(x, y).join() === '255,255,255,255' ? 1 : 0;
        }
    }
    return count;
}

describe('appIconFiles', () => {
    const [small, large, maskable] = appIconFiles('#8B5E3C').map((file) => ({ ...file, image: decode(file.content) }));

    it('happyPath_threePngsNamedAsTheManifestNamesThem', () => {
        expect([small?.to, large?.to, maskable?.to]).toEqual(['app-icon-192.png', 'app-icon-512.png', 'app-icon-maskable-512.png']);
        expect([small?.image.size, large?.image.size, maskable?.image.size]).toEqual([192, 512, 512]);
        expect([...(large?.content.subarray(0, 8) ?? [])]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });

    it('happyPath_theRoundedSquareHasTransparentCornersAndTheThemeColour', () => {
        expect(large?.image.pixel(0, 0)).toEqual([139, 94, 60, 0]);
        expect(large?.image.pixel(40, 256)).toEqual([139, 94, 60, 255]);
        expect(whitePixels(large?.image ?? decode(encodePng(1, new Uint8Array(4))))).toBeGreaterThan(10_000);
    });

    it('happyPath_theMaskableIconIsColouredToEveryEdgeWithASmallerGlyph', () => {
        expect(maskable?.image.pixel(0, 0)).toEqual([139, 94, 60, 255]);
        expect(maskable?.image.pixel(511, 511)).toEqual([139, 94, 60, 255]);
        // The safe circle (80 % of the side) holds every white pixel: the 10 % margin is all colour.
        const margin = [0, 25, 486, 511].flatMap((edge) => [maskable?.image.pixel(edge, 256), maskable?.image.pixel(256, edge)]);
        expect(margin.every((pixel) => pixel?.join() === '139,94,60,255')).toBe(true);
        expect(whitePixels(maskable?.image ?? decode(encodePng(1, new Uint8Array(4))))).toBeLessThan(
            whitePixels(large?.image ?? decode(encodePng(1, new Uint8Array(4)))),
        );
    });

    it('badPath_aColourThatIsNoHexIsRefused', () => {
        expect(() => appIconFiles('brown')).toThrow(RangeError);
    });

    it('happyPath_theGlyphsOutlinesAreClosedShapes', () => {
        const outlines = glyphOutlines();
        expect(outlines.length).toBeGreaterThan(2);
        expect(glyphOutlines('M0,0L10,0Q10,10 0,10Z')).toHaveLength(1);
        expect(glyphOutlines('M0,0L10,0Z')).toEqual([]);
        // One Q with two curves: the second starts where the first ended.
        const [curves] = glyphOutlines('M0,0Q5,0 10,0 15,0 20,0Z');
        expect(curves).toHaveLength(17);
        expect(curves?.at(-1)).toEqual([20, 0]);
    });
});

describe('appFiles', () => {
    it('happyPath_theManifestBesideThePageNamesThePageAndItsColour', () => {
        const files = appFiles({ title: 'București dispărut', lang: 'ro', themeColor: '#8B5E3C' });
        const manifest = JSON.parse(String(files[0]?.content)) as Record<string, unknown>;

        expect(files.map((file) => file.to)).toEqual([
            'app.webmanifest',
            'app-icon-192.png',
            'app-icon-512.png',
            'app-icon-maskable-512.png',
        ]);
        expect(manifest).toMatchObject({ name: 'București dispărut', start_url: './', scope: './', id: './', theme_color: '#8B5E3C' });
    });

    it('happyPath_theSitesWorkerKeepsAnOfflineCopyNamedByItsRelease', () => {
        const release = appRelease('<html>', 'config');

        expect(release).toMatch(/^[0-9a-f]{16}$/);
        expect(appRelease('<html>', 'config2')).not.toBe(release);
        expect(siteWorkerFile(release).to).toBe('sw.js');
        expect(String(siteWorkerFile(release).content)).toContain(`"release":"${release}","offline":true`);
        expect(siteAppLines(release)).toContain('{"worker":"sw.js","scope":"./"}');
    });

    it('happyPath_thePageScriptComparesItsBuildWithTheOneServed', () => {
        const release = appRelease('<html>', new Uint8Array([1, 2, 3]));

        expect(release).not.toBe(appRelease('<html>', new Uint8Array([1, 2, 4])));
        expect(siteBuildFile(release)).toEqual({ to: 'app-build.json', content: `{"build":"${release}"}\n` });
        expect(siteAppLines(release)).toContain(`(window, {"build":"${release}","version":"app-build.json"}, { mark: `);
    });
});

describe('ADMIN_APP_FILES', () => {
    it('happyPath_thePushWorkerCarriesTheAppsLinesThatKeepNothing', () => {
        const worker = ADMIN_APP_FILES.find((file) => file.to === 'firebase-messaging-sw.js');
        const manifest = ADMIN_APP_FILES.find((file) => file.to === 'app.webmanifest');
        const script = ADMIN_APP_FILES.find((file) => file.to === 'app.js');

        expect(String(worker?.content).startsWith(PUSH_SERVICE_WORKER_SOURCE)).toBe(true);
        expect(String(worker?.content)).toContain('"offline":false');
        expect(JSON.parse(String(manifest?.content))).toMatchObject({ name: 'Administrarea hărții', scope: './', id: './' });
        expect(String(script?.content)).toContain('{"worker":"firebase-messaging-sw.js","scope":"./"}');
        // The admin follows runtime.json itself (release-reload.ts): its page script only asks the worker to update.
        expect(String(script?.content)).toContain('(window, {}, { mark: ');
    });
});
