/**
 * Mapbox Standard draws 3D buildings, landmarks and trees above the `middle` slot, so today's city would stand on top
 * of 1960s imagery. While any historical layer is visible the adapter turns `show3dObjects` off on the `basemap`
 * import, and back to the style's own value afterwards. A style without that configuration (a custom style, the e2e
 * style) is left alone: the property is only written when reading it returned a boolean.
 */
import type { MapboxMap } from './mapbox-types.js';

const IMPORT_ID = 'basemap';
const PROPERTY = 'show3dObjects';

export class Basemap3dObjects {
    readonly #map: MapboxMap;
    /** The style's own value; null when the style has no such configuration. */
    readonly #original: boolean | null;
    #current: boolean | null;

    constructor(map: MapboxMap) {
        this.#map = map;
        this.#original = readProperty(map);
        this.#current = this.#original;
    }

    /** 3D objects off while a historical layer is visible, the style's value otherwise. */
    update(historicalLayerVisible: boolean): void {
        if (this.#original === null) {
            return;
        }
        const wanted = historicalLayerVisible ? false : this.#original;
        if (wanted !== this.#current) {
            this.#map.setConfigProperty(IMPORT_ID, PROPERTY, wanted);
            this.#current = wanted;
        }
    }
}

function readProperty(map: MapboxMap): boolean | null {
    try {
        const value = map.getConfigProperty(IMPORT_ID, PROPERTY);
        return typeof value === 'boolean' ? value : null;
    } catch {
        return null;
    }
}
