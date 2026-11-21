/**
 * The installable app's web app manifest (`docs/ENGINE_API.md` → *Installable app*; lesson 711: Chrome and Edge give the
 * device's accent colour only to an installed web app): each public city site is its own app, the admin another. One
 * builder for every manifest the site build writes (`scripts/site/src/app.ts`), so the fields never drift.
 *
 * The app is named after the page's title, opens standalone at its folder (`start_url`, `scope` and `id` are the folder,
 * relative to the manifest beside the page: `./`), and wears the page's theme colour (`theme_color`, the title bar of an
 * installed app) on a white splash (`background_color`). Its icons are three PNGs beside it (`APP_ICON_FILES`): 192 and
 * 512 px, and a maskable 512 whose glyph sits inside the safe circle (the operating system crops it to its own shape).
 */

/** The manifest's file name, beside the page that links it. */
export const WEB_APP_MANIFEST_FILE = 'app.webmanifest';

/** The icons' files beside the manifest (`scripts/site/src/app-icons.ts` draws them). */
export const APP_ICON_FILES = {
    small: 'app-icon-192.png',
    large: 'app-icon-512.png',
    maskable: 'app-icon-maskable-512.png',
} as const;

/** One icon of the manifest. */
export interface WebAppIcon {
    readonly src: string;
    readonly sizes: string;
    readonly type: string;
    readonly purpose?: 'maskable';
}

/** What a manifest says of its app. */
export interface WebAppManifestInput {
    /** The page's title: `name`, and `short_name` cut at a word. */
    readonly name: string;
    /** `start_url`, `scope` and `id`: the app's folder (`./` beside the page). */
    readonly folder: string;
    readonly lang: string;
    /** `#RRGGBB`: the page's theme colour. */
    readonly themeColor: string;
}

/** The manifest's JSON object (`display: standalone`). */
export interface WebAppManifest {
    readonly id: string;
    readonly name: string;
    readonly short_name: string;
    readonly lang: string;
    readonly start_url: string;
    readonly scope: string;
    readonly display: 'standalone';
    readonly theme_color: string;
    readonly background_color: string;
    readonly icons: readonly WebAppIcon[];
}

/** A home screen's label is short: the title cut at a word, at most this many characters. */
const SHORT_NAME_LENGTH = 24;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** The splash screen's colour behind the icon. */
const BACKGROUND_COLOR = '#FFFFFF';

function shortName(name: string): string {
    if (name.length <= SHORT_NAME_LENGTH) {
        return name;
    }
    const cut = name.slice(0, SHORT_NAME_LENGTH);
    const space = cut.lastIndexOf(' ');
    return (space > 0 ? cut.slice(0, space) : cut).trim();
}

/** The three PNG icons beside the manifest. */
export const APP_ICONS: readonly WebAppIcon[] = [
    { src: APP_ICON_FILES.small, sizes: '192x192', type: 'image/png' },
    { src: APP_ICON_FILES.large, sizes: '512x512', type: 'image/png' },
    { src: APP_ICON_FILES.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** The manifest of an app; throws RangeError on an empty name or folder, or a colour that is not `#RRGGBB`. */
export function webAppManifest(input: WebAppManifestInput): WebAppManifest {
    const name = input.name.trim();
    if (name === '' || input.folder === '' || !HEX_COLOR.test(input.themeColor)) {
        throw new RangeError(`not an app's manifest: ${JSON.stringify({ name, folder: input.folder, themeColor: input.themeColor })}`);
    }
    return {
        id: input.folder,
        name,
        short_name: shortName(name),
        lang: input.lang,
        start_url: input.folder,
        scope: input.folder,
        display: 'standalone',
        theme_color: input.themeColor,
        background_color: BACKGROUND_COLOR,
        icons: APP_ICONS,
    };
}

/** The manifest's file text. */
export function webAppManifestText(input: WebAppManifestInput): string {
    return `${JSON.stringify(webAppManifest(input), null, 4)}\n`;
}
