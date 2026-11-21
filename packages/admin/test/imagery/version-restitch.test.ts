/** M20 (DECISIONS-for-review.md §216): the version view says when Locate again lays a published series on its overview again. */
import type { LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { versionViewOf } from '../../src/imagery/version-view.js';
import { versionDoc } from './world.js';

const AT = { seconds: 1, nanoseconds: 0 };

function stitched(method: string, leftOutCount: number) {
    return {
        previewPath: 'p.jpg',
        previewScale: 0.2,
        width: 10,
        height: 10,
        method,
        parts: 3,
        joined: 3 - leftOutCount,
        leftOut: [],
        leftOutCount,
    };
}

function viewOf(overrides: Record<string, unknown>) {
    const georef = { ...(versionDoc()['georef'] as Record<string, unknown>), method: 'gcps' };
    const help = { reason: 'no-scale', note: 'n', at: AT, stitched: stitched('overview', 3) };
    const data = { ...versionDoc(), origin: 'archive', state: 'published', georef, help, ...overrides } as unknown as LayerVersionDoc;
    return versionViewOf({ id: 'v', path: 'v', data, version: '', pending: false });
}

describe('the version view: a series to stitch again', () => {
    it('happyPath_aPublishedSeriesWithPiecesLeftOutIsRestitchable @S-A122-HAPPY-RESTITCH', () => {
        expect(viewOf({}).restitchable).toBe(true);
    });

    it.each([
        ['nothing left out', { help: { reason: 'no-scale', note: 'n', at: AT, stitched: stitched('overview', 0) } }],
        ['another mosaic', { help: { reason: 'no-scale', note: 'n', at: AT, stitched: stitched('pieces', 3) } }],
        ['no help', { help: undefined }],
        ['waiting for approval', { state: 'awaiting_approval' }],
    ])('badPath_notRestitchable_%s @S-A122-BAD-RESTITCH-NOTHING-LEFT', (_name, overrides) => {
        expect(viewOf(overrides).restitchable).toBe(false);
    });
});
