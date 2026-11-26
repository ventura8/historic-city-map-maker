import { describe, expect, it } from 'vitest';

import { OVERLAY_KINDS } from '../../src/overlays/model.js';
import {
    MAP_LAYER_TYPES,
    OPACITY_PROPERTIES,
    OVERLAY_LAYER_TYPES,
    overlayOpacityPaint,
    rasterAdjustmentPaint,
} from '../../src/overlays/paint.js';

function asTriples(kind: (typeof OVERLAY_KINDS)[number], opacity: number, base = {}): readonly (string | number)[][] {
    return overlayOpacityPaint(kind, opacity, base).map((update) => [update.layerType, update.property, update.value]);
}

describe('overlay opacity paint', () => {
    it('happyPath_aRasterFadesWithRasterOpacity', () => {
        expect(asTriples('raster', 0.4)).toEqual([['raster', 'raster-opacity', 0.4]]);
    });

    it('happyPath_thePhotosFadeTheirIconsLabelsAndCones', () => {
        expect(asTriples('photos', 0.5)).toEqual([
            ['symbol', 'icon-opacity', 0.5],
            ['symbol', 'text-opacity', 0.5],
            ['fill', 'fill-opacity', 0.5],
            ['line', 'line-opacity', 0.5],
        ]);
    });

    it('happyPath_aPoiCategoryFadesEveryVectorType', () => {
        expect(asTriples('poi', 1).map(([, property]) => property)).toEqual([
            'icon-opacity',
            'text-opacity',
            'circle-opacity',
            'circle-stroke-opacity',
            'line-opacity',
            'fill-opacity',
        ]);
    });

    it('happyPath_eachPropertyScalesItsDesignedOpacity', () => {
        expect(asTriples('photos', 0.5, { 'fill-opacity': 0.25, 'line-opacity': 0.6 })).toEqual([
            ['symbol', 'icon-opacity', 0.5],
            ['symbol', 'text-opacity', 0.5],
            ['fill', 'fill-opacity', 0.125],
            ['line', 'line-opacity', 0.3],
        ]);
    });

    it.each([
        [1.5, 1],
        [-2, 0],
        [Number.NaN, 1],
    ])('badPath_opacity_%s_drawsAt_%s', (opacity, expected) => {
        expect(asTriples('raster', opacity)).toEqual([['raster', 'raster-opacity', expected]]);
    });

    it('badPath_aBaseAbove1IsClamped', () => {
        expect(asTriples('raster', 0.9, { 'raster-opacity': 3 })).toEqual([['raster', 'raster-opacity', 1]]);
    });

    it('happyPath_everyKindAndLayerTypeIsMapped', () => {
        const byText = (a: string, b: string): number => a.localeCompare(b);

        expect(Object.keys(OVERLAY_LAYER_TYPES).toSorted(byText)).toEqual([...OVERLAY_KINDS].toSorted(byText));
        expect(Object.keys(OPACITY_PROPERTIES).toSorted(byText)).toEqual([...MAP_LAYER_TYPES].toSorted(byText));
    });
});

describe('raster adjustment paint', () => {
    it('happyPath_noAdjustmentsAreNeutral', () => {
        const neutral = { 'raster-brightness-min': 0, 'raster-brightness-max': 1, 'raster-contrast': 0, 'raster-saturation': 0 };

        expect(rasterAdjustmentPaint()).toEqual(neutral);
        expect(rasterAdjustmentPaint({})).toEqual(neutral);
    });

    it('happyPath_valuesPassThrough', () => {
        expect(rasterAdjustmentPaint({ brightnessMin: 0.1, brightnessMax: 0.9, contrast: 0.2, saturation: -1 })).toEqual({
            'raster-brightness-min': 0.1,
            'raster-brightness-max': 0.9,
            'raster-contrast': 0.2,
            'raster-saturation': -1,
        });
    });

    it('badPath_liveSliderValuesAreClampedToTheirRanges', () => {
        expect(rasterAdjustmentPaint({ brightnessMin: -0.5, brightnessMax: 1.5, contrast: -3, saturation: 4 })).toEqual({
            'raster-brightness-min': 0,
            'raster-brightness-max': 1,
            'raster-contrast': -1,
            'raster-saturation': 1,
        });
    });

    it('badPath_crossedBrightnessNeverInvertsTheImage', () => {
        expect(rasterAdjustmentPaint({ brightnessMin: 0.8, brightnessMax: 0.3 })).toMatchObject({
            'raster-brightness-min': 0.3,
            'raster-brightness-max': 0.3,
        });
    });

    it('badPath_aNonFiniteValueIsNeutral', () => {
        expect(rasterAdjustmentPaint({ contrast: Number.NaN, saturation: Number.NEGATIVE_INFINITY })).toMatchObject({
            'raster-contrast': 0,
            'raster-saturation': 0,
        });
    });
});
