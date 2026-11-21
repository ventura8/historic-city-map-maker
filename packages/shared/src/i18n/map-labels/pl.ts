import type { MapLabelsKey } from './ro.js';

/** Polish texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const pl: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Etykiety mapy',
    'mapLabels.streets': 'Nazwy ulic',
    'mapLabels.pois': 'Ciekawe miejsca',
    'mapLabels.note': 'Napisy na dzisiejszej mapie, np. sklepy i restauracje.',
    'mapLabels.notePlaces': 'Miejsca powyżej należą do tej witryny i mają własne przełączniki.',
};
