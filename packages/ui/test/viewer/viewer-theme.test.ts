import { afterEach, describe, expect, it } from 'vitest';

import { ACCENT_PROPERTY } from '../../src/theme/device-accent.js';
import { withViewerBaseline } from '../../src/viewer/viewer-baseline.js';
import { themeChanged, viewerTokens } from '../../src/viewer/viewer-theme.js';
import { idleState, readyState } from './fake-store.js';

const PRIMARY = '--md-sys-color-primary';

describe('viewer theme', () => {
    afterEach(() => {
        document.documentElement.style.removeProperty(ACCENT_PROPERTY);
    });

    it('happyPath_theCitysColoursTakeTheDevicesAccentByDefault', () => {
        const state = readyState();
        const own = withViewerBaseline(state.manifest?.city.theme.tokens);
        document.documentElement.style.setProperty(ACCENT_PROPERTY, '#1e8e3e');

        expect(viewerTokens(state, document).light[PRIMARY]).not.toBe(own.light[PRIMARY]);
        expect(viewerTokens(readyState(undefined, { accent: 'map' }), document)).toEqual(own);
        expect(viewerTokens(null, document).light[PRIMARY]).not.toBe(withViewerBaseline(undefined).light[PRIMARY]);
    });

    it('badPath_withoutAnAccentTheCitysOwnColoursShow', () => {
        const state = readyState();

        expect(viewerTokens(state, document)).toEqual(withViewerBaseline(state.manifest?.city.theme.tokens));
    });

    it('happyPath_theThemeIsAppliedAgainWhenTheModeOrColoursChange', () => {
        const state = idleState();

        expect(themeChanged(state, { ...state, theme: 'dark' })).toBe(true);
        expect(themeChanged(state, { ...state, accent: 'map' })).toBe(true);
    });

    it('badPath_anotherChangeLeavesTheThemeAlone', () => {
        const state = idleState();

        expect(themeChanged(state, { ...state, sheet: 'layers' })).toBe(false);
    });
});
