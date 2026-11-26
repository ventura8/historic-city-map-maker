/**
 * The map's tab icon (the owner, 2026-11-08: "the map icon we use in Layers as the default browser tab icon"): the
 * Material Symbols Rounded `map` glyph the Layers panel draws beside each historical layer, white on a rounded square of
 * the city's seed colour, so it reads on a light and a dark tab strip alike.
 *
 * - `MAP_GLYPH_PATH` is the glyph's outline as HarfBuzz draws it from the kit's own subset
 *   (`packages/ui/fonts/material-symbols-rounded.woff2`: `FILL` 0, `wght` 400, `opsz` 24; 960 units to the em, y up).
 *   `packages/ui/scripts/build-fonts.mjs --check` (the static stage's font gate) reads the committed font and refuses
 *   a path that is no longer the font's. Material Symbols: Apache License 2.0, Copyright Google LLC
 *   (`packages/ui/fonts/LICENSES.md`).
 * - `mapIconSvg` is our own SVG text, never a user's: the functions render it to PNG with sharp (a city's default icon).
 * - `DEFAULT_FAVICON_DATA_URL` is that icon at 32 px in the project's default colour, inlined by every page the build
 *   writes (the city sites without a bucket, `/city/` before its city's own loads, the admin, the start page, 404) and by
 *   the starter kit; every page's policy allows `data:` images. `functions/test/cities/map-icon.test.ts` renders the
 *   SVG again and compares the pixels.
 *
 * A city's own icon lives in the public bucket at fixed names (`STORAGE_PATHS.cityIcon`), at `CITY_ICON_SIZES`;
 * `cities.setIcon` writes it (`docs/research/M2-interfaces.md` → *The city's tab icon*).
 */

/** The `map` glyph of Material Symbols Rounded (y up, 960 units to the em, the glyph within 120…840). */
export const MAP_GLYPH_PATH =
    'M574,129L360,204L174,132Q164,128 154.5,129.5Q145,131 137,136Q129,141 124.5,149.5Q120,158 120,169L120,730Q120,743 127.5,753' +
    'Q135,763 148,768L334,831Q340,833 346.5,834Q353,835 360,835Q367,835 373.5,834Q380,833 386,831L600,756L786,828Q796,832 805.5,830.5' +
    'Q815,829 823,824Q831,819 835.5,810.5Q840,802 840,791L840,230Q840,217 832.5,207Q825,197 812,192L626,129Q620,127 613.5,126' +
    'Q607,125 600,125Q593,125 586.5,126Q580,127 574,129ZM560,218L560,686L400,742L400,274L560,218ZM640,218L760,258L760,732L640,686' +
    'L640,218ZM200,228L320,274L320,742L200,702L200,228ZM640,686L640,686L640,218L640,218L640,686ZM320,742L320,742L320,274L320,274' +
    'L320,742Z';

/** The project's default seed colour (`sites/bucharest/site.json` → `themeColor`, the kit's `theme-color`). */
export const DEFAULT_ICON_COLOR = '#8B5E3C';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** The em of the glyph's font. */
const EM = 960;
/** The square's corner radius, about 22 % of its side. */
const RADIUS = 211;
/** The glyph spans 720 units; at this scale it fills about 62 % of the square. */
const GLYPH_SCALE = 0.8267;

/** An icon's side: a whole number of pixels from 16 to 1024. */
function iconSide(size: number): boolean {
    return Number.isInteger(size) && size >= 16 && size <= 1024;
}

/**
 * The icon as SVG text: a rounded square of `seedColor` with the glyph in `glyphColor` (white unless named). Throws on
 * anything but `#RRGGBB` colours.
 */

