import { decodeHash } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { initialState, withManifest } from '../../src/core/state.js';
import { applyDecodedHash, encodeViewerHash, hashLimits } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';

/** Place categories in `layers=` (2026-11-22: `layers=…,railways` read as a missing layer). */
describe('place categories in links', () => {
    const city = manifest();
    const loaded = withManifest(initialState('ro', 'system', 'unknown'), city);
    const visible = (state: typeof loaded): string[] =>
        state.overlays.filter((overlay) => overlay.kind === 'poi' && overlay.visible).map((overlay) => overlay.id);

    it('happyPath_aNamedCategoryIsKnownShowsAloneAndRoundTrips', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=strazi,kh4-1966', hashLimits(city)));
        expect(applied.unknownLayer).toBeUndefined();
        expect(visible(applied.state)).toEqual(['strazi']);
        expect(applied.state.year).toBe(1966);

        const again = applyDecodedHash(loaded, decodeHash(encodeViewerHash(applied.state, 'ro'), hashLimits(city)));
        expect(visible(again.state)).toEqual(['strazi']);
        expect(again.state.year).toBe(1966);
    });

    it('badPath_aLinkNamingNoCategoryKeepsTheirDefaultsAndAnUnknownIdStillSaysSo', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=kh4-1966,railways', hashLimits(city)));
        expect(visible(applied.state)).toEqual(visible(loaded));
        expect(applied.unknownLayer).toBe('railways');
    });
});

/** A layer that is on is never invisible (the owner, 2026-11-22: `op=<layer>:0` opened a blank map). */
describe('a layer on at opacity 0', () => {
    const city = manifest();
    const loaded = withManifest(initialState('ro', 'system', 'unknown'), city);

    it('happyPath_aLinkTurningALayerOnAt0OpensItAtItsDefaultOpacity @S-V23-HAPPY-ON-NEVER-INVISIBLE', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=kh4-1966&op=kh4-1966:0', hashLimits(city)));
        const layer = applied.state.overlays.find((overlay) => overlay.id === 'kh4-1966');
        expect(layer?.visible).toBe(true);
        expect(layer?.opacity).toBe(layer?.defaultOpacity);
    });

    it('badPath_opacity0IsNeverWrittenIntoTheLink @S-V23-BAD-ZERO-NOT-WRITTEN', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=kh4-1966', hashLimits(city)));
        const overlays = applied.state.overlays.map((overlay) => (overlay.id === 'kh4-1966' ? { ...overlay, opacity: 0 } : overlay));
        expect(encodeViewerHash({ ...applied.state, overlays }, 'ro')).not.toContain('kh4-1966:0');
    });
});
