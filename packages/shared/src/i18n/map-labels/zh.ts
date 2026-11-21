import type { MapLabelsKey } from './ro.js';

/** Simplified Chinese texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const zh: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': '地图标注',
    'mapLabels.streets': '街道名称',
    'mapLabels.pois': '兴趣点',
    'mapLabels.note': '当今地图上的文字，例如商店和餐馆。',
    'mapLabels.notePlaces': '上方的地点是本网站自己的，有各自的开关。',
};
