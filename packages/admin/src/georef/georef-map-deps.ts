import type { Logger, MapView, UiLocale } from '@hcm/shared';

import type { MapStatus } from '../layers/map-session.js';
import type { AdminMapFactory } from '../map/factory.js';
import type { GeoPosition } from './pairs.js';

export interface GeorefMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => UiLocale;
    readonly log: Logger;
    readonly status: (status: MapStatus) => void;
    /** A click on the map (the place of the next pair while adding). */
    readonly clicked: (geo: GeoPosition) => void;
    /** A pair's place was dragged (once the drag ends). */
    readonly moved: (id: string, geo: GeoPosition) => void;
    /** A pair's point was selected on the map (null: none). */
    readonly selected: (id: string | null) => void;
    /** The map's camera moved (the linked views). */
    readonly viewed: (view: MapView) => void;
    /** The map is made and shows `view` (the linked views' camera before the owner's first move). */
    readonly shown: (view: MapView) => void;
}
