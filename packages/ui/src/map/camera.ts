/**
 * Moving the camera of a Mapbox map for `MapPort.flyTo` and `fitBounds`: a caller's `animate` decides; without one the move
 * animates unless the visitor preferred reduced motion when the map was mounted (then it jumps). An explicit `animate: true`
 * is `essential` to Mapbox, which otherwise reads the preference on every call and turns a flight into a `jumpTo` that drops
 * the offset. An offset puts the target that many pixels from the map's centre (the viewer's Show on map keeps a photo's
 * place clear of the sheet); `jumpTo` has none, so that jump is an `easeTo` of no duration.
 */
import type { BBox, MapView } from '@hcm/shared';

import type { FlyOptions } from './map-port.js';
import type { CameraOffset, MapboxCameraOptions, MapboxMap } from './mapbox-types.js';

/** Whether a camera move animates: the caller's word, else the mount's reduced-motion preference. */
export function animates(options: { readonly animate?: boolean } | undefined, reducedMotion: boolean): boolean {
    return options?.animate ?? !reducedMotion;
}

/** How `moveCamera` moves: `essential` when the caller chose to animate (Mapbox then does not jump by itself). */
export interface CameraMove {
    readonly animate: boolean;
    readonly essential: boolean;
    readonly offset: CameraOffset | undefined;
    /** The tilt at the end (the viewer's compass levels the map); undefined keeps it. */
    readonly pitch?: number | undefined;
}

/** `MapPort.flyTo`'s options as a `CameraMove`, the mount's reduced-motion preference deciding when they do not. */
export function cameraMove(options: FlyOptions | undefined, reducedMotion: boolean): CameraMove {
    const { animate, offset, pitch } = options ?? {};
    return { animate: animates(options, reducedMotion), essential: animate === true, offset, pitch };
}

/** Where `moveCamera` takes the camera: a view, and the tilt when the caller sets it (the viewer's compass). */
export type CameraTarget = Partial<MapView> & { readonly pitch?: number };

/** The view with the tilt the caller set (unset keeps the camera's). */
function withPitch(view: CameraTarget, pitch: number | undefined): MapboxCameraOptions {
    return pitch === undefined ? view : { ...view, pitch };
}

export function moveCamera(map: MapboxMap, view: CameraTarget, { animate, essential, offset, pitch }: CameraMove): void {
    const target = withPitch(view, pitch);
    const camera: MapboxCameraOptions = offset === undefined ? target : { ...target, offset };
    if (animate) {
        map.flyTo(essential ? { ...camera, essential } : camera);
    } else if (offset === undefined) {
        map.jumpTo(camera);
    } else {
        map.easeTo({ ...camera, duration: 0 });
    }
}

export function fitCamera(map: MapboxMap, bounds: BBox, padding: number, animate: boolean): void {
    map.fitBounds([bounds[0], bounds[1]], { padding, animate });
}
