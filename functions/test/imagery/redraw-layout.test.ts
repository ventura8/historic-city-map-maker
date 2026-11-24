import { FIRESTORE_PATHS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { redrawLayout, retryParams } from '../../src/imagery/redraw-layout.js';
import { ARCHIVE, seriesIdOf } from './archive-world.js';
import { CITY, NOW, at, needsGcpsVersion, readyWorld, renderedVersion, seedJob, seedVersion, type ImageryWorld } from './world.js';

const source = { kind: 'archive', archiveId: ARCHIVE, seriesId: seriesIdOf(1), sheetCount: 60, placedCount: 57 } as const;
const stitched = {
    previewPath: 'rasters/bucharest/l-1895/ar-first/stitched.jpg',
    previewScale: 0.24,
    width: 16963,
    height: 14298,
    method: 'overview' as const,
    parts: 60,
    joined: 57,
    leftOut: [],
    leftOutCount: 3,
};

function jobOf(type: JobDoc['type'], params: Record<string, unknown>): JobDoc {
    return {
        type,
        status: 'failed',
        params,
        createdBy: 'uid-owner',
        createdAt: at(NOW),
        layerId: 'l-1895',
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    };
}

async function world(): Promise<ImageryWorld> {
    const made = await readyWorld();
    const help = { reason: 'no-scale' as const, note: 'placed by points', at: at(NOW), stitched };
    await seedVersion(made, 'ar-first', renderedVersion({ jobId: 'ar-first', layerId: 'l-1895', origin: 'archive', source, help }));
    await seedJob(
        made,
        'ar-first',
        jobOf('archive-series', { archiveId: ARCHIVE, seriesId: seriesIdOf(1), encoding: 'colour', gridId: 'g-1', maxzoom: 17 }),
    );
    await seedVersion(
        made,
        'rg-between',
        renderedVersion({ jobId: 'rg-between', layerId: 'l-1895', origin: 'regeoref', source, basedOn: 'ar-first' }),
    );
    return made;
}

const REDRAW = {
    basedOn: 'rg-between',
    originalArchiveId: ARCHIVE,
    originalSeriesId: seriesIdOf(1),
    recordFrom: ['rg-between', 'ar-first'],
};

describe('a redraw retried before it carried its layout (rg-mwukj3fm)', () => {
    it('happyPath_theRetryAddsTheSeriesLayout @S-P20-HAPPY-REDRAW-REBUILD', async () => {
        const made = await world();
        const params = await retryParams(made.deps.documents, CITY, jobOf('regeoref', { ...REDRAW, fullResolution: true }));
        expect(params?.['layout']).toMatchObject({ method: 'overview', encoding: 'colour', gridId: 'g-1' });
        expect(typeof (params?.['layout'] as { maxzoom?: unknown } | undefined)?.maxzoom).toBe('number');
    });

    it('badPath_aPointEditOneWithItsLayoutOrAChainWithNoArchiveVersionIsLeftAsItIs @S-P20-BAD-REDRAW-REBUILD', async () => {
        const made = await world();
        const documents = made.deps.documents;
        expect(await retryParams(documents, CITY, jobOf('regeoref', REDRAW))).toBeUndefined();
        const laid = { ...REDRAW, fullResolution: true, layout: { method: 'pieces', encoding: 'grey', maxzoom: 16 } };
        expect(await retryParams(documents, CITY, jobOf('regeoref', laid))).toBeUndefined();
        const lost = { ...REDRAW, fullResolution: true, recordFrom: ['rg-between', 'gone'] };
        expect(await retryParams(documents, CITY, jobOf('regeoref', lost))).toBeUndefined();
        expect(await retryParams(documents, CITY, jobOf('layer-join', { fullResolution: true }))).toBeUndefined();
    });
});

async function seriesWorld(params: Record<string, unknown>, stitch = true): Promise<ImageryWorld> {
    const made = await readyWorld();
    const help = { reason: 'no-scale' as const, note: 'placed by points', at: at(NOW), ...(stitch ? { stitched } : {}) };
    await seedVersion(made, 'ar-first', needsGcpsVersion({ jobId: 'ar-first', layerId: 'l-1895', origin: 'archive', source, help }));
    await seedJob(made, 'ar-first', jobOf('archive-series', params));
    return made;
}

describe('the layout read back from a series never published', () => {
    it('happyPath_theJobsZoomIsUsedAndAnUnknownEncodingOrGridIsLeftOut @S-P20-HAPPY-REDRAW-REBUILD', async () => {
        const made = await seriesWorld({ encoding: 'sepia', gridId: 7, maxzoom: 15 });
        expect(await redrawLayout(made.deps.documents, CITY, ['ar-first'])).toEqual({ method: 'overview', encoding: 'grey', maxzoom: 15 });
    });

    it('badPath_noZoomNoJobNoStitchOrNoListGivesNoLayout @S-P20-BAD-REDRAW-REBUILD', async () => {
        const noZoom = await seriesWorld({ encoding: 'colour', maxzoom: 'high' });
        expect(await redrawLayout(noZoom.deps.documents, CITY, ['ar-first'])).toBeUndefined();
        const noJob = await seriesWorld({ maxzoom: 15 });
        await noJob.deps.documents.delete(FIRESTORE_PATHS.job(CITY, 'ar-first'));
        expect(await redrawLayout(noJob.deps.documents, CITY, ['ar-first'])).toBeUndefined();
        const noStitch = await seriesWorld({ maxzoom: 15 }, false);
        expect(await redrawLayout(noStitch.deps.documents, CITY, ['ar-first'])).toBeUndefined();
        const notAList = { ...REDRAW, fullResolution: true, recordFrom: 'ar-first' };
        expect(await retryParams(noStitch.deps.documents, CITY, jobOf('regeoref', notAList))).toBeUndefined();
    });
});
