/**
 * What the public viewer's map can do beyond `MapPort`: read and write the basemap's own boolean configuration, for the
 * visitor's map labels (docs/ENGINE_API.md → Map labels), and draw the visitor's blue dot and Locate's ring around a photo.
 * Apart from the adapter because only the viewer uses it, so the admin's bundle does not carry it.
 */
import type { LngLat } from '@hcm/shared';

import type { AdapterEnv } from './env.js';
import type { MapPort } from './map-port.js';
import { createMapboxPort, nativeMap } from './mapbox-adapter.js';
import type { MapboxGl, MapboxMap } from './mapbox-types.js';
import { drawMyLocation, drawPhotoMark, type MyLocationFix } from './my-location.js';

const IMPORT_ID = 'basemap';

export interface ViewerMapPort extends MapPort {
    /**
     * A boolean Standard configuration property of the `basemap` import (`showRoadLabels`, ...); null when the style has no
     * such property (a custom style, the base without the import) or there is no map. Ask once `mount` has resolved.
     */
    getBasemapFlag(name: string): boolean | null;
    /** Sets one live, with no new map load. Write only what `getBasemapFlag` found. */
    setBasemapFlag(name: string, value: boolean): void;
    /** A text Standard configuration property (`lightPreset`, ...); null when the style has no such property. */
    getBasemapOption(name: string): string | null;
    /** Sets one live, with no new map load. Write only what `getBasemapOption` found. */
    setBasemapOption(name: string, value: string): void;
    /** The visitor's position as a blue dot (`my-location.ts`), null removes it; nothing before `mount` has resolved. */
    setMyLocation(fix: MyLocationFix | null): void;
    /** A ring around a photo's place (the photo sheet's Locate), null takes it away; nothing before `mount` has resolved. */
    markPhoto(center: LngLat | null): void;
    /** The camera's tilt in degrees (0 before `mount` has resolved): the compass draws it, swipe compare's second map follows it. */
    getPitch(): number;
}

/** Mapbox answers null, or throws, for a style without the import or the property. */
function readConfig(map: MapboxMap | null, name: string): unknown {
    try {
        return map?.getConfigProperty(IMPORT_ID, name);
    } catch {
        return null;
    }
}

function readFlag(map: MapboxMap | null, name: string): boolean | null {
    const value = readConfig(map, name);
    return typeof value === 'boolean' ? value : null;
}

function readOption(map: MapboxMap | null, name: string): string | null {
    const value = readConfig(map, name);
    return typeof value === 'string' ? value : null;
}

/** `createMapboxPort` for the viewer and swipe compare's second map (`gl` may be on its way). */
export function createViewerMapPort(gl: MapboxGl | Promise<MapboxGl>, env?: AdapterEnv): ViewerMapPort {
    const port = createMapboxPort(gl, env);
    const write = (name: string, value: boolean | string): void => {
        nativeMap(port)?.setConfigProperty(IMPORT_ID, name, value);
    };
    const onMap =
        <T>(draw: (map: MapboxMap, value: T) => void) =>
        (value: T): void => {
            const map = nativeMap(port);
            if (map !== null) {
                draw(map, value);
            }
        };
    return Object.assign(port, {
        getBasemapFlag: (name: string) => readFlag(nativeMap(port), name),
        setBasemapFlag: write,
        getBasemapOption: (name: string) => readOption(nativeMap(port), name),
        setBasemapOption: write,
        setMyLocation: onMap(drawMyLocation),
        markPhoto: onMap(drawPhotoMark),
        getPitch: () => nativeMap(port)?.getPitch() ?? 0,
    });
}
