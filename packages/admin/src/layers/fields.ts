/**
 * The layer editor's text fields as typed (`docs/research/M2c-interfaces.md` §8.2): the name and description in both
 * languages (Romanian required, English optional: an empty English text is removed), the attribution (an empty one is
 * removed), the year (a whole number; anything else is the schema's issue at the field) and the exact date (ISO, empty:
 * removed). Each becomes the patch of its document field; the field names are also the issue paths the page shows.
 */
import type { LayerDoc } from '@hcm/shared';

import { withOptionalText, withText } from '../settings/localized.js';

/** The editor's text fields; each is also the path of the issue the page shows at it. */
export type LayerTextField = 'label.ro' | 'label.en' | 'description.ro' | 'description.en' | 'attribution' | 'year' | 'date';

export type LayerFieldPatch = Partial<Pick<LayerDoc, 'label' | 'description' | 'attribution' | 'year' | 'date'>>;

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
    year: (_layer, text) => ({ year: yearOf(text) }),
    date: (_layer, text) => ({ date: optional(text) }),
};

/** The patch a typed `text` makes of `field`. */
export function layerFieldPatch(layer: LayerDoc, field: LayerTextField, text: string): LayerFieldPatch {
    return PATCHES[field](layer, text);
}
