/**
 * M20 (`docs/research/M20-import-local.md` §2.4, §8): the two callables of a local archive. `worker.archiveReport`: the owner's
 * worker reports what its scan found (series, skipped counts and a sample of skipped paths, relative to the archive); a city
 * editor's sign-in or the worker's paired token, App Check off, as the worker's other callables. `imagery.archiveImport`: one
 * click makes one `archive-series` job per included series, in the archive's order; those beyond today's share wait (`daily`).
 */
import { z } from 'zod';

import { WORKER_ID_PATTERN } from '../schemas/firestore-ops.js';
import {
    ARCHIVE_ID_PATTERN,
    ARCHIVE_ISSUES_MAX,
    ARCHIVE_MAX_SERIES,
    ARCHIVE_SKIP_REASONS,
    SERIES_ID_PATTERN,
    archiveIssueSchema,
    archiveSeriesSchema,
    rightsSchema,
} from '../schemas/imagery-archive.js';
import { cityIdSchema } from '../schemas/paths.js';
import { coded, idSchema, plainText } from '../schemas/primitives.js';

const archiveIdSchema = z.string().regex(ARCHIVE_ID_PATTERN);
const seriesIdSchema = z.string().regex(SERIES_ID_PATTERN);

/** `worker.archiveReport`: the scan's report, which replaces the archive's last one until it is imported. */
export const workerArchiveReportRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    workerId: z.string().regex(WORKER_ID_PATTERN),
    archiveId: archiveIdSchema,
    name: plainText(200),
    source: z.enum(['zip', 'folder']),
    fileCount: z.number().int().min(0),
    bytes: z.number().int().min(0),
    series: z.array(archiveSeriesSchema).max(ARCHIVE_MAX_SERIES),
    skipped: z.partialRecord(z.enum(ARCHIVE_SKIP_REASONS), z.number().int().min(1)),
    issues: z.array(archiveIssueSchema).max(ARCHIVE_ISSUES_MAX),
});
export const workerArchiveReportResponseSchema = z.strictObject({ archiveId: archiveIdSchema, series: z.number().int().min(0) });

/** One series as the owner left it in the report: included or not, and the title, year and rights they edited. */
const seriesChoiceSchema = z.strictObject({
    seriesId: seriesIdSchema,
    include: z.boolean(),
    title: plainText(200).optional(),
    year: z.number().int().min(1800).max(2100).optional(),
    rights: rightsSchema.optional(),
});

/** `imagery.archiveImport`: the archive's series to import (the others are left out), each at most once. */
export const imageryArchiveImportRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    archiveId: archiveIdSchema,
    series: z
        .array(seriesChoiceSchema)
        .min(1)
        .max(ARCHIVE_MAX_SERIES)
        .refine((choices) => new Set(choices.map((choice) => choice.seriesId)).size === choices.length, coded('validation.duplicateId')),
});
export const imageryArchiveImportResponseSchema = z.strictObject({
    jobs: z
        .array(z.strictObject({ seriesId: seriesIdSchema, jobId: idSchema, layerId: idSchema, waiting: z.boolean() }))
        .max(ARCHIVE_MAX_SERIES),
    /** How many start today, and how many wait for the next days' shares ("11 series start today, 22 wait"). */
    today: z.number().int().min(0),
    waiting: z.number().int().min(0),
});

export type WorkerArchiveReportRequest = z.infer<typeof workerArchiveReportRequestSchema>;
export type ImageryArchiveImportRequest = z.infer<typeof imageryArchiveImportRequestSchema>;
