/** Fakes of the browser parts the Mapbox adapter uses: animation frames, a resize observer, a 2D canvas. */
import type { AdapterEnv } from '../../src/map/env.js';
import type { IconCanvas, IconContext, IconEnv } from '../../src/map/icons.js';
import type { FrameScheduler } from '../../src/map/overlay-registry.js';

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

/** A 2D context that records the drawing calls by name. */
class RecordingContext implements IconContext {
    readonly drawn: string[] = [];
    fillStyle: string | CanvasGradient | CanvasPattern = '';
    strokeStyle: string | CanvasGradient | CanvasPattern = '';
    lineWidth = 1;
    font = '';
    textAlign: CanvasTextAlign = 'start';
    textBaseline: CanvasTextBaseline = 'alphabetic';
    readonly #size: number;

    constructor(size: number) {
        this.#size = size;
    }

    #draw(name: string): void {
        this.drawn.push(name);
    }

    beginPath(): void {
        this.#draw('beginPath');
    }

    arc(): void {
        this.#draw('arc');
    }

    moveTo(): void {
        this.#draw('moveTo');
    }

    lineTo(): void {
        this.#draw('lineTo');
    }

    closePath(): void {
        this.#draw('closePath');
    }

    fill(path?: unknown): void {
        this.#draw(path === undefined ? 'fill' : 'fill(path)');
    }

    stroke(): void {
        this.#draw('stroke');
    }

    fillText(text: string): void {
        this.#draw(`fillText(${text})`);
    }

    save(): void {
        this.#draw('save');
    }

    restore(): void {
        this.#draw('restore');
    }

    translate(): void {
        this.#draw('translate');
    }

    scale(): void {
        this.#draw('scale');
    }

    getImageData(): ImageData {
        return {
            data: new Uint8ClampedArray(this.#size * this.#size * 4).fill(255),
            width: this.#size,
            height: this.#size,
            colorSpace: 'srgb',
        };
    }
}

export interface FakeIconEnv extends IconEnv {
    readonly contexts: RecordingContext[];
    readonly fonts: string[];
    readonly paths: string[];
}

export function fakeIconEnv(options: { readonly fontLoads?: boolean; readonly noContext?: boolean } = {}): FakeIconEnv {
    const contexts: RecordingContext[] = [];
    const fonts: string[] = [];
    const paths: string[] = [];
    return {
        contexts,
        fonts,
        paths,
        createCanvas: (size): IconCanvas => ({
            getContext: () => {
                if (options.noContext === true) {
                    return null;
                }
                const context = new RecordingContext(size);
                contexts.push(context);
                return context;
            },
        }),
        createPath: (svgPathData) => {
            paths.push(svgPathData);
            return {} as Path2D;
        },
        loadFont: (font) => {
            fonts.push(font);
            return Promise.resolve(options.fontLoads ?? true);
        },
    };
}

export interface FakeAdapterEnv extends AdapterEnv {
    readonly frames: FakeFrames;
    readonly icons: FakeIconEnv;
    /** Plays a size change of the observed container. */
    resizeObserved(): void;
    readonly observed: number;
}

export function fakeAdapterEnv(options: { readonly webgl?: boolean; readonly fontLoads?: boolean } = {}): FakeAdapterEnv {
    const observers = new Set<() => void>();
    return {
        frames: fakeFrames(),
        icons: fakeIconEnv(options.fontLoads === undefined ? {} : { fontLoads: options.fontLoads }),
        probeWebGL: () => options.webgl ?? true,
        observeResize: (_element, onResize) => {
            observers.add(onResize);
            return () => observers.delete(onResize);
        },
        resizeObserved: () => {
            for (const observer of observers) {
                observer();
            }
        },
        get observed() {
            return observers.size;
        },
    };
}

/** Lets pending promise callbacks run (`turns` microtask turns). */
export async function settle(turns = 10): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        await Promise.resolve();
    }
}
