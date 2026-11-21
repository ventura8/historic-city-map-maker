/**
 * Mounts `<hcm-map-viewer>` against a `FakeStore`, with the kit doubles and fake browser services, at a chosen box
 * size (the window class comes from the element's own ResizeObserver, as in production).
 */
import { vi } from 'vitest';

import type { WindowClass } from '../../src/theme/tokens.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import { defineHcmAboutDialog } from '../../src/viewer/hcm-about-dialog.js';
import { defineHcmLightbox } from '../../src/viewer/hcm-lightbox.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import type { ViewerServices } from '../../src/viewer/services.js';
import type { ViewerController, ViewerState } from '../../src/viewer/store-port.js';
import { defineKitDoubles, shadowQuery } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';

export interface Box {
    readonly width: number;
    readonly height: number;
}

export const COMPACT: Box = { width: 360, height: 700 };
export const MEDIUM: Box = { width: 700, height: 800 };
export const EXPANDED: Box = { width: 1000, height: 800 };
export const EXTRA_LARGE: Box = { width: 1700, height: 900 };
export const LANDSCAPE_PHONE: Box = { width: 900, height: 400 };

export function fakeServices(change: Partial<ViewerServices> = {}): ViewerServices {
    return {
        share: null,
        copyText: () => Promise.resolve(),
        watchPosition: (onFix) => {
            queueMicrotask(() => {
                onFix({ center: [26.1, 44.43], accuracy: 20, heading: null });
            });
            return () => undefined;
        },
        pageUrl: () => 'https://example.org/#14/44.43/26.1',
        matchMedia: (query) => window.matchMedia(query),
        openPage: () => undefined,
        ...change,
    };
}

export interface Mounted {
    readonly element: HcmMapViewer;
    readonly store: FakeStore;
}

export function setBox(element: HTMLElement, box: Box): void {
    element.style.display = 'block';
    element.style.width = `${String(box.width)}px`;
    element.style.height = `${String(box.height)}px`;
}

/** Waits until the element's ResizeObserver has told the store its window class. */
async function settle(mounted: Mounted, windowClass: WindowClass): Promise<void> {
    await vi.waitFor(() => {
        if (mounted.store.getState().windowClass !== windowClass) {
            throw new Error(`still ${mounted.store.getState().windowClass}`);
        }
    });
    await mounted.element.updateComplete;
}

/** A connected viewer showing `state` (ready by default) in a `box`, with fake services. */
export async function mountViewer(
    state: ViewerState = readyState(),
    box: Box = COMPACT,
    controller: ViewerController | null = null,
): Promise<Mounted> {
    defineKitDoubles();
    defineViewerElements();
    // The engine side-loads the full-size view and About (`extras-loader.ts`); here they are defined as if they had loaded.
    defineHcmLightbox();
    defineHcmAboutDialog();
    const element = document.createElement('hcm-map-viewer');
    element.services = fakeServices();
    element.engineVersion = '1.2.3';
    element.manifestUrl = new URL('/seed/bucharest/manifest.static.json', location.origin).href;
    setBox(element, box);
    const store = new FakeStore(state);
    element.attach(store, controller);
    document.body.append(element);
    await element.updateComplete;
    const mounted = { element, store };
    await settle(mounted, windowClassOf(box));
    return mounted;
}

function windowClassOf(box: Box): WindowClass {
    if (box.width >= 1600) {
        return 'extra-large';
    }
    if (box.width >= 1200) {
        return 'large';
    }
    if (box.width >= 840) {
        return 'expanded';
    }
    return box.width >= 600 ? 'medium' : 'compact';
}

/** The `part` element inside the viewer's shadow root, e.g. `hcm-layer-panel`. */
export function part(mounted: Mounted, selector: string): HTMLElement {
    return shadowQuery(mounted.element, selector);
}

/** Collects the public events the page would see. */
export function publicEvents(element: HTMLElement): { type: string; detail: unknown }[] {
    const seen: { type: string; detail: unknown }[] = [];
    const types = [
        'hcm-ready',
        'hcm-error',
        'hcm-layer-change',
        'hcm-overlay-change',
        'hcm-photo-open',
        'hcm-poi-open',
        'hcm-map-labels-change',
    ];
    for (const type of types) {
        document.addEventListener(type, (event) => {
            if (event.target === element) {
                seen.push({ type, detail: (event as CustomEvent).detail });
            }
        });
    }
    return seen;
}
