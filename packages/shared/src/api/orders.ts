/**
 * Buying a scan (M4, scenario A13; `docs/research/M4-interfaces.md` §1): the callables the Imagery area's order card
 * calls. Buying is the admin's own step in EarthExplorer; these record it, ask USGS now, or take the mark back. The daily
 * watch is a step of `imagery.tick` (no new schedule). The registry rows (`registry.ts`, owner `fn-orders`) join with
 * their implementation.
 */
import { z } from 'zod';

import { cityIdSchema } from '../schemas/paths.js';
import { idSchema } from '../schemas/primitives.js';
import { ORDER_STATES, SCENE_ACQUISITION_STATES } from '../schemas/usgs-order.js';
import { isoTimeSchema } from './common.js';

const sceneField = { cityId: cityIdSchema, entityId: idSchema };

/**
 * `usgs.markOrdered` (admin): "I ordered it". Refuses a scene USGS already lists as downloadable
 * (`apiError.usgs.alreadyAvailable`: Import is free) and one that has an order or was imported (`apiError.usgs.orderState`).
 */
export const usgsMarkOrderedRequestSchema = z.strictObject(sceneField);
export const usgsMarkOrderedResponseSchema = z.strictObject({ state: z.literal('ordered'), nextCheckAt: isoTimeSchema });

/**
 * `usgs.checkOrder` (admin): "Check now", at most once a minute per scene (`apiError.rateLimited`). Delivered: the import
 * starts at once (or with the next tick while the budget guard is red or today's raster jobs are used up).
 * `fromOrderPage`: the admin confirms USGS's e-mail download page already has the scan (M2M may still say no); the
 * scene becomes free and the import starts so a staged `usgs-raw/` delivery on the worker can run.
 */
export const usgsCheckOrderRequestSchema = z.strictObject({
    ...sceneField,
    fromOrderPage: z.boolean().optional(),
});
export const usgsCheckOrderResponseSchema = z.strictObject({
    state: z.enum(ORDER_STATES),
    /** USGS lists the download now. */
    available: z.boolean(),
    /** The import job the delivery started (the version has the same id). */
    jobId: idSchema.optional(),
});

/** `usgs.cancelOrder` (admin): the mark taken back (a mistake, or an order cancelled at USGS); not once delivered. */
export const usgsCancelOrderRequestSchema = z.strictObject(sceneField);
export const usgsCancelOrderResponseSchema = z.strictObject({ state: z.enum(SCENE_ACQUISITION_STATES) });

export type UsgsMarkOrderedRequest = z.infer<typeof usgsMarkOrderedRequestSchema>;
export type UsgsCheckOrderResponse = z.infer<typeof usgsCheckOrderResponseSchema>;
