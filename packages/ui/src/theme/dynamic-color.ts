/**
 * Material 3 dynamic colour: the four `--md-sys-color-*` token sets of a city theme (light, dark,
 * high-contrast light, high-contrast dark) from one seed colour, with `@material/material-color-utilities`
 * (SpecVersion 2025; TonalSpot by default, Expressive or Vibrant for a bolder city). Pure: the admin calls it for the live preview, the manifest builder and
 * `packages/ui/scripts/gen-theme.mjs` precompute the tokens into the manifest, so the viewer never
 * ships the colour library.
 */
import {
    argbFromHex,
    Hct,
    hexFromArgb,
    MaterialDynamicColors,
    SchemeExpressive,
    SchemeTonalSpot,
    SchemeVibrant,
    type DynamicColor,
    type DynamicScheme,
} from '@material/material-color-utilities';

export type ColorTokens = Readonly<Record<string, string>>;

export interface ThemeTokenSet {
    readonly light: ColorTokens;
    readonly dark: ColorTokens;
    readonly highContrastLight: ColorTokens;
    readonly highContrastDark: ColorTokens;
}

/** The colour specification the tokens follow (M3 Expressive era). */
export const SPEC_VERSION = '2025';

/** MCU contrast levels: 0 is the standard scheme, 1 the high-contrast one. */
export const STANDARD_CONTRAST = 0;
export const HIGH_CONTRAST = 1;

/** The M3 baseline seed, used when a city's seed colour is not a valid `#rrggbb` (scenario V12). */
export const DEFAULT_SEED_COLOR = '#6750A4';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: string): boolean {
    return HEX_COLOR.test(value);
}

/** The scheme variants a city may pick: TonalSpot (the M3 default, calm), Expressive and Vibrant (M3 Expressive). */
export const THEME_VARIANTS = ['tonalSpot', 'expressive', 'vibrant'] as const;

export type ThemeVariant = (typeof THEME_VARIANTS)[number];

const SCHEMES = { tonalSpot: SchemeTonalSpot, expressive: SchemeExpressive, vibrant: SchemeVibrant } as const;

/** The scheme of `seed` for one mode, contrast level and variant (TonalSpot unless told otherwise). */
export function schemeFor(seed: string, dark: boolean, contrastLevel: number, variant: ThemeVariant = 'tonalSpot'): DynamicScheme {
    return new SCHEMES[variant](Hct.fromInt(argbFromHex(seed)), dark, contrastLevel, SPEC_VERSION);
}

/** `on_primary_container` → `--md-sys-color-on-primary-container`. */
export function tokenName(colorName: string): string {
    return `--md-sys-color-${colorName.replaceAll('_', '-')}`;
}

/** Every role of the 2025 spec, plus the roles MWC and M3E still read that `allColors` leaves out. */
function colorRoles(): DynamicColor[] {
    const colors = new MaterialDynamicColors();
    const extra = [colors.shadow(), colors.scrim(), colors.surfaceVariant(), colors.surfaceTint()];
    return [...colors.allColors, ...extra];
}

/** The `--md-sys-color-*` tokens of one scheme, in role order, as `#rrggbb`. */
export function tokensForScheme(scheme: DynamicScheme): ColorTokens {
    return Object.fromEntries(colorRoles().map((color) => [tokenName(color.name), hexFromArgb(color.getArgb(scheme))]));
}

/** The four token sets of a city theme; an invalid seed falls back to `DEFAULT_SEED_COLOR`. */
export function themeFromSeed(seed: string, variant: ThemeVariant = 'tonalSpot'): ThemeTokenSet {
    const source = isHexColor(seed) ? seed : DEFAULT_SEED_COLOR;
    return {
        light: tokensForScheme(schemeFor(source, false, STANDARD_CONTRAST, variant)),
        dark: tokensForScheme(schemeFor(source, true, STANDARD_CONTRAST, variant)),
        highContrastLight: tokensForScheme(schemeFor(source, false, HIGH_CONTRAST, variant)),
        highContrastDark: tokensForScheme(schemeFor(source, true, HIGH_CONTRAST, variant)),
    };
}

function channel(value: number): number {
    const srgb = value / 255;
    return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of `#rrggbb`. */
export function relativeLuminance(hex: string): number {
    const value = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((value >> 16) & 0xff) + 0.7152 * channel((value >> 8) & 0xff) + 0.0722 * channel(value & 0xff);
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
    const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

/** Text roles and the container they sit on, checked by `contrastIssues`. */
export const CONTRAST_PAIRS: readonly (readonly [foreground: string, background: string])[] = [
    ['on-primary', 'primary'],
    ['on-primary-container', 'primary-container'],
    ['on-secondary', 'secondary'],
    ['on-secondary-container', 'secondary-container'],
    ['on-tertiary', 'tertiary'],
    ['on-tertiary-container', 'tertiary-container'],
    ['on-error', 'error'],
    ['on-error-container', 'error-container'],
    ['on-surface', 'surface'],
    ['on-surface-variant', 'surface'],
    ['inverse-on-surface', 'inverse-surface'],
];

export interface ContrastIssue {
    readonly foreground: string;
    readonly background: string;
    readonly ratio: number;
}

/** The pairs of `tokens` below `minimum` (WCAG AA body text: 4.5; the high-contrast schemes aim at 7). */
export function contrastIssues(tokens: ColorTokens, minimum: number): ContrastIssue[] {
    return CONTRAST_PAIRS.flatMap(([foreground, background]) => {
        const ratio = contrastRatio(tokens[tokenName(foreground)] ?? '#000000', tokens[tokenName(background)] ?? '#000000');
        return ratio < minimum ? [{ foreground, background, ratio }] : [];
    });
}
