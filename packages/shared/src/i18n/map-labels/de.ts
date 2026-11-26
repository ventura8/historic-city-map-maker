import type { MapLabelsKey } from './ro.js';

/**
 * German texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or
 * extra key is a type error.
 */
export const de: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Kartenbeschriftungen',
    'mapLabels.streets': 'Straßennamen',
    'mapLabels.pois': 'Sehenswürdigkeiten',
    'mapLabels.note': 'Texte der heutigen Karte, etwa Geschäfte und Restaurants.',
    'mapLabels.notePlaces': 'Die Orte oben gehören zu dieser Website und haben eigene Schalter.',
};
