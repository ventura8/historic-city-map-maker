import { describe, expect, it } from 'vitest';

import {
    ADJUSTMENT_SLIDERS,
    adjustmentDelta,
    adjustmentFromSlider,
    normalizeAdjustments,
    sameAdjustments,
    signedPercent,
    sliderFromAdjustment,
    withAdjustment,
} from '../../src/overlays/adjustments.js';
import { rasterAdjustmentPaint } from '../../src/overlays/paint.js';
import { layerAdjustmentsSchema } from '../../src/schemas/manifest.js';

describe('the image adjustment sliders', () => {
    it('happyPath_fourSlidersInPercentWithTheirNeutralPositions', () => {
        expect(ADJUSTMENT_SLIDERS).toEqual([
            { name: 'brightnessMin', min: 0, max: 100, neutral: 0 },
            { name: 'brightnessMax', min: 0, max: 100, neutral: 100 },
            { name: 'contrast', min: -100, max: 100, neutral: 0 },
            { name: 'saturation', min: -100, max: 100, neutral: 0 },
        ]);
    });

    it('happyPath_everyWholePercentRoundTripsExactly', () => {
        for (const slider of ADJUSTMENT_SLIDERS) {
            for (let percent = slider.min; percent <= slider.max; percent += 1) {
                const stored = adjustmentFromSlider(slider.name, percent);
                expect(sliderFromAdjustment(slider.name, stored)).toBe(percent);
                expect(stored).toBe(percent / 100);
            }
        }
    });

    it('happyPath_anAbsentValueSitsAtNeutral', () => {
        expect(sliderFromAdjustment('brightnessMax', undefined)).toBe(100);
        expect(sliderFromAdjustment('contrast', undefined)).toBe(0);
    });

    it('badPath_outOfRangeAndBrokenNumbersAreHeldInRange', () => {
        expect(adjustmentFromSlider('contrast', 250)).toBe(1);
        expect(adjustmentFromSlider('saturation', -400)).toBe(-1);
        expect(adjustmentFromSlider('brightnessMin', Number.NaN)).toBe(0);
        expect(adjustmentFromSlider('brightnessMax', Number.POSITIVE_INFINITY)).toBe(1);
        expect(sliderFromAdjustment('contrast', adjustmentFromSlider('contrast', 12.6))).toBe(13);
        expect(sliderFromAdjustment('contrast', 7)).toBe(100);
    });

    it('happyPath_theValueTextIsTheSignedDistanceFromNeutral', () => {
        expect(signedPercent('contrast', 20)).toBe('+20');
        expect(signedPercent('saturation', -15)).toBe('-15');
        expect(signedPercent('brightnessMax', 80)).toBe('-20');
        expect(signedPercent('brightnessMin', 0)).toBe('0');
        expect(adjustmentDelta('brightnessMin', 10)).toBe(10);
    });
});

describe('moving one adjustment', () => {
    it('happyPath_setsTheStoredValueOfTheSlider', () => {
        expect(withAdjustment({ contrast: 0.2 }, 'saturation', -30)).toEqual({ contrast: 0.2, saturation: -0.3 });
    });

    it('badPath_theBrightnessMinimumStopsAtTheMaximum', () => {
        expect(withAdjustment({ brightnessMax: 0.6 }, 'brightnessMin', 90)).toEqual({ brightnessMax: 0.6, brightnessMin: 0.6 });
    });

    it('badPath_theBrightnessMaximumStopsAtTheMinimum', () => {
        expect(withAdjustment({ brightnessMin: 0.4 }, 'brightnessMax', 10)).toEqual({ brightnessMin: 0.4, brightnessMax: 0.4 });
    });

    it('happyPath_theLevelsMoveFreelyWhileTheyDoNotCross', () => {
        expect(withAdjustment({}, 'brightnessMin', 30)).toEqual({ brightnessMin: 0.3 });
        expect(withAdjustment({}, 'brightnessMax', 70)).toEqual({ brightnessMax: 0.7 });
    });
});

describe('the stored form', () => {
    it('happyPath_neutralValuesAreDropped', () => {
        expect(normalizeAdjustments({ brightnessMin: 0, brightnessMax: 1, contrast: 0.25, saturation: 0 })).toEqual({ contrast: 0.25 });
    });

    it('happyPath_allNeutralIsNoAdjustmentAtAll', () => {
        expect(normalizeAdjustments({})).toBeUndefined();
        expect(normalizeAdjustments({ contrast: 0, saturation: 0, brightnessMin: 0, brightnessMax: 1 })).toBeUndefined();
    });

    it('badPath_crossedLevelsAreStoredUncrossed', () => {
        const stored = normalizeAdjustments({ brightnessMin: 0.8, brightnessMax: 0.3 });

        expect(stored).toEqual({ brightnessMin: 0.3, brightnessMax: 0.3 });
        expect(layerAdjustmentsSchema.safeParse(stored).success).toBe(true);
    });

    it('happyPath_theStoredFormPaintsTheSameAsTheDraft', () => {
        const draft = { brightnessMin: 0.1, brightnessMax: 0.9, contrast: -0.2, saturation: 0.35 };

        expect(rasterAdjustmentPaint(normalizeAdjustments(draft))).toEqual(rasterAdjustmentPaint(draft));
    });

    it('happyPath_sameAdjustmentsComparesWhatIsDrawn', () => {
        expect(sameAdjustments(undefined, { contrast: 0, brightnessMax: 1 })).toBe(true);
        expect(sameAdjustments({ contrast: 0.2 }, { contrast: 0.2, saturation: 0 })).toBe(true);
        expect(sameAdjustments({ contrast: 0.2 }, undefined)).toBe(false);
    });
});
