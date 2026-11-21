/**
 * The city's theme and basemap (`docs/research/M2c-interfaces.md` §8.5, section `theme`; behaviour A19): a seed colour
 * (typed as hex, picked, or one of eight presets) from which `services.theme` makes the four M3 schemes, previewed live
 * on the whole admin, and the viewer's basemap (Mapbox Standard, or Standard Satellite for the visitors: the admin's own
 * map always stays Standard, §3.4). A seed whose schemes fail the contrast check is moved to the nearest passing tone
 * with a warning (S-A19-BAD-LOW-CONTRAST-SEED); Save writes `theme {seedColor, tokens}` precomputed for the manifest.
 */
import type { Basemap, Theme, ThemeTokens } from '@hcm/shared';
import type { ThemeTokenSet } from '@hcm/ui/dynamic-color';

import { nearestTone, normalizeHex } from './colour.js';

/** Eight seeds the admin picks with one click: the city's sepia first, then M3's baseline and six others. */
export const SEED_PRESETS = ['#8b5e3c', '#6750a4', '#006a6a', '#3f6836', '#9c4146', '#00658f', '#7d5700', '#5b5f72'] as const;

/** The viewer's basemaps the admin chooses between; any other style a city has is kept as it is. */
const BASEMAP_STYLES = {
    standard: 'mapbox://styles/mapbox/standard',
    'standard-satellite': 'mapbox://styles/mapbox/standard-satellite',
} as const;

export type BasemapChoice = keyof typeof BASEMAP_STYLES;

const BASEMAP_CHOICES = Object.keys(BASEMAP_STYLES) as readonly BasemapChoice[];

/** The choice a city's basemap is (none: Standard, the manifest's default), or `custom` for another style. */
export function basemapChoiceOf(basemap: Basemap | undefined): BasemapChoice | 'custom' {
    const style = basemap?.style ?? BASEMAP_STYLES.standard;
    return BASEMAP_CHOICES.find((choice) => BASEMAP_STYLES[choice] === style) ?? 'custom';
}

/** The basemap of a choice, its Standard configuration kept (`lightPreset`, `show3dObjects`, ...). */
export function basemapFor(choice: BasemapChoice, current: Basemap | undefined): Basemap {
    return current?.config === undefined ? { style: BASEMAP_STYLES[choice] } : { style: BASEMAP_STYLES[choice], config: current.config };
}

/** What the theme section needs to make and check schemes (`services.theme` and the injected contrast check). */
export interface ThemeTools {
    readonly theme: (seed: string) => ThemeTokenSet;
    /** Whether a theme's schemes pass the contrast check (`contrastIssues` of `@hcm/ui/dynamic-color`, injected). */
    readonly passes: (tokens: ThemeTokenSet) => boolean;
}

export interface SeedTheme {
    /** The seed the theme was made from: the one typed, or the nearest passing tone. */
    readonly seed: string;
    /** The typed seed failed the contrast check and was moved (the page warns). */
    readonly adjusted: boolean;
    readonly theme: Theme;
}

function themeOf(seed: string, tokens: ThemeTokenSet): Theme {
    return { seedColor: seed, tokens: tokensOf(tokens) };
}

/** A generated token set as the manifest stores it. */
export function tokensOf(tokens: ThemeTokenSet): ThemeTokens {
    return {
        light: tokens.light,
        dark: tokens.dark,
        highContrastLight: tokens.highContrastLight,
        highContrastDark: tokens.highContrastDark,
    };
}

/** The theme of a typed seed (null when it is no `#rrggbb`): the seed's own when it passes, else the nearest passing tone's. */
export function seedTheme(typed: string, tools: ThemeTools): SeedTheme | null {
    const seed = normalizeHex(typed);
    if (seed === null) {
        return null;
    }
    const passing = nearestTone(seed, (candidate) => tools.passes(tools.theme(candidate))) ?? seed;
    return { seed: passing, adjusted: passing !== seed, theme: themeOf(passing, tools.theme(passing)) };
}

/** WCAG AA for body text in the standard schemes, and the high-contrast schemes' aim (`@hcm/ui/dynamic-color`). */
const STANDARD_MINIMUM = 4.5;
const HIGH_MINIMUM = 7;

/**
 * The contrast check of a theme from `contrastIssues` of `@hcm/ui/dynamic-color` (injected: the admin's node tests cannot
 * load the colour library): every text pair of the standard schemes at 4.5:1, of the high-contrast ones at 7:1.
 */
export function contrastPasses(
    issues: (tokens: Readonly<Record<string, string>>, minimum: number) => readonly unknown[],
): ThemeTools['passes'] {
    return (set) =>
        issues(set.light, STANDARD_MINIMUM).length === 0 &&
        issues(set.dark, STANDARD_MINIMUM).length === 0 &&
        issues(set.highContrastLight, HIGH_MINIMUM).length === 0 &&
        issues(set.highContrastDark, HIGH_MINIMUM).length === 0;
}
