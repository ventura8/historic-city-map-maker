/**
 * Relabels a busy layer for the join callables: `apiError.layers.busy` becomes `apiError.imagery.joinLayerBusy`
 * (admin sweep 2026-11-14); any other failure passes through unchanged.
 */
import { ApiError } from '../api/api-error.js';

/** Throws `joinLayerBusy` for a busy layer, else rethrows `error`. */
export function asJoinLayerBusy(error: unknown): never {
    throw error instanceof ApiError && error.code === 'apiError.layers.busy' ? new ApiError('apiError.imagery.joinLayerBusy') : error;
}
