/**
 * `layerVersionReadSchema` and `salvageLayerVersion` (`packages/shared/src/schemas/legacy-reads.ts`): a version a later schema refuses
 * is read without the refused fields, so its owner can still end it; one whose required fields fail is refused.
 */
import { describe, expect, it } from 'vitest';

import { MAX_SCAN_PIXELS, layerVersionDocSchema, layerVersionReadSchema, salvageLayerVersion, validate } from '../../src/index.js';

const STAMP = { seconds: 1_792_100_000, nanoseconds: 0 };
const SCAN = {
    path: 'rasters/bucharest/l/v/scan.tif',
    width: 8192,
    height: 6144,
    sha256: 'a'.repeat(64),
    previewPath: 'rasters/bucharest/l/v/scan-preview.jpg',
    previewScale: 0.5,
};
const VERSION = {
    layerId: 'kh-9-hexagon-2-februarie-1972',
    jobId: 'im-mvya873z-D3C1202-200149F039',
    origin: 'usgs',
    state: 'needs_gcps',
    label: { ro: 'KH-9 Hexagon, 2 februarie 1972' },
    year: 1972,
    scan: SCAN,
    createdBy: 'uid-owner',
    createdAt: STAMP,
    updatedBy: 'system:pipeline',
    updatedAt: STAMP,
};

describe('a layer version read for its ending', () => {
    it('happyPath_aValidVersionReadsAsItIs', () => {
        expect(validate(layerVersionDocSchema, VERSION).ok).toBe(true);
        expect(salvageLayerVersion(VERSION)).toEqual({ version: VERSION, dropped: [] });
    });

    it('happyPath_aScanWiderThanTodaysLimitIsLeftOut @S-A12-HAPPY-LEGACY-VERSION-ENDS', () => {
        const legacy = { ...VERSION, scan: { ...SCAN, width: MAX_SCAN_PIXELS + 1 }, stale: true };

        expect(validate(layerVersionDocSchema, legacy).ok).toBe(false);
        const rest = Object.fromEntries(Object.entries(VERSION).filter(([key]) => key !== 'scan'));
        expect(salvageLayerVersion(legacy)).toEqual({ version: rest, dropped: ['scan', 'stale'] });
        expect(validate(layerVersionReadSchema, legacy)).toEqual({ ok: true, value: rest });
    });

    it.each([
        ['a required field that fails', { ...VERSION, layerId: 'Not An Id!' }],
        ['no object at all', 'version'],
    ])('badPath_isRefused_%s @S-A12-BAD-LEGACY-VERSION-UNREADABLE', (_case, raw) => {
        expect(salvageLayerVersion(raw)).toBeUndefined();
        expect(validate(layerVersionReadSchema, raw)).toEqual({ ok: false, issues: [{ path: '', code: 'validation.invalid' }] });
    });
});
