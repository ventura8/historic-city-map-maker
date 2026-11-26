import { FakeMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { cornersOfBox, PictureOverlays } from '../../src/imagery/overlay.js';
import { mapboxHandle } from './maps.js';

const PICTURE = { canvas: { id: 1 }, width: 400, height: 300 };
const CORNERS = cornersOfBox([
    [26, 44.4],
    [26.2, 44.5],
]);

describe('pictures on the admin map', () => {
    it('happyPath_aPictureIsACanvasSourceWithARasterLayerInTheMiddleSlot', async () => {
        const { handle, native } = await mapboxHandle();
        const overlays = new PictureOverlays(() => handle.port);

        overlays.show({ id: 'preview', picture: PICTURE, corners: CORNERS, opacity: 0.8 });
        overlays.show({ id: 'preview', picture: PICTURE, corners: CORNERS, opacity: 0.5 });
        overlays.setOpacity('preview', 0.3);
        overlays.setOpacity('missing', 1);

        expect(CORNERS).toEqual([
            [26, 44.5],
            [26.2, 44.5],
            [26.2, 44.4],
            [26, 44.4],
        ]);
        expect(native.sources.get('hcm-picture-preview')).toMatchObject({
            type: 'canvas',
            canvas: PICTURE.canvas,
            coordinates: CORNERS,
            animate: false,
        });
        expect(native.layers.get('hcm-picture-layer-preview')).toMatchObject({
            type: 'raster',
            source: 'hcm-picture-preview',
            slot: 'middle',
        });
        expect(native.paint.get('hcm-picture-layer-preview')).toMatchObject({ 'raster-opacity': 0.3, 'raster-fade-duration': 0 });
        expect(native.callsOf('removeSource')).toEqual([['hcm-picture-preview']]);
        expect(overlays.has('preview')).toBe(true);
    });

    it('happyPath_aRedrawnCanvasIsUploadedAgainAndClearTakesEveryPictureOff', async () => {
        const { handle, native } = await mapboxHandle();
        const overlays = new PictureOverlays(() => handle.port);
        overlays.show({ id: 'warped', picture: PICTURE, corners: CORNERS, opacity: 1 });
        const played: string[] = [];
        Object.assign(native.getSource('hcm-picture-warped') ?? {}, { play: () => played.push('play'), pause: () => played.push('pause') });

        overlays.refresh('warped');
        overlays.refresh('missing');
        overlays.show({ id: 'reference', picture: PICTURE, corners: CORNERS, opacity: 1 });
        overlays.clear();

        expect(played).toEqual(['play', 'pause']);
        expect(native.callsOf('triggerRepaint')).toHaveLength(1);
        expect([...native.layers.keys()].filter((id) => id.startsWith('hcm-picture'))).toEqual([]);
        expect(overlays.has('warped')).toBe(false);
    });

    it('happyPath_aMapThatIsNotMapboxsOrNoMapShowsNothing', () => {
        const fake = new FakeMap();
        const overlays = new PictureOverlays(() => fake);
        const none = new PictureOverlays(() => null);

        overlays.show({ id: 'preview', picture: PICTURE, corners: CORNERS, opacity: 1 });
        none.show({ id: 'preview', picture: PICTURE, corners: CORNERS, opacity: 1 });
        none.setOpacity('preview', 1);
        none.refresh('preview');
        none.remove('preview');

        expect([overlays.has('preview'), none.has('preview')]).toEqual([false, false]);
    });
});
