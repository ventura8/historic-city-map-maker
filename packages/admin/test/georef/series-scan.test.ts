/**
 * M20 §19.13: the georeferencer of an archive series with no scan of its own shows its joined sheets (`help.stitched`) to check, with no
 * points saved on them; a series with a scan is as any version.
 */
import { layerVersionDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { georefVersionOf } from '../../src/georef/state.js';
import { at } from '../content/world.js';
import { versionDoc } from '../imagery/world.js';

const STITCHED = {
    previewPath: 'rasters/x/stitched.jpg',
    previewScale: 0.25,
    width: 16000,
    height: 12000,
    method: 'grid' as const,
    parts: 120,
    joined: 96,
    leftOut: [],
    leftOutCount: 0,
};

function series(overrides: Record<string, unknown>) {
    const doc = layerVersionDocSchema.parse(versionDoc({ origin: 'archive', state: 'needs_gcps', scan: undefined, ...overrides }));
    return georefVersionOf('v', doc);
}

describe('georefVersionOf: an archive series', () => {
    it('happyPath_aSeriesWithNoScanShowsItsJoinedSheetsToCheck @S-A-HAPPY-FIX-TILES', () => {
        const version = series({ help: { reason: 'no-scale', note: 'n', at: at('2026-11-21T08:00:00.000Z'), stitched: STITCHED } });

        expect(version.scan).toEqual({
            width: 16000,
            height: 12000,
            previewScale: 0.25,
            previewPath: 'rasters/x/stitched.jpg',
            detail: null,
        });
        expect(version.editable).toBe(false);
        expect(version.series).toEqual({ stitchedOnly: true });
    });

    // LESSONS 759: a relayout writes a new revision over the same preview path; the revision tells the picture is new.
    it('happyPath_aLaidOutSeriesPictureCarriesItsLayoutRevision', () => {
        const quality = { placedPct: 100, seamMedian: 0.8, seamRmsPx: 1, verdict: 'good' as const };
        const layout = { rows: 2, cols: 2, revision: 4, quality, weakSeams: [] };
        const help = { reason: 'layout-check', note: 'n', at: at('2026-11-21T08:00:00.000Z'), stitched: { ...STITCHED, layout } };

        expect(series({ help }).scan).toMatchObject({ previewPath: 'rasters/x/stitched.jpg', revision: 4 });
    });

    it('badPath_aSeriesWithNeitherHasNoPictureAndSaysItIsASeries @S-A-BAD-FIX-TILES-STATE', () => {
        const version = series({ help: { reason: 'no-scale', note: 'n', at: at('2026-11-21T08:00:00.000Z') } });

        expect(version.scan).toBeNull();
        expect(version.series).toEqual({ stitchedOnly: false });
    });

    it('happyPath_aUsgsFrameIsNoSeries', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());

        expect(georefVersionOf('v', doc).series).toBeUndefined();
    });
});
