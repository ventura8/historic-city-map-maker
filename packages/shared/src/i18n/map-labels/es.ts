import type { MapLabelsKey } from './ro.js';

/** Spanish texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const es: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Etiquetas del mapa',
    'mapLabels.streets': 'Nombres de calles',
    'mapLabels.pois': 'Puntos de interés',
    'mapLabels.note': 'Textos del mapa actual, como tiendas y restaurantes.',
    'mapLabels.notePlaces': 'Los Lugares de arriba son propios de este sitio y tienen sus propios interruptores.',
};
