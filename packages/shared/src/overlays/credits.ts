/**
 * The credits of the historical layers in the visitor's language (the Pixel Tablet, 2026-11-12: the Layers panel said
 * "Sursa: USGS EROS, declassified imagery (public domain)" once per layer, in English on the Romanian map). A layer's
 * `attribution` is stored as the pipeline words it (`USGS_ATTRIBUTION`, `LANDSAT_ATTRIBUTION`, the DEM's notice joined
 * with "; "), in English: the viewer shows each known credit as its text key in the visitor's language and anything else
 * (an admin's own credit, a licence notice) as written.
 */
import { VIEWER_LOCALES, hasCatalogue, translate, type MessageKey, type ViewerLocale } from '../i18n/index.js';

/**
 * Stored credit text by message key (`USGS_ATTRIBUTION`, `LANDSAT_ATTRIBUTION`, `UNCLEAR_CREDIT`). Spelt here, not read from the
 * English catalogue: the engine fetches only the page's language, so on any other page English is not here
 * (`docs/LESSONS.md` 691), and not imported from the schemas, whose zod the engine's bundle would then carry.
 */
export const STORED_CREDITS: Readonly<Partial<Record<MessageKey, string>>> = {
    'layers.attribution.usgs': 'USGS EROS, declassified imagery (public domain)',
    'layers.attribution.landsat': 'Landsat imagery courtesy of NASA Goddard Space Flight Center and U.S. Geological Survey',
    // A layer whose rights are not confirmed (`UNCLEAR_CREDIT`): the admin's licence part of its credit line.
    'layers.attribution.unclear': 'rights unclear',
};

const CREDIT_KEYS = Object.keys(STORED_CREDITS) as readonly MessageKey[];

/** The credits that stand alone; "rights unclear" is one part of an admin's credit line and stays inside it. */
const WHOLE_CREDIT_KEYS = CREDIT_KEYS.filter((key) => key !== 'layers.attribution.unclear');

/** What separates the credits of one layer (`finalize.ts` joins the DEM's notice so). */
const CREDIT_SEPARATOR = '; ';

/**
 * `text` with every known credit, in any language, in `locale`'s words: a layer's attribution, or the map's attribution
 * line, which Mapbox GL drew in the language of the page's first load.
 */
export function localizedCredit(text: string, locale: ViewerLocale): string {
    // The stored English, then every language whose texts are here (one not fetched gives an empty text, never matched).
    const known = VIEWER_LOCALES.filter((other) => hasCatalogue(other));
    return CREDIT_KEYS.reduce((out, key) => {
        const spellings = [[STORED_CREDITS[key]].join(''), ...known.map((other) => translate(other, key))].filter(
            (credit) => credit !== '',
        );
        return spellings.reduce((acc, credit) => acc.replaceAll(credit, translate(locale, key)), out);
    }, text);
}

/**
 * One layer's credits in `locale`: each known credit it holds, then the rest as written (a notice may hold "; " of its
 * own: the DEM's "…; all rights reserved").
 */
function partsOf(attribution: string, locale: ViewerLocale): readonly string[] {
    const text = localizedCredit(attribution, locale);
    const known = WHOLE_CREDIT_KEYS.map((key) => translate(locale, key)).filter((credit) => text.includes(credit));
    const rest = known.reduce((out, credit) => out.replace(credit, CREDIT_SEPARATOR), text);
    // The separators the known credits leave behind go; the rest's own stay ("…; all rights reserved").
    const notices = rest
        .split(';')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '');
    return [...known, notices.join(CREDIT_SEPARATOR)];
}

/** The distinct credits of `attributions` in `locale`, each once, in their first order (blank parts dropped). */
export function creditParts(attributions: readonly string[], locale: ViewerLocale): readonly string[] {
    const parts = attributions.flatMap((attribution) => partsOf(attribution, locale));
    return [...new Set(parts.map((part) => part.trim()).filter((part) => part !== ''))];
}
