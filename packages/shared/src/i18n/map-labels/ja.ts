import type { MapLabelsKey } from './ro.js';

/** Japanese texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const ja: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': '地図のラベル',
    'mapLabels.streets': '通りの名前',
    'mapLabels.pois': '主なスポット',
    'mapLabels.note': '現在の地図上の店舗やレストランなどの表示です。',
    'mapLabels.notePlaces': '上の「場所」はこのサイト独自のもので、それぞれ個別に切り替えられます。',
};
