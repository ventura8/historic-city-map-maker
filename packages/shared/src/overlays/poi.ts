/**
 * What the viewer and the admin map need to draw POIs (PLAN Addendum 3): which POIs the timeline shows and which
 * icon a category gets. Pure; the map layers themselves are built by the engine's Mapbox adapter.
 */
import { DEFAULT_POI_ICON, POI_ICONS, type Poi, type PoiIcon } from '../schemas/poi.js';

function isBundled(name: string): name is PoiIcon {
    return (POI_ICONS as readonly string[]).includes(name);
}

/**
 * True when the timeline shows `poi` at `year`: its span covers the year, an absent bound being open. At "today"
 * (`null`, no historical layer) every POI is shown, the vanished ones included: showing them is the map's point.
 */
export function poiInYear(poi: Pick<Poi, 'yearStart' | 'yearEnd'>, year: number | null): boolean {
    return year === null || ((poi.yearStart ?? year) <= year && year <= (poi.yearEnd ?? year));
}

/** The bundled icon for a category's icon name: itself when the engine ships it, else `DEFAULT_POI_ICON`. */
export function poiIcon(name: string): PoiIcon {
    return isBundled(name) ? name : DEFAULT_POI_ICON;
}
