/**
 * "Device accent" (the owner, 2026-11-13: follow the OS accent colour by default): the device's accent colour, where the
 * browser gives the real one, turned into the city's Material 3 schemes, in the viewer and the admin alike.
 *
 * - **Reading it.** CSS's `AccentColor` system colour, resolved on a probe element (`readDeviceAccent`). Firefox gives the
 *   system's accent; Chrome (150 on desktop: Windows, macOS, ChromeOS, and Linux through the desktop portal) gives it only
 *   to an installed web app of the primary profile and a constant blue to every tab (its fingerprinting guard), and Safari
 *   a constant: a constant would paint every city the same blue, so the accent counts only in Firefox and in an installed
 *   Chromium app (`exposesAccent`). A page can name the accent itself with the custom property `--hcm-device-accent` on
 *   its root (an embedding site, the e2e tests); a neutral grey accent, or none, keeps the map's colours. Android's
 *   dynamic colour does not reach the web (Chrome does not expose it there).
 * - **The tokens.** No colour library (the viewer never ships one): every colour of the city's four schemes keeps its
 *   WCAG luminance, its OKLCH hue turns by the angle from the city's primary to the accent, and its chroma grows by the
 *   accent's over the primary's (1 to 3 times, `withAccent`), so a vivid accent reads as itself on a muted city. The tones, and so every contrast ratio of the schemes, stay the city's, so the high-contrast schemes
 *   stay high-contrast; the error roles keep their red, shadow and scrim their black.
 */
import type { ThemeTokens } from '@hcm/shared';

/** The custom property with which a page names the accent itself (it wins over `AccentColor`). */
export const ACCENT_PROPERTY = '--hcm-device-accent';

/** What the user chose: the device's accent (the default) or the map's own colours. */
export type AccentChoice = 'device' | 'map';

export const ACCENT_CHOICES: readonly AccentChoice[] = ['device', 'map'];

/** A stored value that is no choice reads as the default, the device's accent. */
export function accentOf(value: string | null): AccentChoice {
    return value === 'map' ? 'map' : 'device';
}

/** An installed app's window: Chrome exposes the real accent only there. */
const INSTALLED =
    '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay), (display-mode: fullscreen)';

/** Below this OKLCH chroma an accent is a grey (macOS Graphite, a high-contrast theme): it has no hue to give. */
const NEUTRAL_CHROMA = 0.03;

/** The most the accent multiplies the schemes' chroma. */
const MAX_CHROMA_SCALE = 3;

type Rgb = readonly [number, number, number];

