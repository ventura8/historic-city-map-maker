/** M20 (DECISIONS-for-review.md §216): the shared rule of a series Locate again lays on its overview again. */
import { describe, expect, it } from 'vitest';

import { helpFlagsOf, relayoutable, restitchable } from '../src/index.js';

const LEFT_OUT = { help: { stitched: { method: 'overview' as const, leftOutCount: 3 } } };

describe('restitchable', () => {
    it('happyPath_aPublishedArchiveSeriesWithPiecesLeftOutOfItsOverviewMosaic @S-A122-HAPPY-RESTITCH', () => {
        expect(restitchable({ origin: 'archive', state: 'published', ...LEFT_OUT })).toBe(true);
    });

    it.each([
        [
            'nothing left out',
            { origin: 'archive', state: 'published', help: { stitched: { method: 'overview' as const, leftOutCount: 0 } } },
        ],
        ['another mosaic', { origin: 'archive', state: 'published', help: { stitched: { method: 'pieces' as const, leftOutCount: 3 } } }],
        ['no help', { origin: 'archive', state: 'published' }],
        ['a USGS frame', { origin: 'usgs', state: 'published', ...LEFT_OUT }],
        ['not published', { origin: 'archive', state: 'awaiting_approval', ...LEFT_OUT }],
    ])('badPath_not_%s @S-A122-BAD-RESTITCH-NOTHING-LEFT', (_name, version) => {
        expect(restitchable(version)).toBe(false);
    });

    it('helpFlagsOf_saysTheLayoutCheckAndTheStitchAgain', () => {
        expect(helpFlagsOf({ state: 'needs_gcps', help: { reason: 'layout-check' } })).toEqual({
            layoutCheck: true,
            restitchable: false,
            relayoutable: false,
        });
        expect(helpFlagsOf({ state: 'needs_gcps', help: { reason: 'no-scale' } })).toEqual({
            layoutCheck: false,
            restitchable: false,
            relayoutable: false,
        });
        expect(helpFlagsOf({ origin: 'archive', state: 'published', ...LEFT_OUT })).toEqual({
            layoutCheck: false,
            restitchable: true,
            relayoutable: true,
        });
    });
});

describe('relayoutable (Fix the tiles, M20 §19.13)', () => {
    it('happyPath_anArchiveSeriesOnTheMapOrWaitingForApproval @S-A-HAPPY-FIX-TILES', () => {
        expect(relayoutable({ origin: 'archive', state: 'published' })).toBe(true);
        expect(relayoutable({ origin: 'archive', state: 'awaiting_approval' })).toBe(true);
    });

    it('happyPath_aSeriesParkedForPoints @S-A-HAPPY-FIX-TILES-PARKED', () => {
        expect(relayoutable({ origin: 'archive', state: 'needs_gcps', help: { reason: 'no-scale' } })).toBe(true);
        expect(relayoutable({ origin: 'archive', state: 'needs_gcps' })).toBe(true);
    });

    it('badPath_notASeriesOrNotPlacedYet @S-A-BAD-FIX-TILES-STATE', () => {
        expect(relayoutable({ origin: 'usgs', state: 'published' })).toBe(false);
        expect(relayoutable({ origin: 'archive', state: 'processing' })).toBe(false);
        expect(relayoutable({ origin: 'archive', state: 'needs_gcps', help: { reason: 'layout-check' } })).toBe(false);
    });
});
