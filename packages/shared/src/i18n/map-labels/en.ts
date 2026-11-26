import type { MapLabelsKey } from './ro.js';

/** English texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const en: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Map labels',
    'mapLabels.streets': 'Streets',
    'mapLabels.pois': 'POIs',
    'mapLabels.note': "Today's map labels (shops, restaurants).",
    'mapLabels.notePlaces': "Places below are this site's, with their own switches.",
};
