/** Fakes of what the admin's map takes from the page: animation frames and the rest of the Mapbox adapter's browser parts. */
import type { AdapterEnv, FrameScheduler } from '@hcm/ui/map';

export interface FakeFrames extends FrameScheduler {
    readonly pending: number;
    /** Runs every requested frame callback once. */
    run(): void;
}

export function fakeFrames(): FakeFrames {
    const callbacks = new Map<number, () => void>();
    let next = 1;
    return {
        request: (callback) => {
            const handle = next;
            next += 1;
            callbacks.set(handle, callback);
            return handle;
        },
        cancel: (handle) => {
            callbacks.delete(handle);
        },
        get pending() {
            return callbacks.size;
        },
        run: () => {
            const due = [...callbacks.values()];
            callbacks.clear();
            for (const callback of due) {
                callback();
            }
        },
    };
}

/** The adapter's browser parts: frames to run by hand, no resize observer, no sprite canvas, WebGL 2 as given. */
export function fakeEnv(frames: FakeFrames = fakeFrames(), webgl = true): AdapterEnv {
    return {
        frames,
        observeResize: () => () => undefined,
        icons: {
            createCanvas: () => ({ getContext: () => null }),
            createPath: () => ({}) as Path2D,
            loadFont: () => Promise.resolve(true),
        },
        probeWebGL: () => webgl,
    };
}
