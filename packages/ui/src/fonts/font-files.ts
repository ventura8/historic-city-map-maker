/**
 * The self-hosted font files of the kit (`packages/ui/fonts/`, licences in `packages/ui/fonts/LICENSES.md`). The
 * family names are namespaced so a host page's own "Roboto Flex" or icon font never replaces ours, and ours never
 * restyles the host page. `packages/ui/scripts/build-fonts.mjs` reads this table to (re)build the files.
 */

/** The text family of every kit element (variable weight 100–1000). */
export const TEXT_FONT_FAMILY = 'HCM Roboto Flex';

/** The icon family: Material Symbols Rounded, subset to `ICONS` (`packages/ui/src/icons-sorted.ts`, the lists of `icons.ts`). */
export const ICON_FONT_FAMILY = 'HCM Material Symbols Rounded';

/** The CSS `font-family` stack of the kit: ours first, then the M3 fallbacks. */
export const TEXT_FONT_STACK = `'${TEXT_FONT_FAMILY}', Roboto, 'Noto Sans', system-ui, sans-serif`;

/** A file inside an npm package: `path` is relative to the package's folder. */
export interface FontSource {
    readonly package: '@fontsource-variable/roboto-flex' | 'material-symbols';
    readonly path: string;
}

export interface FontFile {
    readonly family: string;
    /** File name in `packages/ui/fonts/` (and in the engine's `fonts/` folder next to its script). */
    readonly file: string;
    /** The npm package file it is built from (copied as is, or subset for the icon font). */
    readonly source: FontSource;
    /** True for the icon font: subset to `ICONS` and instanced (`ICON_FONT_AXES`) instead of copied. */
    readonly subset: boolean;
    /** CSS `font-weight` descriptor (a range for a variable font). */
    readonly weight: string;
    /** CSS `unicode-range` descriptor; absent means every code point the file has. */
    readonly unicodeRange?: string;
    /** `swap` for text (readable at once), `block` for icons (a ligature name must never flash as text). */
    readonly display: FontDisplay;
}

/** The Material Symbols axes: the subset pins these, and keeps `FILL` (0 outlined, 1 filled) variable. */
export const ICON_FONT_AXES = { pinned: { wght: 400, GRAD: 0, opsz: 24 }, variable: ['FILL'] } as const;

/**
 * @fontsource's ranges for its `latin`, `latin-ext` and `cyrillic` files: Romanian needs the first two (ă, ș, ț are in
 * latin-ext, as Polish and Turkish letters are), Russian and Ukrainian the third (ґ included). A page fetches a file only
 * when it draws a character of its range. Arabic, Devanagari, Chinese, Japanese and Korean use the stack's system fonts
 * (`system-ui, sans-serif`): no font of theirs is small enough to ship (docs/research/DECISIONS-for-review.md §218).
 */
const LATIN_RANGE =
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const CYRILLIC_RANGE = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const LATIN_EXT_RANGE =
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

export const FONT_FILES: readonly FontFile[] = [
    {
        family: TEXT_FONT_FAMILY,
        file: 'roboto-flex-latin-wght.woff2',
        source: { package: '@fontsource-variable/roboto-flex', path: 'files/roboto-flex-latin-wght-normal.woff2' },
        subset: false,
        weight: '100 1000',
        unicodeRange: LATIN_RANGE,
        display: 'swap',
    },
    {
        family: TEXT_FONT_FAMILY,
        file: 'roboto-flex-latin-ext-wght.woff2',
        source: { package: '@fontsource-variable/roboto-flex', path: 'files/roboto-flex-latin-ext-wght-normal.woff2' },
        subset: false,
        weight: '100 1000',
        unicodeRange: LATIN_EXT_RANGE,
        display: 'swap',
    },
    {
        family: TEXT_FONT_FAMILY,
        file: 'roboto-flex-cyrillic-wght.woff2',
        source: { package: '@fontsource-variable/roboto-flex', path: 'files/roboto-flex-cyrillic-wght-normal.woff2' },
        subset: false,
        weight: '100 1000',
        unicodeRange: CYRILLIC_RANGE,
        display: 'swap',
    },
    {
        family: ICON_FONT_FAMILY,
        file: 'material-symbols-rounded.woff2',
        source: { package: 'material-symbols', path: 'material-symbols-rounded.woff2' },
        subset: true,
        weight: '400',
        display: 'block',
    },
];
