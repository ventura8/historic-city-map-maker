import type { MapLabelsKey } from './ro.js';

/**
 * Ukrainian texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`):
 * a missing or extra key is a type error.
 */
export const uk: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Підписи мапи',
    'mapLabels.streets': 'Назви вулиць',
    'mapLabels.pois': 'Цікаві місця',
    'mapLabels.note': 'Текст на сучасній мапі, як-от магазини й ресторани.',
    'mapLabels.notePlaces': 'Місця вище належать цьому сайту й мають власні перемикачі.',
};
