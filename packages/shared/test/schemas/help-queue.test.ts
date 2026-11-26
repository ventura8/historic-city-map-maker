/**
 * The Help calibrate queue (`docs/research/M22-help-calibrate.md` §1.1, M20 §19): versions waiting for a person, a series whose
 * tile layout needs the owner first (the tile-import wizard), then every version waiting for points (the georeferencer).
 */
import { describe, expect, it } from 'vitest';

import { helpItemsOf } from '../../src/schemas/imagery-tiles.js';

describe('helpItemsOf', () => {
    it('happyPath_aLayoutCheckComesFirstAndOpensTheTileWizard', () => {
        const items = helpItemsOf([
            { id: 'v-points', state: 'needs_gcps' },
            { id: 'v-low', state: 'needs_gcps', help: { reason: 'low-confidence' } },
            { id: 'v-tiles', state: 'needs_gcps', help: { reason: 'layout-check' } },
        ]);

        expect(items).toEqual([
            { versionId: 'v-tiles', code: 'layoutCheck', page: 'tiles' },
            { versionId: 'v-points', code: 'needsPoints', page: 'georef' },
            { versionId: 'v-low', code: 'needsPoints', page: 'georef' },
        ]);
    });

    it('badPath_versionsThatDoNotWaitAreNotInTheQueue', () => {
        expect(helpItemsOf([{ id: 'v-done', state: 'published', help: { reason: 'layout-check' } }])).toEqual([]);
    });
});
