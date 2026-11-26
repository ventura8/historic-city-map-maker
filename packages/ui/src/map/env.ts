/**
 * What the Mapbox adapter needs from the browser besides `mapboxgl`: animation frames (opacity coalescing), a
 * ResizeObserver on the map's container (Mapbox itself only follows window resizes, an embedded map must follow its
 * box; the adapter resizes the map in the callback itself, which runs at most once a frame), a canvas for the sprite images, and a WebGL 2 probe for builds where `mapboxgl.supported` is missing.
 * The node tests pass fakes; `browserAdapterEnv(window)` is the real thing.
 */
import { canvasIconEnv, type IconEnv, type IconScope } from './icons.js';
import type { FrameScheduler } from './overlay-registry.js';

export interface AdapterEnv {
    readonly frames: FrameScheduler;
    /** Calls `onResize` whenever `element` changes size; returns the function that stops observing. */
    readonly observeResize: (element: HTMLElement, onResize: () => void) => () => void;
    readonly icons: IconEnv;
    /** True when a WebGL 2 context can be created (Mapbox GL JS 3 needs WebGL 2). */
    readonly probeWebGL: () => boolean;
}

/** The parts of `window` the adapter uses. */
export interface BrowserScope extends IconScope {
    requestAnimationFrame(callback: () => void): number;
    cancelAnimationFrame(handle: number): void;
    readonly ResizeObserver?: new (callback: () => void) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
}

function probeWebGL(scope: BrowserScope): boolean {
    try {
        return scope.document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
        return false;
    }
}

export function browserAdapterEnv(scope: BrowserScope): AdapterEnv {
    return {
        frames: {
            request: (callback) => scope.requestAnimationFrame(callback),
            cancel: (handle) => {
                scope.cancelAnimationFrame(handle);
            },
        },
        observeResize: (element, onResize) => {
            if (scope.ResizeObserver === undefined) {
                return () => undefined;
            }
            const observer = new scope.ResizeObserver(onResize);
            observer.observe(element);
            return () => {
                observer.disconnect();
            };
        },
        icons: canvasIconEnv(scope),
        probeWebGL: () => probeWebGL(scope),
    };
}
