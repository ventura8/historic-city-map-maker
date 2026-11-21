/**
 * The tile-import wizard's callables (`docs/research/M20-import-local.md` §19.10; `functions/src/imagery/save-layout.ts`,
 * `accept-layout.ts`): an archive series that waits with `layout-check` gets the owner's layout, and then goes on to points.
 */
import { z } from 'zod';

import { layoutAnswerFields } from '../schemas/imagery-tiles.js';
import { cityIdSchema } from '../schemas/paths.js';
import { idSchema } from '../schemas/primitives.js';

const versionIdField = { cityId: cityIdSchema, versionId: idSchema };

/**
 * `imagery.saveLayout` (a city editor): the owner's sheets and seams on the layout's `revision`, refused when the pipeline wrote a newer
 * one (`apiError.imagery.layoutStale`). The answer becomes `help.layoutAnswer` and the series' job runs again from `place`: with
 * `preview` it makes the real preview and waits again; without, it goes on to the stitched picture and points.
 */
export const imagerySaveLayoutRequestSchema = z.strictObject({ ...versionIdField, ...layoutAnswerFields });

/** `imagery.acceptLayout` (a city editor): the layout of `revision` as it stands, accepted; the series goes on to points. */
export const imageryAcceptLayoutRequestSchema = z.strictObject({ ...versionIdField, revision: layoutAnswerFields.revision });

/**
 * `imagery.relayout` (a city editor; M20 §19.12): **Fix the tiles** of an archive series on the map or waiting for approval: a new
 * version of the same layer, reopened at the tile layout with the current one, while the version on the map stays until it is approved.
 */
export const imageryRelayoutRequestSchema = z.strictObject(versionIdField);

/** All three answer with the job that runs (the new version's, for `imagery.relayout`). */
export const imageryLayoutResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema });
