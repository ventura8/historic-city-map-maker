/**
 * The georeferencer's linked views (`docs/research/M3-interfaces.md` §10.4): once the pairs give a fit, panning or zooming one pane
 * moves the other to show the same place. The scan's centre goes to the map through the fit, `toGeo`, the map's back through its
 * inverse (`toPixel`); the zoom follows the fit's local scale there (the Web Mercator metres one scan pixel spans). Part of the
 * lazy chunk (`georef-extras.ts`), so the `georef` chunk keeps its budget.
 *
 * `ViewLink` keeps the latest move and applies it once per animation frame; the move it makes itself is not sent back (the map's
 * `move` comes while it applies), a map `move` that leaves its camera where it was (Mapbox's on a resize, as when a compact window
 * shows the map) moves nothing, and nothing moves while linking is off, there is no fit or the owner drags a point.
 */
import { geoToMercator, WEB_MERCATOR_RADIUS_M, type FittedTransform, type LngLat, type PixelPoint } from '@hcm/shared';

/** What the scan pane shows: the full-resolution scan pixel at its centre and its CSS pixels per scan pixel. */
export interface ScanCamera {
    readonly centre: PixelPoint;
    readonly scale: number;
    /** How far the scan is turned in its pane, radians clockwise (absent: as it is). */
    readonly angle?: number;
}

/** What the map shows: its centre and its zoom. */
export interface MapCamera {
    readonly center: LngLat;
    readonly zoom: number;
    /** The map's bearing in degrees (absent: as it is). */
    readonly bearing?: number;
}

/** Mapbox's world at zoom 0 is one 512-pixel tile; its width in Web Mercator metres. */
const TILE_PX = 512;
const WORLD_M = 2 * Math.PI * WEB_MERCATOR_RADIUS_M;

/** The Web Mercator metres one scan pixel spans around `pixel`: the square root of the fit's local area there. */
export function metresPerPixel(transform: FittedTransform, pixel: PixelPoint): number {
    const at = geoToMercator(transform.toGeo(pixel));
    const right = geoToMercator(transform.toGeo({ x: pixel.x + 1, y: pixel.y }));
    const down = geoToMercator(transform.toGeo({ x: pixel.x, y: pixel.y + 1 }));
    return Math.sqrt(Math.abs((right.x - at.x) * (down.y - at.y) - (right.y - at.y) * (down.x - at.x)));
}

function finite(values: readonly number[]): boolean {
    return values.every((value) => Number.isFinite(value));
}

/** The map that shows what the scan pane shows; null where the fit gives no place (far outside its pairs). */
export function scanToMap(transform: FittedTransform, camera: ScanCamera): MapCamera | null {
    const geo = transform.toGeo(camera.centre);
    const zoom = Math.log2((WORLD_M * camera.scale) / (TILE_PX * metresPerPixel(transform, camera.centre)));
    return finite([geo.lng, geo.lat, zoom]) ? { center: [geo.lng, geo.lat], zoom } : null;
}

/** The scan pane that shows what the map shows; null where the inverse fit gives no pixel. */
export function mapToScan(transform: FittedTransform, camera: MapCamera): ScanCamera | null {
    const centre = transform.toPixel({ lng: camera.center[0], lat: camera.center[1] });
    const scale = (metresPerPixel(transform, centre) * TILE_PX * 2 ** camera.zoom) / WORLD_M;
    return finite([centre.x, centre.y, scale]) && scale > 0 ? { centre, scale } : null;
}

function sameCamera(a: MapCamera, b: MapCamera): boolean {
    return a.zoom === b.zoom && a.bearing === b.bearing && a.center[0] === b.center[0] && a.center[1] === b.center[1];
}

export interface LinkPorts {
    /** The fit now; null: none. */
    transform(): FittedTransform | null;
    /** Linking is on and no point is being dragged. */
    active(): boolean;
    moveMap(camera: MapCamera): void;
    moveScan(camera: ScanCamera): void;
    /** Runs `run` at the next animation frame. */
    frame(run: () => void): void;
}

type Pending = { readonly from: 'scan'; readonly camera: ScanCamera } | { readonly from: 'map'; readonly camera: MapCamera };

export class ViewLink {
    readonly #ports: LinkPorts;
    #pending: Pending | null = null;
    /** True while a move is applied: the other pane's own `move` it causes is no move of the owner's. */
    #applying = false;
    /** The map's camera at its last `move` or `seen` (null: none seen yet, the first `move` only sets it). */
    #lastMap: MapCamera | null = null;

    constructor(ports: LinkPorts) {
        this.#ports = ports;
    }

    /** The map's camera before any move of the owner's (as it showed, or the last seen while this chunk loaded): no move itself. */
    seen(camera: MapCamera): void {
        this.#lastMap = camera;
    }

    /** The owner panned or zoomed the scan. */
    scan(camera: ScanCamera): void {
        this.#queue({ from: 'scan', camera });
    }

    /** The map moved (the owner's move, or the echo of one this link made, which is dropped). */
    map(camera: MapCamera): void {
        const last = this.#lastMap;
        this.#lastMap = camera;
        if (last !== null && !sameCamera(last, camera)) {
            this.#queue({ from: 'map', camera });
        }
    }

    #queue(next: Pending): void {
        if (this.#applying) {
            return;
        }
        const waiting = this.#pending !== null;
        this.#pending = next;
        if (!waiting) {
            this.#ports.frame(() => {
                this.#flush();
            });
        }
    }

    #flush(): void {
        const pending = this.#pending;
        this.#pending = null;
        const transform = this.#ports.transform();
        if (pending === null || transform === null || !this.#ports.active()) {
            return;
        }
        this.#applying = true;
        try {
            this.#apply(transform, pending);
        } finally {
            this.#applying = false;
        }
    }

    #apply(transform: FittedTransform, pending: Pending): void {
        if (pending.from === 'scan') {
            const camera = scanToMap(transform, pending.camera);
            if (camera !== null) {
                this.#ports.moveMap(camera);
            }
            return;
        }
        const camera = mapToScan(transform, pending.camera);
        if (camera !== null) {
            this.#ports.moveScan(camera);
        }
    }
}
