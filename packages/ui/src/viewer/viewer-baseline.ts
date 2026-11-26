/**
 * The baseline theme as the viewer applies it: `BASELINE_THEME` (`theme/baseline.ts`, the default seed's four schemes)
 * cut to the 27 colour tokens the viewer, the kit and the map name. The other 26 (background, the fixed and dim roles,
 * tertiary, surface-variant, surface-tint) are only the admin's, and they weighed 710 bytes of the engine's IIFE gzip
 * (2026-11-09). It themes the viewer before a manifest arrives, and fills what a city theme leaves out (a manifest's
 * token map may hold 1 to 200 names). `test/viewer/viewer-baseline.test.ts` pins it to `BASELINE_THEME`, and
 * `theme-tokens.test.ts` proves it sets every token the viewer, the kit and the map name.
 */
import type { ThemeTokens } from '@hcm/shared';

/** The 27 colour roles the viewer keeps, in the order of each scheme's values below. */
const ROLES = (
    'surface surface-container-lowest surface-container-low surface-container surface-container-high surface-container-highest ' +
    'on-surface on-surface-variant outline outline-variant inverse-surface inverse-on-surface primary on-primary primary-container ' +
    'on-primary-container inverse-primary secondary on-secondary secondary-container on-secondary-container error on-error ' +
    'error-container on-error-container shadow scrim'
).split(' ');

/**
 * One scheme from its 27 hexadecimal values in `ROLES`' order: the role names are spelt once, not once per scheme (§133b,
 * 360 bytes of the IIFE gzip); `viewer-baseline.test.ts` pins every value to `BASELINE_THEME`.
 */
function scheme(values: string): Readonly<Record<string, string>> {
    return Object.fromEntries(values.split(' ').map((value, index) => [`--md-sys-color-${String(ROLES[index])}`, `#${value}`]));
}

export const VIEWER_BASELINE: ThemeTokens = {
    light: scheme(
        'fdf7fe ffffff f8f1fa f2ecf5 ece6f0 e7e0ec 34313a 615d68 7d7983 b5b0bb 0f0d12 a09ba1 655789 fdf7ff d4c3fd 493c6c d4c3fd 625c71 ' +
            'fdf7ff e8def8 554f63 a8364b fff7f7 f97386 6e0523 000000 000000',
    ),
    dark: scheme(
        '0f0d12 000000 141218 1b181f 211e26 27242d eae3ef aea9b4 78737e 4a4650 fdf7fe 575459 cdc0ec 443a5f 574d72 e9deff 645980 cbc2db ' +
            '433d51 3e384c c4bbd4 f97386 490013 871c34 ff97a3 000000 000000',
    ),
    highContrastLight: scheme(
        'fdf7fe ffffff f8f1fa f2ecf5 ece6f0 e7e0ec 000000 25232b 45414b 54505a 0f0d12 ffffff 281b49 e1d3ff 584a7b ffffff d4c3fd 262134 ' +
            'dfd6ef 554f64 ffffff 500016 ffced2 97283e ffffff 000000 000000',
    ),
    highContrastDark: scheme(
        '0f0d12 000000 141218 1b181f 211e26 27242d ffffff eae3ef bcb6c2 a7a1ad fdf7fe 000000 ebe1ff 302649 aa9dc8 000000 3c3256 ebe1fb ' +
            '2e293c a8a0b8 000000 ffdddf 5f001c ff798c 000000 000000 000000',
    ),
};

/** A city's theme over the baseline's, scheme by scheme, so no token the viewer names is left unset; none: the baseline. */
export function withViewerBaseline(city: ThemeTokens | undefined): ThemeTokens {
    return {
        light: { ...VIEWER_BASELINE.light, ...city?.light },
        dark: { ...VIEWER_BASELINE.dark, ...city?.dark },
        highContrastLight: { ...VIEWER_BASELINE.highContrastLight, ...city?.highContrastLight },
        highContrastDark: { ...VIEWER_BASELINE.highContrastDark, ...city?.highContrastDark },
    };
}
