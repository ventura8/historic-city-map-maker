/**
 * The shot direction a layer's USGS scene suggests (V93, the owner 2026-11-23): the scene's metadata lists the frame's four
 * corners when M2M has them (`usgsScenes/{entityId}.corners`), and the frame's top edge (south-west to north-west) points
 * the way the image's top looks. The editor offers it as Use the USGS direction; a layer with no scene, a scene with no
 * corners or a failed read offers none. One read per opened layer.
 */
import { FIRESTORE_PATHS, usgsSceneDocSchema, type LayerDoc, type UsgsSceneDoc } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { Unsubscribe } from '../app/ports.js';

type Corners = NonNullable<UsgsSceneDoc['corners']>;

/** The bearing from the south-west corner to the north-west one, in whole degrees `[0, 360)` (flat earth: a frame is small). */
export function cornersBearing({ sw, nw }: Corners): number {
    const east = (nw.lng - sw.lng) * Math.cos((((sw.lat + nw.lat) / 2) * Math.PI) / 180);
    const north = nw.lat - sw.lat;
    const degrees = (Math.atan2(east, north) * 180) / Math.PI;
    return ((Math.round(degrees) % 360) + 360) % 360;
}

export class ShotSuggestion {
    readonly #services: Pick<ContentServices, 'store' | 'cityId'>;
    readonly #found: (id: string, bearing: number) => void;
    #stop: Unsubscribe = () => undefined;
    #id = '';

    constructor(services: Pick<ContentServices, 'store' | 'cityId'>, found: (id: string, bearing: number) => void) {
        this.#services = services;
        this.#found = found;
    }

    /** Reads the scene of layer `id` once (a satellite or aerial image from USGS); a second call for the same id does nothing. */
    load(id: string, layer: Pick<LayerDoc, 'kind' | 'provenance'>): void {
        const entityId = layer.provenance?.usgsEntityId;
        if (id === this.#id || entityId === undefined || layer.kind === 'map') {
            return;
        }
        this.stop();
        this.#id = id;
        this.#read(id, entityId);
    }

    #read(id: string, entityId: string): void {
        const read = { done: false };
        const finish = (): void => {
            read.done = true;
            this.#stop();
            this.#stop = () => undefined;
        };
        const unsubscribe = this.#services.store.watchDoc(
            FIRESTORE_PATHS.usgsScene(this.#services.cityId, entityId),
            usgsSceneDocSchema,
            (scene) => {
                finish();
                if (scene?.data.corners !== undefined) {
                    this.#found(id, cornersBearing(scene.data.corners));
                }
            },
            finish,
        );
        // A store that answers at once has already finished: stop its listener now.
        if (read.done) {
            unsubscribe();
            return;
        }
        this.#stop = unsubscribe;
    }

    stop(): void {
        this.#stop();
        this.#stop = () => undefined;
        this.#id = '';
    }
}
