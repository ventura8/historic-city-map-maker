import type { MapLabelsKey } from './ro.js';

/** Russian texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const ru: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'Подписи на карте',
    'mapLabels.streets': 'Названия улиц',
    'mapLabels.pois': 'Точки интереса',
    'mapLabels.note': 'Надписи на современной карте, например магазины и рестораны.',
    'mapLabels.notePlaces': 'Места выше принадлежат этому сайту и включаются отдельно.',
};
