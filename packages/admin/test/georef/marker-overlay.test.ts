import { FakeMap } from '@hcm/test-support/fake-map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAW_HIT_COLOR, GeorefMarkerOverlay } from '../../src/georef/marker-overlay.js';
import type { SuggestionRow } from '../../src/georef/suggestions.js';
import { pair } from './fixtures.js';

beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('getComputedStyle', (el: { style?: { position?: string } }) => ({
        getPropertyValue: () => '',
        position: el.style?.position ?? '',
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Minimal 2d context: the badge painters only set styles and call path methods. */
function context2d(): CanvasRenderingContext2D {
    const noop = (): void => undefined;
    return {
        setTransform: noop,
        clearRect: noop,
        beginPath: noop,
        arc: noop,
        fill: noop,
        stroke: noop,
        fillText: noop,
        measureText: () => ({ width: 8 }) as TextMetrics,
        save: noop,
        restore: noop,
        translate: noop,
        scale: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        setLineDash: noop,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'center',
        textBaseline: 'middle',
    } as unknown as CanvasRenderingContext2D;
}

interface HostOptions {
    readonly context?: CanvasRenderingContext2D | null;
    readonly position?: string;
    readonly width?: number;
    readonly height?: number;
}

/** A host with a document that can make a canvas — admin Vitest is Node (no real DOM). */
function host(options: HostOptions = {}): {
    readonly element: HTMLElement;
    readonly canvas: HTMLCanvasElement & { clientWidth: number; clientHeight: number };
} {
    const canvas = {
        dataset: {} as DOMStringMap,
        style: {} as CSSStyleDeclaration,
        width: 0,
        height: 0,
        clientWidth: options.width ?? 800,
        clientHeight: options.height ?? 600,
        getContext: () => ('context' in options ? (options.context ?? null) : context2d()),
        setAttribute: noopAttr,
        remove: noopAttr,
    };
    const element = {
        style: { position: options.position ?? 'static' } as CSSStyleDeclaration,
        ownerDocument: {
            createElement: (tag: string) => {
                if (tag !== 'canvas') {
                    throw new Error(tag);
                }
                return canvas;
            },
        },
        append(child: unknown) {
            (element as { child?: unknown }).child = child;
        },
        querySelector() {
            return (element as { child?: unknown }).child ?? null;
        },
    };
    return {
        element: element as unknown as HTMLElement,
        canvas: canvas as unknown as HTMLCanvasElement & { clientWidth: number; clientHeight: number },
    };
}

function noopAttr(): void {
    return undefined;
}

function suggestion(id: string, label: string): SuggestionRow {
    return { pair: pair(id, 10, 10), label, level: 'high', offsetM: 2 };
}

function mountedMap(): FakeMap {
    const map = new FakeMap();
    map.mounted = true;
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    return map;
}

describe('the georeferencer map badge overlay', () => {
    it('happyPath_attachPaintsPairsSuggestionsHalfAndCrosshairAndMoveRepaints', () => {
        const map = mountedMap();
        const overlay = new GeorefMarkerOverlay();
        const { element, canvas } = host();

        overlay.attach(element, map);
        expect(element.style.position).toBe('relative');
        expect(canvas.dataset['georefBadges']).toBe('');

        overlay.setScene({
            pairs: [pair('g1', 0, 0), pair('g2', 100, 100, 0, false)],
            selected: 'g1',
            suggestions: [suggestion('a1', 'a1'), suggestion('a2', 'a2')],
            selectedSuggestion: 'a1',
            half: { lat: 44.46, lng: 26.12 },
            ghost: { lat: 44.455, lng: 26.11 },
            crosshair: true,
            tones: { g1: 'ok', g2: 'bad' },
        });
        map.emit('move', map.view);
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);

        const widthAfterFirst = canvas.width;
        overlay.paint();
        expect(canvas.width).toBe(widthAfterFirst);

        overlay.setScene({
            pairs: [pair('g1', 0, 0)],
            selected: null,
            suggestions: [],
            selectedSuggestion: null,
            half: null,
            ghost: null,
            crosshair: false,
            tones: {},
        });
        overlay.detach();
        overlay.detach();
        expect(DRAW_HIT_COLOR).toBe('rgba(0,0,0,.01)');
    });

    it('happyPath_relativeHostStaysRelativeAndLowDevicePixelRatioStillPaints', () => {
        vi.stubGlobal('devicePixelRatio', 0.5);
        const map = mountedMap();
        const overlay = new GeorefMarkerOverlay();
        const { element, canvas } = host({ position: 'relative', width: 400, height: 300 });

        overlay.attach(element, map);
        expect(element.style.position).toBe('relative');
        overlay.setScene({
            pairs: [pair('g1', 0, 0)],
            selected: 'g1',
            suggestions: [suggestion('a1', 'a1')],
            selectedSuggestion: null,
            half: { lat: 44.45, lng: 26.1 },
            ghost: null,
            crosshair: true,
            tones: { g1: 'warn' },
        });
        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(300);
        overlay.detach();
    });

    it('happyPath_paintNoOpsWithoutACanvasAndSkipsUnprojectablePlaces', () => {
        const map = new FakeMap();
        const overlay = new GeorefMarkerOverlay();
        overlay.setScene({
            pairs: [pair('g1', 0, 0)],
            selected: null,
            suggestions: [suggestion('a1', 'a1')],
            selectedSuggestion: null,
            half: { lat: 44.45, lng: 26.1 },
            ghost: null,
            crosshair: true,
            tones: {},
        });
        overlay.paint();

        map.mounted = false;
        const { element, canvas } = host();
        overlay.attach(element, map);
        overlay.setScene({
            pairs: [pair('g1', 0, 0)],
            selected: 'g1',
            suggestions: [suggestion('a1', 'a1')],
            selectedSuggestion: null,
            half: { lat: 44.45, lng: 26.1 },
            ghost: null,
            crosshair: true,
            tones: {},
        });
        expect(map.callsOf('project').length).toBeGreaterThanOrEqual(3);
        expect(canvas.width).toBeGreaterThan(0);
        overlay.detach();
    });

    it('badPath_attachWithoutADocumentHostOrContextLeavesNoPaint', () => {
        const map = mountedMap();
        const overlay = new GeorefMarkerOverlay();
        const bare = { append: undefined, ownerDocument: null } as unknown as HTMLElement;
        overlay.attach(bare, map);

        const noDocument = { append: () => undefined, ownerDocument: undefined } as unknown as HTMLElement;
        overlay.attach(noDocument, map);

        const { element } = host({ context: null, position: 'relative' });
        overlay.attach(element, map);
        overlay.setScene({
            pairs: [pair('g1', 0, 0)],
            selected: null,
            suggestions: [],
            selectedSuggestion: null,
            half: null,
            ghost: null,
            crosshair: false,
            tones: {},
        });
        overlay.detach();
        expect(DRAW_HIT_COLOR.startsWith('rgba')).toBe(true);
    });
});
