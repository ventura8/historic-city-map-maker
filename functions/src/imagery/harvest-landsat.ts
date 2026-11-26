/**
 * M25 (`docs/research/M25-landsat.md` §1): what a Landsat dataset's search adds to the declassified one's. Only the months from May to
 * September (`seasonalFilter`: leaf-on summer and its edges), only scenes at most `LANDSAT_SEARCH_MAX_CLOUD` percent cloudy, and for
 * Landsat 7 nothing from the day its scan line corrector failed (`ETM_SLC_OFF_DATE`: every later scene has wedge-shaped gaps).
 * A declassified dataset's search is unchanged.
 */
import { ETM_SLC_OFF_DATE, LANDSAT_MONTHS, LANDSAT_SEARCH_MAX_CLOUD, isLandsatDataset, type UsgsDataset } from '@hcm/shared';

import type { SearchWindow } from './harvest-target.js';

/** The last day of ETM+ scenes worth having (the day before the failure). */
const ETM_LAST_DAY = new Date(Date.parse(`${ETM_SLC_OFF_DATE}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export interface LandsatSearch extends SearchWindow {
    readonly months?: readonly number[];
    readonly maxCloud?: number;
}

/** The window as `dataset` searches it: Landsat 7's ends before the failure. */
function windowFor(dataset: UsgsDataset, window: SearchWindow): SearchWindow {
    if (dataset !== 'landsat_etm_c2_l1') {
        return window;
    }
    const to = window.to === undefined || window.to > ETM_LAST_DAY ? ETM_LAST_DAY : window.to;
    return { ...window, to };
}

/** The search of `dataset` within `window`: a Landsat dataset's months, cloud cap and (ETM+) end; a declassified one's as it is. */
export function searchOf(dataset: UsgsDataset, window: SearchWindow): LandsatSearch {
    if (!isLandsatDataset(dataset)) {
        return window;
    }
    return { ...windowFor(dataset, window), months: LANDSAT_MONTHS, maxCloud: LANDSAT_SEARCH_MAX_CLOUD };
}
