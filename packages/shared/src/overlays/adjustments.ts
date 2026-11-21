/**
 * The admin's sliders for a historical layer's image adjustments (`docs/research/M2c-interfaces.md` §8.3): whole
 * percentages on screen, the stored values of `LAYER_ADJUSTMENT_RANGES` in Firestore and the manifest, and the paint
 * of `rasterAdjustmentPaint` on the map. Mapbox has no gamma property: the brightness minimum and maximum are the levels
 * control (`docs/ENGINE_API.md`).
 *
 * Pure: the layer editor's store and its sliders use the same functions, so what the admin previews is what is saved and
 * what the viewer draws (S-A35-HAPPY).
 */
import { clamp } from '../geo/math.js';
import { LAYER_ADJUSTMENT_RANGES, type LayerAdjustmentName, type LayerAdjustments } from '../schemas/manifest.js';

export interface AdjustmentSlider {
    readonly name: LayerAdjustmentName;
    /** Slider units: percent; brightness 0 to 100, contrast and saturation -100 to 100; step 1. */
    readonly min: number;
    readonly max: number;
    readonly neutral: number;
}

/** One stored unit is a hundred slider steps. */
const PERCENT = 100;

function sliderOf(name: LayerAdjustmentName): AdjustmentSlider {
    const range = LAYER_ADJUSTMENT_RANGES[name];
    return { name, min: range.min * PERCENT, max: range.max * PERCENT, neutral: range.neutral * PERCENT };
}

/** The four sliders in the editor's order: the levels (black, then white point), then contrast and saturation. */
export const ADJUSTMENT_SLIDERS: readonly AdjustmentSlider[] = (['brightnessMin', 'brightnessMax', 'contrast', 'saturation'] as const).map(
    sliderOf,
);

/** A slider position as a whole percent within the slider's range (a non-number becomes the neutral position). */
function wholePercent(name: LayerAdjustmentName, percent: number): number {
    const slider = sliderOf(name);
    return Number.isFinite(percent) ? clamp(Math.round(percent), slider.min, slider.max) : slider.neutral;
}

/** Slider value (percent) to the stored value; exact for every whole percent (`7` → `0.07`). */
export function adjustmentFromSlider(name: LayerAdjustmentName, percent: number): number {
    return wholePercent(name, percent) / PERCENT;
}

/** The stored value (absent: neutral) as the slider's whole percent. */
export function sliderFromAdjustment(name: LayerAdjustmentName, value: number | undefined): number {
    return value === undefined ? sliderOf(name).neutral : wholePercent(name, value * PERCENT);
}

/** The slider's distance from neutral, the signed percentage its `aria-valuetext` reads ("+20 %", "-15 %", "0 %"). */
export function adjustmentDelta(name: LayerAdjustmentName, percent: number): number {
    return wholePercent(name, percent) - sliderOf(name).neutral;
}

/** `adjustmentDelta` with its sign: `+20`, `-15`, `0`. */
export function signedPercent(name: LayerAdjustmentName, percent: number): string {
    const delta = adjustmentDelta(name, percent);
    return delta > 0 ? `+${String(delta)}` : String(delta);
}

/** The stored value of `name` (absent: neutral), clamped to its range. */
function storedValue(adjustments: LayerAdjustments, name: LayerAdjustmentName): number {
    return adjustmentFromSlider(name, sliderFromAdjustment(name, adjustments[name]));
}

/**
 * The adjustments with `name` moved to the slider position `percent`. The brightness minimum stops at the maximum and
 * the maximum at the minimum (S-A35-BAD-CROSSED-BRIGHTNESS): the levels never cross, live or stored.
 */
export function withAdjustment(adjustments: LayerAdjustments, name: LayerAdjustmentName, percent: number): LayerAdjustments {
    let value = adjustmentFromSlider(name, percent);
    if (name === 'brightnessMin') {
        value = Math.min(value, storedValue(adjustments, 'brightnessMax'));
    } else if (name === 'brightnessMax') {
        value = Math.max(value, storedValue(adjustments, 'brightnessMin'));
    }
    return { ...adjustments, [name]: value };
}

/** The stored form: each value clamped and rounded to a whole percent, neutral values dropped, undefined when all are. */
export function normalizeAdjustments(adjustments: LayerAdjustments): LayerAdjustments | undefined {
    const brightnessMax = storedValue(adjustments, 'brightnessMax');
    const values: Record<LayerAdjustmentName, number> = {
        brightnessMin: Math.min(storedValue(adjustments, 'brightnessMin'), brightnessMax),
        brightnessMax,
        contrast: storedValue(adjustments, 'contrast'),
        saturation: storedValue(adjustments, 'saturation'),
    };
    const kept = ADJUSTMENT_SLIDERS.filter((slider) => values[slider.name] !== LAYER_ADJUSTMENT_RANGES[slider.name].neutral);
    return kept.length === 0 ? undefined : Object.fromEntries(kept.map((slider) => [slider.name, values[slider.name]]));
}

/** Whether two adjustments draw the same image (their stored forms are equal). */
export function sameAdjustments(a: LayerAdjustments | undefined, b: LayerAdjustments | undefined): boolean {
    const left = normalizeAdjustments(a ?? {}) ?? {};
    const right = normalizeAdjustments(b ?? {}) ?? {};
    return ADJUSTMENT_SLIDERS.every((slider) => left[slider.name] === right[slider.name]);
}
