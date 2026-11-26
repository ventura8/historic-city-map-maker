import { describe, expect, it } from 'vitest';

import { BASELINE_THEME } from '../../src/theme/baseline.js';
import { DEFAULT_SEED_COLOR, themeFromSeed } from '../../src/theme/dynamic-color.js';

describe('BASELINE_THEME', () => {
    it('happyPath_isThePrecomputedThemeOfTheDefaultSeed', () => {
        expect(BASELINE_THEME).toEqual(themeFromSeed(DEFAULT_SEED_COLOR));
    });

    it('badPath_anInvalidSeedThemeIsTheBaseline', () => {
        expect(themeFromSeed('not-a-colour')).toEqual(BASELINE_THEME);
    });
});
