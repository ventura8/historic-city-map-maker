import type { MapLabelsKey } from './ro.js';

/**
 * Korean texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or
 * extra key is a type error.
 */
export const ko: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': '지도 라벨',
    'mapLabels.streets': '거리 이름',
    'mapLabels.pois': '관심 지점',
    'mapLabels.note': '상점, 식당 등 현재 지도에 표시되는 텍스트입니다.',
    'mapLabels.notePlaces': '위의 장소는 이 사이트에서 직접 만든 것으로, 별도의 스위치가 있습니다.',
};
