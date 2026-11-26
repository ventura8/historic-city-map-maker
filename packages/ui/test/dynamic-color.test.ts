import { describe, expect, it } from 'vitest';

import {
    CONTRAST_PAIRS,
    DEFAULT_SEED_COLOR,
    THEME_VARIANTS,
    contrastIssues,
    contrastRatio,
    isHexColor,
    relativeLuminance,
    themeFromSeed,
    tokenName,
} from '../src/theme/dynamic-color.js';

/** Seeds of the WCAG check: the Bucharest sepia, the M3 baseline and deliberately hard ones. */
const SEEDS = ['#8B5E3C', DEFAULT_SEED_COLOR, '#FFFF00', '#000000', '#FFFFFF', '#00FF00', '#0000FF', '#808080'];

describe('themeFromSeed', () => {
    it('happyPath_fourSchemesWithTheSameRoles', () => {
        const theme = themeFromSeed('#8B5E3C');
        const roles = Object.keys(theme.light);

        expect(roles).toHaveLength(53);
        expect(roles).toContain('--md-sys-color-primary');
        expect(roles).toContain('--md-sys-color-surface-container-highest');
        expect(roles).toContain('--md-sys-color-scrim');
        for (const scheme of [theme.dark, theme.highContrastLight, theme.highContrastDark]) {
            expect(Object.keys(scheme)).toEqual(roles);
        }
        expect(Object.values(theme.light).every((value) => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    });

    it('happyPath_bucharestSepiaIsWarm', () => {
        const { light, dark } = themeFromSeed('#8B5E3C');

        expect(light['--md-sys-color-primary']).toBe('#875329');
        expect(dark['--md-sys-color-surface']).toBe('#130d09');
    });

    it('happyPath_isDeterministic', () => {
        expect(themeFromSeed('#8b5e3c')).toEqual(themeFromSeed('#8B5E3C'));
    });

    it.each(['expressive', 'vibrant'] as const)('happyPath_variant_%s_differsFromTonalSpotWithTheSameRoles', (variant) => {
        const tonal = themeFromSeed('#8B5E3C');
        const theme = themeFromSeed('#8B5E3C', variant);

        expect(Object.keys(theme.dark)).toEqual(Object.keys(tonal.dark));
        expect(theme.light['--md-sys-color-primary']).not.toBe(tonal.light['--md-sys-color-primary']);
        expect(THEME_VARIANTS).toContain(variant);
    });

    it.each([['brown'], ['#8B5E3'], [''], ['8B5E3C']])('badPath_invalidSeed_%s_usesTheDefaultPalette', (seed) => {
        expect(themeFromSeed(seed)).toEqual(themeFromSeed(DEFAULT_SEED_COLOR));
    });
});

describe('contrast', () => {
    it.each(SEEDS.flatMap((seed) => THEME_VARIANTS.map((variant) => [seed, variant] as const)))(
        'happyPath_seed_%s_%s_meetsWcagAaInStandardAndAaaInHighContrast',
        (seed, variant) => {
            const theme = themeFromSeed(seed, variant);

            expect(contrastIssues(theme.light, 4.5)).toEqual([]);
            expect(contrastIssues(theme.dark, 4.5)).toEqual([]);
            expect(contrastIssues(theme.highContrastLight, 7)).toEqual([]);
            expect(contrastIssues(theme.highContrastDark, 7)).toEqual([]);
        },
    );

    it('happyPath_wcagRatios', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6);
        expect(contrastRatio('#777777', '#777777')).toBe(1);
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
        expect(relativeLuminance('#020202')).toBeCloseTo(0.000_607, 6);
    });

    it('badPath_reportsLowContrastAndMissingRoles', () => {
        const tokens = { [tokenName('on_primary')]: '#777777', [tokenName('primary')]: '#787878' };

        const issues = contrastIssues(tokens, 4.5);

        expect(issues).toHaveLength(CONTRAST_PAIRS.length);
        expect(issues[0]).toMatchObject({ foreground: 'on-primary', background: 'primary' });
    });

    it('happyPath_hexValidation', () => {
        expect([isHexColor('#a1B2c3'), isHexColor('#abc'), isHexColor('a1b2c3')]).toEqual([true, false, false]);
    });
});
