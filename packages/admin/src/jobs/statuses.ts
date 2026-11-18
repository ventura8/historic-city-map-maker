/**
 * Statuses of a job that has not finished (Cancel is offered, the progress moves). A leaf module: Home and the Imagery
 * feeds only need this list, and importing it from `./jobs.ts` put the whole jobs store in `editor-shared`.
 */
import type { JobStatus } from '@hcm/shared';

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
    'awaiting_gcps',
];
