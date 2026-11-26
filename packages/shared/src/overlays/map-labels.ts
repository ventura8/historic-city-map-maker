/**
 * The labels Mapbox Standard and Standard Satellite draw themselves, which the visitor may hide (docs/ENGINE_API.md → Map
 * labels). They are not overlays: they belong to the basemap, and the city's own places stay POI categories. Only these
 * two kinds are the visitor's choice; transit stations (`showTransitLabels`) are points of interest to a visitor and follow
 * that switch (`transitLabels`), and `showPlaceLabels` stays as the city's `basemap.config` sets it.
 */
import type { Basemap } from '../schemas/manifest.js';

export const MAP_LABEL_KINDS = ['streets', 'pois'] as const;

export type MapLabelKind = (typeof MAP_LABEL_KINDS)[number];

/** Which of the basemap's labels are drawn. */
export type MapLabels = Readonly<Record<MapLabelKind, boolean>>;

/** The basemap's configuration property of each kind (on its `basemap` import). */
export const MAP_LABEL_CONFIG: Readonly<Record<MapLabelKind, string>> = {
    streets: 'showRoadLabels',
    pois: 'showPointOfInterestLabels',
};

/** What the city's `basemap.config` asks for; a kind it does not set is drawn, as Standard does by default. */
export function basemapLabels(basemap: Pick<Basemap, 'config'>): MapLabels {
    return {
        streets: basemap.config?.[MAP_LABEL_CONFIG.streets] !== false,
        pois: basemap.config?.[MAP_LABEL_CONFIG.pois] !== false,
    };
}

/** Standard's transit stations (tram, metro, rail): a separate property, which the points of interest switch drives too. */
export const TRANSIT_LABELS = 'showTransitLabels';

/**
 * Whether transit stations are drawn with points of interest at `pois`: they follow it, except as the city's `basemap.config`
 * sets them: `false` hides them always, `true` shows them while the switch stays at the city's own default.
 */
export function transitLabels(config: Basemap['config'], pois: boolean): boolean {
    const set = config?.[TRANSIT_LABELS];
    return pois ? set !== false : set === true && config[MAP_LABEL_CONFIG.pois] === false;
}
