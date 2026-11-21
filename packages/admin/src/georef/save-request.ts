/**
 * What Save sends (`imagery.saveGcps`, `docs/research/M3-interfaces.md` §6): the version's pairs, transform and crop, only when the
 * version takes points, nothing is being saved and the fit is possible.
 */
import type { ImageryRequest } from '../imagery/api.js';
import { pairsToSave } from './pairs.js';
import type { GeorefState, GeorefVersion } from './state.js';

function cropOf(version: GeorefVersion): { readonly crop?: NonNullable<GeorefVersion['crop']> } {
    return version.crop === null ? {} : { crop: version.crop };
}

/** What Save sends, when the version takes points, nothing is being saved and the fit is possible; else null. */
export function saveRequestOf(cityId: string, state: GeorefState): ImageryRequest<'imagery.saveGcps'> | null {
    const { version, pairs, transform, saving, fit } = state;
    if (version === null || !version.editable || saving || fit.refusal !== null) {
        return null;
    }
    return { cityId, versionId: version.id, transform, gcps: pairsToSave(pairs), ...cropOf(version) };
}
