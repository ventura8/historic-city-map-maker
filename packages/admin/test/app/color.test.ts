import { describe, expect, it, vi } from 'vitest';

import { colorLibrary, contrastIssuesOf, loadColor, themeFromSeed } from '../../src/app/color.js';

describe('the colour library', () => {
    it('badPath_beforeItLoadsAThemeIsAProgrammingError', async () => {
        // A fresh copy of the module: another test file in the same worker may have loaded the library already (the
        // targeted run of 2026-11-13 failed here only in company).
        vi.resetModules();
        const fresh = await import('../../src/app/color.js');

        expect(() => fresh.themeFromSeed('#6750a4')).toThrow('not loaded yet');
    });

    it('happyPath_onceLoadedItMakesThemes', async () => {
        const theme = { light: { primary: '#6750a4' }, dark: {}, highContrastLight: {}, highContrastDark: {} };
        await loadColor(() => Promise.resolve({ themeFromSeed: () => theme, contrastIssues: () => [] }));

        expect(themeFromSeed('#6750a4')).toBe(theme);
        expect(colorLibrary().contrastIssues({}, 4.5)).toEqual([]);
        expect(contrastIssuesOf({}, 4.5)).toEqual([]);
    });
});
