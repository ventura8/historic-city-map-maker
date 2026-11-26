/**
 * The static export of a city (M5; `docs/research/M5-interfaces.md` §5): `export.start` (city owner) records an export
 * and enqueues its build on the `export-build` queue, whose task function (`export.build`) writes the zip; the admin
 * watches `cities/{city}/exports/{exportId}` and, once it is `ready`, asks `export.download` for a signed address that
 * lives `EXPORT_LIMITS.downloadUrlMinutes`. The registry rows join with their implementation (the export workstream).
 */
import { z } from 'zod';

import { EXPORT_FILE_NAME_PATTERN } from '../schemas/city-export.js';
import { cityIdSchema } from '../schemas/paths.js';
import { httpsUrlSchema, idSchema } from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';

/** The Cloud Tasks queue of `export.build`: one build at a time per city (`apiError.export.busy` refuses a second). */
export const EXPORT_QUEUE = 'export-build';

/**
 * `export.start` (city owner): refuses a city never published (`apiError.export.noManifest`), a second export while one
 * is open (`apiError.export.busy`), the city's daily exports used up (`apiError.export.dailyLimit`) and a red budget
 * guard (`apiError.guardPaused`).
 */
export const exportStartRequestSchema = z.strictObject({ cityId: cityIdSchema, rasters: z.boolean() });
export const exportStartResponseSchema = z.strictObject({ exportId: idSchema });

/** `export.download` (city owner): a V4 signed address of the ready zip (`apiError.export.notReady`, `.expired`). */
export const exportDownloadRequestSchema = z.strictObject({ cityId: cityIdSchema, exportId: idSchema });
export const exportDownloadResponseSchema = z.strictObject({
    url: httpsUrlSchema,
    expiresAt: isoTimeSchema,
    fileName: z.string().regex(EXPORT_FILE_NAME_PATTERN),
});

/** The task `export.start` enqueues (its name is the export id, so a redelivery builds nothing twice). */
export const exportTaskSchema = z.strictObject({ cityId: cityIdSchema, exportId: idSchema });

export type ExportStartRequest = z.infer<typeof exportStartRequestSchema>;
export type ExportDownloadResponse = z.infer<typeof exportDownloadResponseSchema>;
export type ExportTask = z.infer<typeof exportTaskSchema>;
