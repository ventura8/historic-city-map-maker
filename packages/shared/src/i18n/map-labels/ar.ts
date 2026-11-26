import type { MapLabelsKey } from './ro.js';

/** Arabic texts of the Layers panel's Map labels group. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error. */
export const ar: Readonly<Record<MapLabelsKey, string>> = {
    'mapLabels.group': 'تسميات الخريطة',
    'mapLabels.streets': 'أسماء الشوارع',
    'mapLabels.pois': 'نقاط الاهتمام',
    'mapLabels.note': 'نصوص على خريطة اليوم، مثل المتاجر والمطاعم.',
    'mapLabels.notePlaces': 'الأماكن أعلاه خاصة بهذا الموقع ولها مفاتيح تبديل خاصة بها.',
};
