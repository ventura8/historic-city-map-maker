/**
 * Adaptive layout on the host element, not the viewport: an embedded map gets the box the page gives it, so the M3
 * window classes (breakpoints) are measured with a `ResizeObserver` on the element itself. `WindowClassController`
 * brings that to a Lit element (and can reflect it as attributes for `:host([window-class=…])` styles); the container
 * query helpers give the same breakpoints to CSS `@container` rules.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { WINDOW_CLASS_BREAKPOINTS, windowClassFor, type WindowClass } from '../theme/tokens.js';

export type HeightClass = 'compact' | 'medium' | 'expanded';

/** Lower bounds in CSS px, tallest first (Android's height classes: compact <480, medium <900). */
export const HEIGHT_CLASS_BREAKPOINTS: readonly { readonly heightClass: HeightClass; readonly minHeight: number }[] = [
    { heightClass: 'expanded', minHeight: 900 },
    { heightClass: 'medium', minHeight: 480 },
];

export interface WindowSize {
    readonly width: number;
    readonly height: number;
    readonly widthClass: WindowClass;
    readonly heightClass: HeightClass;
}

/** The height class of a container `height` in CSS px; shorter than 480 (or invalid) is compact. */
export function heightClassFor(height: number): HeightClass {
    return HEIGHT_CLASS_BREAKPOINTS.find((breakpoint) => height >= breakpoint.minHeight)?.heightClass ?? 'compact';
}

export function windowSizeFor(width: number, height: number): WindowSize {
    return { width, height, widthClass: windowClassFor(width), heightClass: heightClassFor(height) };
}

export type ResizeObserverConstructor = new (callback: ResizeObserverCallback) => ResizeObserver;

/** Calls `onSize` with the element's border-box size now-ish and on every change; returns the stop function. */
export function observeWindowSize(
    element: Element,
    onSize: (size: WindowSize) => void,
    Observer: ResizeObserverConstructor = ResizeObserver,
): () => void {
    const observer = new Observer((entries) => {
        const box = entries.at(-1)?.borderBoxSize[0];
        if (box !== undefined) {
            onSize(windowSizeFor(box.inlineSize, box.blockSize));
        }
    });
    observer.observe(element);
    return () => {
        observer.disconnect();
    };
}

export interface WindowClassControllerOptions {
    /** Reflect the classes as `window-class` and `height-class` attributes on the host (default true). */
    readonly reflect?: boolean;
    /** Called after every change of either class (not on every pixel). */
    readonly onChange?: (size: WindowSize) => void;
    readonly Observer?: ResizeObserverConstructor;
}

/** Tracks the host's window classes while it is connected and re-renders it when one changes. */
export class WindowClassController implements ReactiveController {
    private readonly host: ReactiveControllerHost & HTMLElement;
    private readonly options: WindowClassControllerOptions;
    private readonly stops: (() => void)[] = [];
    private current: WindowSize = windowSizeFor(0, 0);

    constructor(host: ReactiveControllerHost & HTMLElement, options: WindowClassControllerOptions = {}) {
        this.host = host;
        this.options = options;
        host.addController(this);
    }

    /** The last measured size (compact × compact until the first measurement). */
    get size(): WindowSize {
        return this.current;
    }

    hostConnected(): void {
        this.stops.push(
            observeWindowSize(
                this.host,
                (size) => {
                    this.update(size);
                },
                this.options.Observer,
            ),
        );
    }

    hostDisconnected(): void {
        for (const stop of this.stops.splice(0)) {
            stop();
        }
    }

    private update(size: WindowSize): void {
        const changed = size.widthClass !== this.current.widthClass || size.heightClass !== this.current.heightClass;
        this.current = size;
        if (changed) {
            this.reflect(size);
            this.options.onChange?.(size);
            this.host.requestUpdate();
        }
    }

    private reflect(size: WindowSize): void {
        if (this.options.reflect ?? true) {
            this.host.setAttribute('window-class', size.widthClass);
            this.host.setAttribute('height-class', size.heightClass);
        }
    }
}

function minWidthOf(windowClass: WindowClass): number {
    return WINDOW_CLASS_BREAKPOINTS.find((breakpoint) => breakpoint.windowClass === windowClass)?.minWidth ?? 0;
}

/** The container-query condition "at least `windowClass` wide", e.g. `(width >= 600px)`; compact is always true. */
export function atLeast(windowClass: WindowClass): string {
    return `(width >= ${String(minWidthOf(windowClass))}px)`;
}

/** The container-query condition of exactly `windowClass`, e.g. `(width >= 600px) and (width < 840px)`. */
export function onlyWindowClass(windowClass: WindowClass): string {
    const lower = minWidthOf(windowClass);
    const upper = WINDOW_CLASS_BREAKPOINTS.filter((breakpoint) => breakpoint.minWidth > lower).at(-1)?.minWidth;
    return upper === undefined ? atLeast(windowClass) : `${atLeast(windowClass)} and (width < ${String(upper)}px)`;
}
