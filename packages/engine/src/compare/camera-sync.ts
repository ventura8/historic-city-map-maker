/**
 * Swipe compare's camera sync (M4, docs/research/M4-interfaces.md §3.4, `S-V06-HAPPY-CAMERA-SYNC`): each map's `move`
 * puts the other on the same centre, zoom, bearing and tilt at once (`flyTo` without animation, which Mapbox applies in the
 * same frame), under a re-entrancy guard: the `move` the sync itself causes is not synced back, so there is no loop.
 */
import type { MapView } from '@hcm/shared';
import type { Unsubscribe, ViewerMapPort } from '@hcm/ui/map';

/** Links the cameras of `main` and `second` (the second starts on the main's view); the result unlinks them. */
export function linkCameras(main: ViewerMapPort, second: ViewerMapPort): Unsubscribe {
    let syncing = false;
    const follow =
        (target: ViewerMapPort, source: ViewerMapPort) =>
        (view: MapView): void => {
            if (syncing) {
                return;
            }
            syncing = true;
            try {
                target.flyTo(view, { animate: false, pitch: source.getPitch() });
            } finally {
                syncing = false;
            }
        };
    const unsubscribe = [main.on('move', follow(second, main)), second.on('move', follow(main, second))];
    follow(second, main)(main.getView());
    return () => {
        for (const stop of unsubscribe) {
            stop();
        }
    };
}