export function mapIconSvg(seedColor: string, size = 512, glyphColor = '#FFFFFF'): string {
    if (![seedColor, glyphColor].every((colour) => HEX_COLOR.test(colour)) || !iconSide(size)) {
        throw new RangeError(`not an icon's colours and size: ${JSON.stringify([seedColor, glyphColor])}, ${String(size)}`);
    }
    const [half, scale] = [String(EM / 2), String(GLYPH_SCALE)];
    const glyph = `translate(${half} ${half}) scale(${scale} -${scale}) translate(-${half} -${half})`;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(EM)} ${String(EM)}">`,
        `<rect width="${String(EM)}" height="${String(EM)}" rx="${String(RADIUS)}" fill="${seedColor}"/>`,
        `<path transform="${glyph}" fill="${glyphColor}" d="${MAP_GLYPH_PATH}"/>`,
        '</svg>',
    ].join('');
}

/** The default icon at 32 px in `DEFAULT_ICON_COLOR`, a PNG (rendered by sharp from `mapIconSvg`; the functions' test checks it). */
export const DEFAULT_FAVICON_DATA_URL =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACTUlEQVRYw+1XTWsTQRje36D+lYK4G+vNU6tHi9ltxYMU' +
    '9WYQPKit1EN2g1AIWEypFNoeWj/x4xBF0dIQqg1FIbdEtGJpl7SbhNo2bt/OM7XrpG5CY9JdkH1gGJiv99mZ2XmeV5IEGF3tR6Ka3Kdr8kdWl3RNoVYUrBVV' +
    'lQ+6Kt+8rbYdltxghJXTbMBqq4LWLCxGVA2dcgmu2Ace3CGh2A4JbLsnX773WFR5hR8HzsXr4H/uhnJDYhdkzjcC7GJK+73tI9c0mnk8Ql+zGfr8/gU9iEUo' +
    'du5E3Tnjt3ppLjlFz+/219oBS6q3wPDVszT9MEHmQp7csFZcpczrRzQxcJH07hCfE7/UQW8n4mR+/+KMK6+YNWPUJDD/5slfAX+WLV5XNtapsrlR1WeZi5Sb' +
    'T5H9q+JKtGECmAQsL+To3eQQJSJnKHnf4G0/clkavHCSXt4boPynNG3ZdlXAUmGJUk9H6dXoneYJTBlXnDaRgDg2frmTCovfeF/62RgZPcd5O+Z6QgAFbQDG' +
    '7LYFBAICAYGAwP9FAM8rnlkAzy6eX08IQFAgLBAYERAgCBEECcIkEoBwQcAgZE0TEAGpheRCekVAmiHRomSLgLQ3TAAmYhcwFzAZMBu8n5kPmBCYETeifA4z' +
    'MTAzMDX1TA8zpUrRrQM2CnYKtqreArBlsGewabBrsG2wb/vNEfw3pX7acrb71yUkB34kJqwUYuePHuLZEdIkr1MzQzvWWZUfggTSJS++XA/LHa4ZMo4D6dJO' +
    'Ku3+d/xjCmaxehZrO9v+G9tIuMRFoT7ILgAAAABJRU5ErkJggg==';

/**
 * The default icon's two variants (the owner, 2026-11-12: "make sure the icon in the tab uses the theme set by the
 * user"): the square in the theme's `primary` and the glyph in its `on-primary`, of the light and of the dark palette of
 * `DEFAULT_ICON_COLOR`'s theme (`node packages/ui/scripts/gen-theme.mjs --seed '#8B5E3C'`). A page links both, each under
 * its `prefers-color-scheme`, so the tab follows the system before any script runs; `paintTabIcon` (`tab-icon.ts`) then
 * draws the glyph in the colours of the theme the visitor chose.
 */
export const DEFAULT_ICON_VARIANTS = {
    light: { fill: '#875329', glyph: '#FFF7F4' },
    dark: { fill: '#F4BB92', glyph: '#5D3719' },
} as const;