const toLinear = (value: number): number => (value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toGamma = (value: number): number => (value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

function linearOf(hex: string): Rgb {
    const value = Number.parseInt(hex.slice(1), 16);
    return [toLinear(((value >> 16) & 0xff) / 255), toLinear(((value >> 8) & 0xff) / 255), toLinear((value & 0xff) / 255)];
}

function hexOf(rgb: Rgb): string {
    const byte = (channel: number): string =>
        Math.round(Math.min(1, Math.max(0, toGamma(channel))) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${rgb.map(byte).join('')}`;
}

/** Linear sRGB to OKLab (Björn Ottosson's matrices). */
function oklabOf([r, g, b]: Rgb): Rgb {
    const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
    const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
    const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
    return [
        0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    ];
}

function linearFromOklch(lightness: number, chroma: number, hue: number): Rgb {
    const a = chroma * Math.cos(hue);
    const b = chroma * Math.sin(hue);
    const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
    const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
    const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
    return [
        4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
        -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
        -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
    ];
}

const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const inGamut = (rgb: Rgb): boolean => rgb.every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6);

/** Halves the interval `[low, high]` 24 times towards the boundary where `isLow` stops holding. */
function bisect(low: number, high: number, isLow: (value: number) => boolean): number {
    let [from, to] = [low, high];
    for (let step = 0; step < 24; step++) {
        const middle = (from + to) / 2;
        [from, to] = isLow(middle) ? [middle, to] : [from, middle];
    }
    return from;
}

/** The colour of `lightness` and `hue` with the most of `chroma` that sRGB can show. */
function fitted(lightness: number, chroma: number, hue: number): Rgb {
    const rgb = linearFromOklch(lightness, chroma, hue);
    if (inGamut(rgb)) {
        return rgb;
    }
    return linearFromOklch(
        lightness,
        bisect(0, chroma, (c) => inGamut(linearFromOklch(lightness, c, hue))),
        hue,
    );
}

/**
 * `hex` turned by `angle` (radians) in OKLCH, its chroma times `scale` (a near-grey surface's by its square root, so it
 * stays a tinted neutral; as much as sRGB can show), with its WCAG luminance kept (the lightness found again by bisection).
 */
export function turnHue(hex: string, angle: number, scale = 1): string {
    const rgb = linearOf(hex);
    const [, a, b] = oklabOf(rgb);
    const own = Math.hypot(a, b);
    const chroma = own * (own < NEUTRAL_CHROMA ? Math.sqrt(scale) : scale);
    const hue = Math.atan2(b, a) + angle;
    const target = luminance(rgb);
    return hexOf(
        fitted(
            bisect(0, 1, (lightness) => luminance(fitted(lightness, chroma, hue)) < target),
            chroma,
            hue,
        ),
    );
}

/** The OKLCH hue of `hex` in radians, or null for a grey that has none. */
export function hueOf(hex: string): number | null {
    const [, a, b] = oklabOf(linearOf(hex));
    return Math.hypot(a, b) < NEUTRAL_CHROMA ? null : Math.atan2(b, a);
}

const HEX = /^#[0-9a-f]{6}$/i;
/** The roles whose colour means something of its own: errors stay red, shadow and scrim black. */
const FIXED_ROLE = /^--md-sys-color-(on-)?(error|shadow|scrim)/;

function turned(scheme: Readonly<Record<string, string>>, angle: number, scale: number): Readonly<Record<string, string>> {
    return Object.fromEntries(
        Object.entries(scheme).map(([name, value]) => [
            name,
            FIXED_ROLE.test(name) || !HEX.test(value) ? value : turnHue(value, angle, scale),
        ]),
    );
}

/** The OKLCH chroma of `hex`. */
export function chromaOf(hex: string): number {
    const [, a, b] = oklabOf(linearOf(hex));
    return Math.hypot(a, b);
}

/**
 * How much more colourful the schemes become: the accent's chroma over the city primary's, within 1 to 3. A city in a
 * muted colour (a lavender, a sepia) turned to a vivid accent kept its own greyness, so a GNOME orange showed as a dull
 * brown nobody took for the device's colour (`docs/LESSONS.md` 714); a muted accent never greys a vivid city.
 */
function chromaScale(accent: string, primary: string): number {
    return Math.min(MAX_CHROMA_SCALE, Math.max(1, chromaOf(accent) / chromaOf(primary)));
}

/** The OKLCH hue of a `#rrggbb` value, or null for anything else and for a grey. */
function hueOfValue(value: string | null | undefined): number | null {
    return value !== null && value !== undefined && HEX.test(value) ? hueOf(value) : null;
}

/**
 * The city's schemes in the accent's hue (see the module's comment); the city's own when the accent or its primary is a
 * grey, or the accent is no `#rrggbb`.
 */
export function withAccent(tokens: ThemeTokens, accent: string | null): ThemeTokens {
    const accentHue = hueOfValue(accent);
    const primaryHue = hueOfValue(tokens.light['--md-sys-color-primary']);
    if (accentHue === null || primaryHue === null) {
        return tokens;
    }
    const angle = accentHue - primaryHue;
    const scale = chromaScale(accent ?? '', tokens.light['--md-sys-color-primary'] ?? '');
    return {
        light: turned(tokens.light, angle, scale),
        dark: turned(tokens.dark, angle, scale),
        highContrastLight: turned(tokens.highContrastLight, angle, scale),
        highContrastDark: turned(tokens.highContrastDark, angle, scale),
    };
}

/** `rgb(r, g, b)` (a computed colour) as `#rrggbb`; null for anything else (a transparent or a wide-gamut colour). */
export function hexFromComputed(value: string): string | null {
    const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value.trim());
    return match === null
        ? null
        : `#${match
              .slice(1, 4)
              .map((part) => Number(part).toString(16).padStart(2, '0'))
              .join('')}`;
}

/** Whether `AccentColor` is the device's own in `win` (`css`: its `CSS`): Firefox, or Chromium (`userAgentData`) in an installed app's window. */
export function exposesAccent(win: Window, css: Pick<typeof CSS, 'supports'> = CSS): boolean {
    if (!css.supports('color', 'AccentColor')) {
        return false;
    }
    const gecko = css.supports('-moz-appearance', 'none');
    const chromium = 'userAgentData' in win.navigator;
    return gecko || (chromium && win.matchMedia(INSTALLED).matches);
}

/** `color` resolved by the browser, on a probe element under the document's root (removed at once). */
function resolved(doc: Document, color: string): string | null {
    const probe = doc.createElement('span');
    probe.style.setProperty('color', color);
    probe.style.setProperty('display', 'none');
    doc.documentElement.append(probe);
    const value = doc.defaultView?.getComputedStyle(probe).color ?? '';
    probe.remove();
    return hexFromComputed(value);
}

/**
 * The device's accent as `#rrggbb`: the page's `--hcm-device-accent`, else `AccentColor` where it is the device's own
 * (`exposesAccent`, `css` the window's `CSS`); null where there is none, and under forced colours (the system paints the page then).
 */
export function readDeviceAccent(doc: Document, css: Pick<typeof CSS, 'supports'>): string | null {
    const win = doc.defaultView;
    if (win === null || win.matchMedia('(forced-colors: active)').matches) {
        return null;
    }
    const named = namedAccent(win, doc);
    if (named !== '') {
        return resolved(doc, named);
    }
    return exposesAccent(win, css) ? resolved(doc, 'AccentColor') : null;
}

/** The page's own `--hcm-device-accent` on its root, or an empty string. */
function namedAccent(win: Window, doc: Document): string {
    return win.getComputedStyle(doc.documentElement).getPropertyValue(ACCENT_PROPERTY).trim();
}

/**
 * What Device accent can show here (the owner, 2026-11-14: the option must say when it cannot work): `shared`, the device's
 * accent; `grey`, an accent with no hue, so the map's colours; `hidden`, a browser that does not give the device's accent
 * (every Chrome, Edge and Safari tab, Android included) or forced colours, so the map's colours.
 */
export type DeviceAccentState = 'shared' | 'grey' | 'hidden';

export function deviceAccentState(doc: Document, css: Pick<typeof CSS, 'supports'> = CSS): DeviceAccentState {
    const accent = readDeviceAccent(doc, css);
    if (accent === null) {
        return 'hidden';
    }
    return hueOf(accent) === null ? 'grey' : 'shared';
}

/** The tokens a theme wears for `choice`: the city's in the device's accent, or the city's own. */
export function accentTokens(
    tokens: ThemeTokens,
    choice: AccentChoice,
    doc: Document,
    css: Pick<typeof CSS, 'supports'> = CSS,
): ThemeTokens {
    return choice === 'device' ? withAccent(tokens, readDeviceAccent(doc, css)) : tokens;
}
