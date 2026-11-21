/**
 * The layer editor's text fields as typed (`docs/research/M2c-interfaces.md` §8.2): the name and description in both
 * languages (Romanian required, English optional: an empty English text is removed), the attribution (an empty one is
 * removed), the rights' licence (one of `LAYER_LICENSES`, empty: no rights; the attribution's own licence part follows it, so
 * the public map's credit line changes with it on the next Update the map) and author (only with a licence; empty: removed),
 * the year (a whole number; anything else is the schema's issue at the field) and the exact date (ISO, empty: removed).
 * Each becomes the patch of its document field; the field names are also the issue paths the page shows.
 */
import { LAYER_LICENSES, type LayerDoc } from '@hcm/shared';

import { withOptionalText, withText } from '../settings/localized.js';

/** The editor's text fields; each is also the path of the issue the page shows at it. */
export type LayerTextField =
    'label.ro' | 'label.en' | 'description.ro' | 'description.en' | 'attribution' | 'rights.licence' | 'rights.author' | 'year' | 'date';

export type LayerFieldPatch = Partial<Pick<LayerDoc, 'label' | 'description' | 'attribution' | 'rights' | 'year' | 'date'>>;

type Licence = NonNullable<LayerDoc['rights']>['licence'];

/** The credit line's parts are joined by " · " (`creditLine`): the part that names the old licence names the new one. */
const PART = ' · ';

function licenceOf(text: string): Licence | undefined {
    return LAYER_LICENSES.find((licence) => licence === text);
}

/** The attribution with its old licence part swapped for the new one; unchanged when no part names the old licence. */
function swappedCredit(attribution: string | undefined, from: Licence | undefined, to: Licence | undefined): string | undefined {
    if (attribution === undefined || from === undefined) {
        return attribution;
    }
    const parts = attribution.split(PART);
    const replacement = to === undefined ? [] : [to];
    const kept = parts.flatMap((part) => (part === from ? replacement : [part]));
    return kept.join(PART);
}

/** A licence chosen (empty: the layer carries no rights): the rights and the attribution's licence part follow it. */
function licencePatch(layer: LayerDoc, text: string): LayerFieldPatch {
    const licence = licenceOf(text);
    const rights = licence === undefined ? undefined : { ...layer.rights, licence };
    return { rights, attribution: swappedCredit(layer.attribution, layer.rights?.licence, licence) };
}

/** The author as typed; an empty one is removed. Without a licence there are no rights to carry it. */
function authorPatch(layer: LayerDoc, text: string): LayerFieldPatch {
    if (layer.rights === undefined) {
        return {};
    }
    const author = optional(text);
    const { licence, source } = layer.rights;
    return { rights: { licence, ...(author === undefined ? {} : { author }), ...(source === undefined ? {} : { source }) } };
}

/** Text that is empty once trimmed is no value. */
function optional(text: string): string | undefined {
    const trimmed = text.trim();
    return trimmed === '' ? undefined : trimmed;
}

/** A year as typed: four digits at most, else NaN (the schema names the field). */
function yearOf(text: string): number {
    return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

const PATCHES: Readonly<Record<LayerTextField, (layer: LayerDoc, text: string) => LayerFieldPatch>> = {
    'label.ro': (layer, text) => ({ label: withText(layer.label, 'ro', text) }),
    'label.en': (layer, text) => ({ label: withText(layer.label, 'en', text) }),
    'description.ro': (layer, text) => ({ description: withOptionalText(layer.description, 'ro', text) }),
    'description.en': (layer, text) => ({ description: withOptionalText(layer.description, 'en', text) }),
    attribution: (_layer, text) => ({ attribution: optional(text) }),
    'rights.licence': licencePatch,
    'rights.author': authorPatch,
    year: (_layer, text) => ({ year: yearOf(text) }),
    date: (_layer, text) => ({ date: optional(text) }),
};

/** The patch a typed `text` makes of `field`. */
export function layerFieldPatch(layer: LayerDoc, field: LayerTextField, text: string): LayerFieldPatch {
    return PATCHES[field](layer, text);
}
