/**
 * A job's scratch files in the private bucket (`RASTER_PATHS.work`, `docs/research/M3-interfaces.md` §4.6): the unpacked
 * segments and the stitched frame of a failed import hold about 13 GB. A version that is dismissed or rejected can never run
 * again (`imagery.retry` refuses it), so they go at once; the bucket's 14-day lifecycle stays as the backstop, so a deletion
 * that fails only costs storage. Only this job's folder of this city: a USGS delivery (`usgs-raw/`) may be another city's.
 * Only the bucket's: a job run on a local worker keeps its `work/` in that computer's work folder (`routed.py`), out of the
 * server's reach, where the worker's sweep removes it after 14 days (`docs/research/M7-local-worker.md`).
 */
import { RASTER_PATHS } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

export type WorkFilesDeps = Pick<Ports, 'blobs' | 'log'>;

/** `work/{city}/{job}/`, its segments checked by the one place that spells the path. */
function workPrefix(cityId: string, jobId: string): string {
    return RASTER_PATHS.work(cityId, jobId, '-').slice(0, -1);
}

/** Deletes the job's scratch files; a failure is logged and left to the lifecycle. */
export async function deleteWorkFiles(deps: WorkFilesDeps, cityId: string, jobId: string): Promise<void> {
    try {
        const paths = await deps.blobs.list('private', workPrefix(cityId, jobId));
        await Promise.all(paths.map((path) => deps.blobs.delete('private', path)));
        deps.log.info('scratch files of an ended version deleted', { cityId, jobId, files: paths.length });
    } catch (error) {
        deps.log.warn('scratch files left to the lifecycle', { cityId, jobId, error: String(error) });
    }
}
