/**
 * The baseline theme: the four token sets of `DEFAULT_SEED_COLOR` (#6750A4, TonalSpot, SpecVersion 2025), precomputed
 * so the viewer can theme its loading and error states before a manifest (and its city theme) has arrived, without
 * shipping the colour library. The values come from `node packages/ui/scripts/gen-theme.mjs --seed '#6750A4'`;
 * `packages/ui/test/theme/baseline.test.ts` pins the result to `themeFromSeed(DEFAULT_SEED_COLOR)`.
 *
 * Kept compact (DECISIONS-for-review.md §128b): the role names once, each scheme as one string of `rrggbb` values in role
 * order, expanded into the same objects when the module loads. Written out, the 212 token names cost the engine about
 * 600 bytes gzip, which paid for the map's zoom buttons within its budget.
 */
import type { ThemeTokens } from '@hcm/shared';

/** The colour roles, in the generator's order: each is the token `--md-sys-color-<role>`. */
const ROLES = (
    'background on-background surface surface-dim surface-bright surface-container-lowest surface-container-low ' +
    'surface-container surface-container-high surface-container-highest on-surface on-surface-variant outline outline-variant ' +
    'inverse-surface inverse-on-surface primary primary-dim on-primary primary-container on-primary-container primary-fixed ' +
    'primary-fixed-dim on-primary-fixed on-primary-fixed-variant inverse-primary secondary secondary-dim on-secondary ' +
    'secondary-container on-secondary-container secondary-fixed secondary-fixed-dim on-secondary-fixed ' +
    'on-secondary-fixed-variant tertiary tertiary-dim on-tertiary tertiary-container on-tertiary-container tertiary-fixed ' +
    'tertiary-fixed-dim on-tertiary-fixed on-tertiary-fixed-variant error error-dim on-error error-container ' +
    'on-error-container shadow scrim surface-variant surface-tint'
).split(' ');

/** One scheme's tokens from its values: six hex digits per role, in `ROLES` order. */
function colors(values: string): Readonly<Record<string, string>> {
    return Object.fromEntries(ROLES.map((role, index) => [`--md-sys-color-${role}`, `#${values.slice(index * 6, index * 6 + 6)}`]));
}

export const BASELINE_THEME: ThemeTokens = {
    light: colors(
        'fdf7fe34313afdf7feded8e4fdf7fefffffff8f1faf2ecf5ece6f0e7e0ec34313a615d687d7983b5b0bb0f0d12a09ba1655789594b7c' +
            'fdf7ffd4c3fd493c6cd4c3fdc6b6ee352857524576d4c3fd625c71565065fdf7ffe8def8554f63e8def8dad0ea423c505f586e7b5270' +
            '6e4664fff7f9f4bfe35f3956f4bfe3e5b2d54a2642694260a8364b6b0221fff7f7f973866e0523000000000000e7e0ec655789',
    ),
    dark: colors(
        '0f0d12eae3ef0f0d120f0d122e2b340000001412181b181f211e2627242deae3efaea9b478737e4a4650fdf7fe575459cdc0ecbfb2de' +
            '443a5f574d72e9deffded0fed0c3ef3c3256594e74645980cbc2dbbeb5cd433d513e384cc4bbd4e8def8dad0ea423c505f586effcfef' +
            'f4bfe369415ff4bfe35f3956f4bfe3e5b2d54a2642694260f97386c44b5f490013871c34ff97a300000000000027242dcdc0ec',
    ),
    highContrastLight: colors(
        'fdf7fe000000fdf7feded8e4fdf7fefffffff8f1faf2ecf5ece6f0e7e0ec00000025232b45414b54505a0f0d12ffffff281b491e103f' +
            'e1d3ff584a7bffffff584a7b4c3f6fffffffffffffd4c3fd2621341c1729dfd6ef554f64ffffff554f64494358ffffffffffff391733' +
            '2e0d28ffcbee6d4563ffffff6d4563603a57ffffffffffff5000163d000fffced297283effffff000000000000e7e0ec281b49',
    ),
    highContrastDark: colors(
        '0f0d12ffffff0f0d120f0d122e2b340000001412181b181f211e2627242dffffffeae3efbcb6c2a7a1adfdf7fe000000ebe1ffded0fe' +
            '302649aa9dc8000000ded0fed0c3ef000000180e303c3256ebe1fbddd3ed2e293ca8a0b8000000e8def8dad0ea000000221d2fffdbf2' +
            'fac5e943203bf4bfe32e0e29f4bfe3e5b2d5000000180015ffdddfffc7cb5f001cff798c00000000000000000027242debe1ff',
    ),
};
