/**
 * M16 (`docs/research/M16-recalibrate.md`): a published layer, or a version waiting for approval, calibrated again. A recalibration is a
 * `regeoref` version that carries `recalibration`: how it was asked for (`route`), the admin's rough points, and what the pipeline
 * measured: the current fit and the new one **on the same checks** (§2), so the two figures compare. The Python twin is
 * `hcm_pipeline/documents.py` `RecalibrationInfo` and `calibrate/recalibrate.py` (`RECALIBRATE_MIN_GAIN_M`).
 */
import { z } from 'zod';

import { pixelSchema } from './georef.js';
import { idSchema, latLngSchema } from './primitives.js';

/** How it was asked for: Refine automatically, Snap my points, or the georeferencer's Save. */
export const RECALIBRATE_ROUTES = ['auto', 'points', 'manual'] as const;

export type RecalibrateRoute = (typeof RECALIBRATE_ROUTES)[number];

/** The routes a callable starts (`imagery.recalibrate`); the georeferencer's Save is `manual`. */
export const RECALIBRATE_STARTED = ['auto', 'points'] as const;

/** At most this many rough points. */
export const RECALIBRATE_MAX_POINTS = 12;

/** The new fit is better only by at least this much on the same checks (ground metres): a dozen checks move about that with a seed. */
export const RECALIBRATE_MIN_GAIN_M = 1;

/** Fewer disabled pairs compare nothing: a manual version without them reads `unmeasured`. */
export const RECALIBRATE_MIN_CHECKS = 3;

/**
 * A refine that renders nothing ends **declined** with one of these: its job and version `cancelled` with the error, so the layer is released
 * and nothing else changes (`pipeline/src/hcm_pipeline/jobs.py` `Declined`; `worker.step` accepts that ending on a `regeoref` job).
 */
export const RECALIBRATE_DECLINED_CODES = [
    'apiError.imagery.notImproved',
    'apiError.imagery.refineRefused',
    // Too few held-out checks to compare the two fits: the tiles agreed, only the comparison was impossible.
    'apiError.imagery.refineUnmeasured',
] as const;

/** True for a decline's error code. */
export function isDeclinedCode(code: string | undefined): boolean {
    return (RECALIBRATE_DECLINED_CODES as readonly (string | undefined)[]).includes(code);
}

const count = z.number().int().min(0);

/** A pixel of the scan and where the admin says it lies. */
export const roughPointSchema = z.strictObject({ pixel: pixelSchema, geo: latLngSchema });

export type RoughPoint = z.infer<typeof roughPointSchema>;

/** A checkpoint figure: ground metres over `checks` pairs. */
const figureSchema = z.strictObject({ rmseM: z.number().min(0), checks: count });

export const recalibrationSchema = z.strictObject({
    route: z.enum(RECALIBRATE_ROUTES),
    /** The version waiting for approval that this one replaces once it is rendered (Refine, Snap: §5). */
    replaces: idSchema.optional(),
    points: z.array(roughPointSchema).min(1).max(RECALIBRATE_MAX_POINTS).optional(),
    /** The current version's fit on this version's checkpoints. */
    before: figureSchema.optional(),
    /** This version's fit on the same checkpoints. */
    after: figureSchema.optional(),
    /** The proof's tiles: `{agreed} of {tried}`. */
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    /** The new pairs near the rough points. */
    proposed: count.optional(),
});

export type Recalibration = z.infer<typeof recalibrationSchema>;

export type RecalibrationVerdict = 'better' | 'worse' | 'unmeasured';

/** The one reading of the figures: better by at least `RECALIBRATE_MIN_GAIN_M` on the same checks, worse, or not compared. */
export function recalibrationVerdict(recalibration: Pick<Recalibration, 'before' | 'after'>): RecalibrationVerdict {
    const { before, after } = recalibration;
    if (before === undefined || after === undefined) {
        return 'unmeasured';
    }
    return after.rmseM <= before.rmseM - RECALIBRATE_MIN_GAIN_M ? 'better' : 'worse';
}
