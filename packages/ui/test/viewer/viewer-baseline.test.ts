/**
 * The viewer's cut of the baseline theme (`viewer-baseline.ts`): the same values as `BASELINE_THEME` for the tokens it
 * keeps, and a city theme laid over it scheme by scheme, so a partial city theme leaves no token the viewer names unset.
 */
import { describe, expect, it } from 'vitest';

import { BASELINE_THEME } from '../../src/theme/baseline.js';
import { VIEWER_BASELINE, withViewerBaseline } from '../../src/viewer/viewer-baseline.js';

const SCHEMES = ['light', 'dark', 'highContrastLight', 'highContrastDark'] as const;

describe('the viewer baseline', () => {
    it('happyPath_itIsTheBaselineThemeCutToTheViewersTokens', () => {
        for (const scheme of SCHEMES) {
            const kept = Object.keys(VIEWER_BASELINE[scheme]);
            const baseline: Readonly<Record<string, string>> = BASELINE_THEME[scheme];

            expect(kept).toHaveLength(27);
            expect(VIEWER_BASELINE[scheme]).toEqual(Object.fromEntries(kept.map((name) => [name, baseline[name]])));
        }
        expect(withViewerBaseline(undefined)).toEqual(VIEWER_BASELINE);
    });

    it('badPath_aPartialCityThemeKeepsItsOwnTokensAndTakesTheRestFromTheBaseline', () => {
        const city = { '--md-sys-color-primary': '#875329' };

        const tokens = withViewerBaseline({ light: city, dark: city, highContrastLight: city, highContrastDark: {} });

        expect(tokens.light['--md-sys-color-primary']).toBe('#875329');
        expect(tokens.light['--md-sys-color-secondary']).toBe(VIEWER_BASELINE.light['--md-sys-color-secondary']);
        expect(tokens.highContrastDark).toEqual(VIEWER_BASELINE.highContrastDark);
        expect(Object.keys(tokens.dark)).toHaveLength(27);
    });
});
