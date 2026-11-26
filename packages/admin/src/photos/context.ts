/**
 * What the photos area's parts share (`store.ts` builds it once): the services, the per-admin memory, the list, the
 * uploads, the state and its setter, the city's bounds and view, and the page's map. Each part (`editing.ts`,
 * `actions.ts`) reads and changes the area only through it.
 */
import type { BBox, MapView } from '@hcm/shared';

import type { PhotoList } from './list.js';
import type { PhotoMapSession } from './map.js';
import type { PhotosServices } from './ports.js';
import type { PhotoMemory } from './session.js';
import type { PhotosState } from './state.js';
import type { UploadQueue } from './upload-queue.js';

/** The city as the photos need it: where photos may stand and where the map opens. */
export interface CityPlace {
    readonly bounds: BBox;
    readonly view: MapView;
}

export interface AreaContext {
    readonly services: PhotosServices;
    readonly memory: PhotoMemory;
    readonly list: PhotoList;
    readonly uploads: UploadQueue;
    state(): PhotosState;
    set(patch: Partial<PhotosState>): void;
    city(): CityPlace | null;
    map(): PhotoMapSession | null;
    /** Draws the photos again (the list or a draft changed). */
    showMap(): void;
    /** M4 (CR-M4-4): the pin was set on the map (the assists suggest titles for an untitled photo). */
    placeSet(location: { readonly lat: number; readonly lng: number }): void;
    /** M4: the open photo changed (the assists forget the last one's suggestions and drafts). */
    photoChanged(): void;
}
