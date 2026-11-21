/**
 * The basemap's light follows the theme (behaviour V38, docs/research/viewer-input.md §4): Mapbox Standard's `lightPreset`,
 * `night` on a dark page and `day` on a light one, unless the city's `basemap.config` names it. What the basemap can do is
 * read from the mounted map, as for the labels: a style without the property is never written to. A write is a live change,
 * never a new map load.
 */
import type { ViewerMapPort } from '@hcm/ui/map';

import { LIGHT_PRESET } from './map-specs.js';
import type { ViewerState } from './state.js';

function isDark({ theme, systemDark }: Pick<ViewerState, 'theme' | 'systemDark'>): boolean {
    return theme === 'dark' || (theme === 'system' && systemDark);
}

export function mapLight(state: Pick<ViewerState, 'manifest' | 'theme' | 'systemDark'>): 'day' | 'night' | null {
    if (state.manifest?.city.basemap.config?.[LIGHT_PRESET] !== undefined) {
        return null;
    }
    return isDark(state) ? 'night' : 'day';
}

export function drawMapLight(map: ViewerMapPort, light: 'day' | 'night' | null): void {
    const current = map.getBasemapOption(LIGHT_PRESET);
    if (light !== null && current !== null && current !== light) {
        map.setBasemapOption(LIGHT_PRESET, light);
    }
}
