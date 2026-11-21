/**
 * M8 (`docs/research/M8-join-interfaces.md` §2): `cities/{city}/imageryPlans/dates`, the server's plan of which frames make
 * each date's whole-city layer (the admin's scene list is paged and filtered, so a neighbour could be missing from it).
 * `imagery/join.ts` computes the rows; the imagery functions write the document; a city member reads it.
 */
import { z } from 'zod';

import { timestampSchema } from './firestore-common.js';
import { JOIN_MAX_PARTS } from './imagery-settings.js';
import { LAYER_VERSION_STATES } from './imagery.js';
import { idSchema, isoDateSchema, plainText } from './primitives.js';
import { SENSORS } from './usgs-scene.js';

/** At most this many dates in the plan: the best first. */
export const DATE_PLAN_MAX_ROWS = 30;

/** A chosen frame: its version and that version's state once it was imported. */
const datePlanFrameSchema = z.strictObject({
    entityId: idSchema,
    displayId: plainText(64).optional(),
    free: z.boolean(),
    versionId: idSchema.optional(),
    state: z.enum(LAYER_VERSION_STATES).optional(),
});

export const datePlanRowSchema = z.strictObject({
    date: isoDateSchema,
    sensor: z.enum(SENSORS),
    frames: z.array(datePlanFrameSchema).max(JOIN_MAX_PARTS),
    /** Frames that would add to the city but must be ordered: never auto-chosen; the row links the order card. */
    paidFrames: z.array(idSchema).max(JOIN_MAX_PARTS),
    /**
     * Free frames the choice left out, the most of the city first: nothing says they would add, as the estimate may be wrong, and a
     * join that came out short offers them. Absent when there are none.
     */
    spareFrames: z.array(idSchema).max(JOIN_MAX_PARTS).optional(),
    /**
     * Chosen or paid frames whose browse image shows at least `CLOUDY_CITY_PERCENT` of the city clouded (the owner's report of
     * 2026-11-13): the row warns before an import or a purchase. Absent when there are none.
     */
    cloudyFrames: z
        .array(z.strictObject({ entityId: idSchema, percent: z.number().int().min(0).max(100) }))
        .max(JOIN_MAX_PARTS * 2)
        .optional(),
    /** An estimate from the frames' outlines, worded "about"; the join page shows the measured figure. */
    coveragePct: z.number().min(0).max(100),
    /** Chosen frames not imported yet. */
    framesToDownload: z.number().int().nonnegative(),
    /** December to February: sorted lower, "may need points" (snow defeats the automatic matcher). */
    winter: z.boolean(),
});

export const datePlanDocSchema = z.strictObject({
    rows: z.array(datePlanRowSchema).max(DATE_PLAN_MAX_ROWS),
    updatedAt: timestampSchema,
});

export type DatePlanRow = z.infer<typeof datePlanRowSchema>;
export type DatePlanDoc = z.infer<typeof datePlanDocSchema>;