/** The two variants at 32 px, PNGs as `data:` addresses (sharp's drawing of `mapIconSvg`; the functions' test checks them). */
export const DEFAULT_TAB_ICONS = {
    light:
        'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACVklEQVRYw2NgQAI9kWoibcGaje3BmmfbgzQ+A+n/VM' +
        'Egs4I0zwDZDW0BGsIM2EBrkGZAW5DmB6pZigND7fDHsBzowr+0thwRImC7/BHBTgefY2KN9+DoAMUL/S2HRYdGPQOQODdQDgAlTAZiU/ucAp//R5ZP+P/w' +
        '/KH/l3at+L+qOeV/Z5guXj2LKyP+n9k47/+mviJcDvjIgM+AWbme/w8t6fv/+s7l//+/f8HA314/+X9u88L/S6oi/7eHaIH1TEy0+r9vbuv/N3euwNV9fv' +
        '4Apx04HXB+6yIMC7+/eQamf3988//3p7coch+f3Pl/98Su/3+/fMDqUJIdANIE0vz69qX/BxZ2/Z+R7fZ/x/QasNjza6f+98Wa/t8ysez/vVN7/v/7+hHF' +
        'wk/P7v0/tnLy/10z6yl3wMqmZLgYsgOQ1U5Ksv7/7v51sNzx1dP+d4TqgMVBeuniABAGiYHkQGpgYqMOGHXAqANGHTC8HAAqXkHFLEgMVOyCil+6OABUoY' +
        'AqFlAFg1zhgCogUEUEqpBAFROyA0AVF6gCA1VkFDsAGYOqWlCVC6p6kcVBVTOoikauspExqGon2QGgRgTMAFDjAtTIADU2wPLAxgeoEQJqjGBzKLgaBzZi' +
        'QI0ZUKMGX6OHAdgR+YRNAtSMAjWnQM0qfAaAmmWg5hmomQZqroGabaDmG7F9hEHQKB3AZjmwQVzHAOocDEjHJEjjXW+olhC4dwTqJtG7a9YWqOWH0j8EOw' +
        'LYXaKHz9uD1H2x9pAh0aFRD0ocuHIHmT7+CIzm0yCz4cEOBQBvHUvzoUPWjAAAAABJRU5ErkJggg==',
    dark:
        'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACVUlEQVRYw+1XS0scQRCe36BeRD0YkICoBy+K8SCSBz' +
        '7jAx8goiSSICh7CLuIqKuGRBFFe8SL4knxgQcFJZgZMddIEgkeBT3qQdDdnd2jlP217trrziw+Z0G2oRio7q76Zqqnv68URRq+X6NJhq4OGBr759eY4ddV' +
        'ehTjsXjcv4bO+r36ZKJiNgJbapVfZ55HS2ppzBPQ2fuI5Bzh+dMnvzTkCoHAZ7fnzW+WRT0T5UBdbE9+DcKtGJq6GysAOJjKbU/7/nwvLXbV0WBDHk21v6' +
        'XfUw7ybo5H3bM366JZRzltj36yWuNVogU4WHTTcnc9uSqyqTkvOcLai1/QTGcZ/Z9xEv91xZ7jtSFadTeRszwrtK7jdYZlDksA0x0lEQk/F6WL58fCNPrw' +
        'Ki1szvHuJQ03F1JrQaop0DsDwCZsdlXm0EpPIx0uDdCPb63C11OTSyfrI6SPtNH3pgJqyU8JS9j5JoMWXLW08bXl4QB2eK2DPhmAvPZodYi+lGaKuTlnNf' +
        'm0CeHHXlsAwODDHNYEfXEAcQBxAHEAzwsArldcs/Dh2sX1awsAEAqIBQQjEw4ICEQEQgIxyQBAXCAwENmDAcgGqgXlgnplP6gZFC1Ttmyg9jsDgIgIBoC4' +
        'gMiA2BBSiosPiBCIETOggsa5iIGYgaiJJnq4JFN9ZhOQUZBTkFXRAkCWQZ5BpkGuQbZBvt22R4i9KI2tLGd9CpqDmDQmOjv1bI4lXLZmvE2yvTXTJivD+0' +
        'MOAu2SHW8e+MkqTDtkUQ7eLuFwWP0d9zQvP2t/EDv02a/GBV4HWp3q4Er7AAAAAElFTkSuQmCC',
} as const;

/** The icon's geometry for a canvas (`paintTabIcon`): the em, the square's corner radius, the glyph's scale. */
export const MAP_ICON_GEOMETRY = { em: EM, radius: RADIUS, scale: GLYPH_SCALE } as const;
