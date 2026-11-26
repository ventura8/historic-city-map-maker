import { hasCatalogue, uiText, type ViewerLocale } from '../index.js';
import { en } from './en.js';
import { ro, type MapLabelsKey } from './ro.js';

export { basemapLabels, MAP_LABEL_CONFIG, MAP_LABEL_KINDS, TRANSIT_LABELS, transitLabels } from '../../overlays/map-labels.js';
export type { MapLabelKind, MapLabels } from '../../overlays/map-labels.js';
export type { MapLabelsKey } from './ro.js';

const LABELS: Partial<Record<ViewerLocale, Readonly<Record<MapLabelsKey, string>>>> = { ro, en };

/**
 * `@hcm/shared/map-labels`: the basemap's labels and the panel's words for them, for the viewer only (docs/ENGINE_API.md →
 * Map labels). Romanian and English are imported (the engine's build empties both); a fetched catalogue holds the family
 * too (`i18n/<locale>.json`). A language not here yet gives an empty text; a key its file lacks shows in English.
 */
export function translateMapLabels(locale: ViewerLocale, key: MapLabelsKey): string {
    // An array's join reads a missing text as empty.
    return hasCatalogue(locale) ? [uiText(locale, key, LABELS)].join('') : '';
}
