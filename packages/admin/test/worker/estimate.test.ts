import type { JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { estimateCloudRun } from '../../src/worker/estimate.js';

const AT = { seconds: 1_760_000_000, nanoseconds: 0 };

function job(more: Partial<JobDoc> = {}): JobDoc {
    return { type: 'usgs-import', status: 'queued', params: {}, createdBy: 'uid', createdAt: AT, updatedBy: 'uid', updatedAt: AT, ...more };
}

describe('the estimate of a cloud run', () => {
    it('happyPath_aNewImportDownloadsOnFetchThenProcessesOnStd', () => {
        expect(estimateCloudRun(job())).toEqual({ vcpuSeconds: 1800 + 2 * 2700, gibSeconds: 4 * 1800 + 8 * 2700 });
    });

    it('happyPath_aKh9PanoramicFrameProcessesOnXlAndADoneDownloadIsNotCountedAgain', () => {
        const steps = { fetch: { status: 'done' }, extract: { status: 'skipped' } } as JobDoc['steps'];
        expect(estimateCloudRun(job({ params: { sensor: 'KH-9-pan' }, steps }))).toEqual({ vcpuSeconds: 4 * 3600, gibSeconds: 16 * 3600 });
    });

    it('badPath_anEscalatedDownloadRunsOnItsLargerMachineAndAnUnknownCameraOnStd', () => {
        expect(estimateCloudRun(job({ machine: 'std', params: { sensor: 'no-such' } }))).toEqual({
            vcpuSeconds: 2 * 2 * 2700,
            gibSeconds: 2 * 8 * 2700,
        });
        expect(estimateCloudRun(job({ machine: 'xl' }))).toEqual({ vcpuSeconds: 2 * 4 * 3600, gibSeconds: 2 * 16 * 3600 });
    });

    it('happyPath_aRegeoreferenceHasNoDownloadPhase', () => {
        expect(estimateCloudRun(job({ type: 'regeoref', machine: 'fetch' }))).toEqual({ vcpuSeconds: 2 * 2700, gibSeconds: 8 * 2700 });
    });
});
