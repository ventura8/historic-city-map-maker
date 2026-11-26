/**
 * The `assist.*` functions (`docs/research/M4-interfaces.md` §4): the editors' title suggestions (`suggestTitle`, and
 * the `assist-geocode` queue's worker `geocode`, the only caller of Nominatim) and translation drafts
 * (`translateDraft`, Vertex AI Gemini). `functions/src/index.ts` exports `assist = assistFunctions(getDeps)`, which
 * deploys `assist-suggestTitle`, `assist-translateDraft` and `assist-geocode`.
 */
import { geocodeFunction, type GeocodeDeps } from './geocode.js';
import { suggestTitleFunction, type SuggestTitleDeps } from './suggest-title.js';
import { translateDraftFunction, type TranslateDraftDeps } from './translate-draft.js';

/** Every port the family uses (the union of its functions' own). */
export type AssistFamilyDeps = SuggestTitleDeps & TranslateDraftDeps & GeocodeDeps;

export function assistFunctions(getDeps: () => AssistFamilyDeps) {
    return {
        suggestTitle: suggestTitleFunction(getDeps),
        translateDraft: translateDraftFunction(getDeps),
        geocode: geocodeFunction(getDeps),
    };
}
