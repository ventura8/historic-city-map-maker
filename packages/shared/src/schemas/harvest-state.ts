/**
 * `ops/harvest-{city}`: a city's USGS harvest attempts (CR-M3-47; lesson 676), out of `firestore-ops.ts` to keep it within its
 * lines. Written by the functions only; the city's admins read it (the Imagery area's Search shows each dataset's part live).
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import { stamp, timestampSchema } from './firestore-common.js';
import { USGS_DATASETS } from './firestore.js';

/**
 * How a city's last USGS harvest went: found scenes, found none, USGS did not answer (every dataset failed), `partial` (a dataset
 * was searched only in part: what it found is stored, the rest resumes) or `running` (it has not finished; one still `running` long
 * after the callable's timeout was stopped by the server, lesson 676).
 */
export const HARVEST_OUTCOMES = ['ok', 'empty', 'failed', 'partial', 'running'] as const;
/**
 * How far one dataset's part of a harvest got: waiting its turn (two datasets are searched at a time; lesson 729), still
 * searching, searched to its end, in part, or not at all.
 */
export const HARVEST_DATASET_STATES = ['queued', 'searching', 'done', 'partial', 'failed'] as const;
/** Why a dataset's search stopped before its end: the run's time was up, one USGS request took too long, or USGS refused it. */
export const HARVEST_STOP_REASONS = ['outOfTime', 'requestTimedOut', 'usgsFailed'] as const;

/** One dataset's part of a harvest (`ops/harvest-{city}.datasets`, and `imagery.search`'s answer). */
export const harvestDatasetSchema = z.strictObject({
    state: z.enum(HARVEST_DATASET_STATES),
    /** Scenes this run found and stored of the dataset. */
    found: z.number().int().min(0).max(100_000),
    /** The M2M `startingNumber` the next run resumes from, for a dataset not searched to its end. */
    next: z.number().int().min(1).max(1_000_000).optional(),
    reason: z.enum(HARVEST_STOP_REASONS).optional(),
    error: apiErrorCodeSchema.optional(),
});

/**
 * `ops/harvest-{city}`: the city's last harvest attempt (CR-M3-47), written on every attempt, so the monthly harvest of
 * `imagery.tick` is keyed on what the harvest itself wrote: the next one is due at `nextAt` (a month after a harvest that
 * answered, an hour after a failure, doubled after each further one), never every five minutes. Lesson 676: written `running` at
 * the start and again as each dataset is stored (`datasets`, which the admin's Search shows live), so a run the server stops still
 * leaves what it stored and where each dataset resumes; a `partial` run resumes `HARVEST_RESUME_MINUTES` later.
 */
export const harvestStateDocSchema = z.strictObject({
    attemptedAt: timestampSchema,
    outcome: z.enum(HARVEST_OUTCOMES),
    /** Failed or unfinished runs in a row (0 after a harvest that answered in full). */
    failures: z.number().int().min(0).max(1000),
    nextAt: timestampSchema,
    error: apiErrorCodeSchema.optional(),
    datasets: z.partialRecord(z.enum(USGS_DATASETS), harvestDatasetSchema).optional(),
    finishedAt: timestampSchema.optional(),
    ...stamp,
});

export type HarvestStateDoc = z.infer<typeof harvestStateDocSchema>;
export type HarvestDataset = z.infer<typeof harvestDatasetSchema>;
export type HarvestDatasets = NonNullable<HarvestStateDoc['datasets']>;
