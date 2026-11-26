/**
 * Lon/lat ↔ screen CSS px for the admin's map (georeferencer badges and arrow-key nudges). Kept out of `MapPort` /
 * `createMapboxPort` so the public engine never ships the methods (bundle budget; same split as `ViewerMapPort`).
 */
import type { LngLat } from '@hcm/shared';
import { nativeMap, type MapPort } from '@hcm/ui/map';

interface MapScreenPoint {
    readonly x: number;
    readonly y: number;
}

export interface ProjectableMapPort extends MapPort {
    project(position: LngLat): MapScreenPoint | null;
    unproject(point: MapScreenPoint): LngLat | null;
}

/** Adds `project` / `unproject` on a Mapbox port (or leaves a fake that already has them). */
export function withMapProjection(port: MapPort): ProjectableMapPort {
    const existing = port as ProjectableMapPort;
    if (typeof existing.project === 'function' && typeof existing.unproject === 'function') {
        return existing;
    }
    return Object.assign(port, {
        project(position: LngLat): MapScreenPoint | null {
            const map = nativeMap(port);
            if (map === null) {
                return null;
            }
            const at = map.project({ lng: position[0], lat: position[1] });
            return { x: at.x, y: at.y };
        },
        unproject(point: MapScreenPoint): LngLat | null {
            const map = nativeMap(port);
            if (map === null) {
                return null;
            }
            const at = map.unproject(point);
            return [at.lng, at.lat];
        },
    });
}
