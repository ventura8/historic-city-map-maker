import { en as citiesEn } from '../admin-cities/en.js';
import { ro as citiesRo, type AdminCitiesKey } from '../admin-cities/ro.js';
import { en as exportEn } from '../admin-export/en.js';
import { ro as exportRo, type AdminExportKey } from '../admin-export/ro.js';
import { en as georefEn } from '../admin-georef/en.js';
import { ro as georefRo, type AdminGeorefKey } from '../admin-georef/ro.js';
import { en as imageryEn } from '../admin-imagery/en.js';
import { ro as imageryRo, type AdminImageryKey } from '../admin-imagery/ro.js';
import { en as layersEn } from '../admin-layers/en.js';
import { ro as layersRo, type AdminLayersKey } from '../admin-layers/ro.js';
import { en as notifyEn } from '../admin-notify/en.js';
import { ro as notifyRo, type AdminNotifyKey } from '../admin-notify/ro.js';
import { en as ordersEn } from '../admin-orders/en.js';
import { ro as ordersRo, type AdminOrdersKey } from '../admin-orders/ro.js';
import { en as opsEn } from '../admin-ops/en.js';
import { ro as opsRo, type AdminOpsKey } from '../admin-ops/ro.js';
import { en as photosEn } from '../admin-photos/en.js';
import { ro as photosRo, type AdminPhotosKey } from '../admin-photos/ro.js';
import { en as poisEn } from '../admin-pois/en.js';
import { ro as poisRo, type AdminPoisKey } from '../admin-pois/ro.js';
import { en as reviewEn } from '../admin-review/en.js';
import { ro as reviewRo, type AdminReviewKey } from '../admin-review/ro.js';
import { en as settingsEn } from '../admin-settings/en.js';
import { en as storiesEn } from '../admin-stories/en.js';
import { ro as storiesRo, type AdminStoriesKey } from '../admin-stories/ro.js';
import { ro as settingsRo, type AdminSettingsKey } from '../admin-settings/ro.js';
import { catalogueTranslator } from '../catalogue.js';
import { en as kitEn } from './en.js';
import { ro as kitRo, type AdminContentKitKey } from './ro.js';

/** Every text of the admin's editors: the kit's and the map's (this folder) and one catalogue folder per area (CR-M2c-25). */
export type AdminContentKey =
    | AdminContentKitKey
    | AdminPhotosKey
    | AdminPoisKey
    | AdminLayersKey
    | AdminSettingsKey
    | AdminOpsKey
    | AdminImageryKey
    | AdminGeorefKey
    | AdminOrdersKey
    | AdminNotifyKey
    | AdminCitiesKey
    | AdminExportKey
    | AdminReviewKey
    | AdminStoriesKey;

export type AdminContentMessages = Readonly<Record<AdminContentKey, string>>;

/**
 * The area catalogues merged per language, in the order of `docs/research/M2c-interfaces.md` §10.1, then M3's imagery
 * (`docs/research/M3-interfaces.md` §10), M4's notifications and assists (`docs/research/M4-interfaces.md` §4, §5) and
 * M5's cities and static export (`docs/research/M5-interfaces.md` §1.6, §1.8, §5.6). The areas' key prefixes are disjoint
 * (`packages/shared/test/i18n-admin.test.ts` checks every key against its folder's prefixes), so no spread overrides
 * another area's text.
 */
export const ADMIN_CONTENT_CATALOGUES: Readonly<Record<'ro' | 'en', AdminContentMessages>> = {
    ro: {
        ...kitRo,
        ...photosRo,
        ...poisRo,
        ...layersRo,
        ...settingsRo,
        ...opsRo,
        ...imageryRo,
        ...georefRo,
        ...ordersRo,
        ...notifyRo,
        ...citiesRo,
        ...exportRo,
        ...reviewRo,
        ...storiesRo,
    },
    en: {
        ...kitEn,
        ...photosEn,
        ...poisEn,
        ...layersEn,
        ...settingsEn,
        ...opsEn,
        ...imageryEn,
        ...georefEn,
        ...ordersEn,
        ...notifyEn,
        ...citiesEn,
        ...exportEn,
        ...reviewEn,
        ...storiesEn,
    },
};

/** The admin editors' texts (`docs/research/M2c-interfaces.md` §10.1). */
export const translateAdminContent = catalogueTranslator<AdminContentKey>(ADMIN_CONTENT_CATALOGUES);
