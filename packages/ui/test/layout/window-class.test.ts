import { LitElement, html, type TemplateResult } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import {
    WindowClassController,
    atLeast,
    heightClassFor,
    observeWindowSize,
    onlyWindowClass,
    windowSizeFor,
    type WindowSize,
} from '../../src/layout/window-class.js';

/** A ResizeObserver the test drives by hand: `resize(w, h)` reports a border box. */
const observers: FakeObserver[] = [];

class FakeObserver {
    readonly observed: Element[] = [];
    disconnected = false;
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
    }

    observe(element: Element): void {
        this.observed.push(element);
    }

    disconnect(): void {
        this.disconnected = true;
    }

    unobserve(): void {
        this.disconnected = true;
    }

    resize(inlineSize: number, blockSize: number): void {
        const entry = { borderBoxSize: [{ inlineSize, blockSize }] } as unknown as ResizeObserverEntry;
        this.callback([entry], this);
    }

    empty(): void {
        this.callback([], this);
    }
}

const Observer = FakeObserver as unknown as new (callback: ResizeObserverCallback) => ResizeObserver;

function lastObserver(): FakeObserver {
    const latest = observers.at(-1);
    if (latest === undefined) {
        throw new Error('no observer');
    }
    return latest;
}

const sizes: WindowSize[] = [];

class Sized extends LitElement {
    readonly windowClass = new WindowClassController(this, {
        Observer,
        onChange: (size) => {
            sizes.push(size);
        },
    });

    override render(): TemplateResult {
        return html`${this.windowClass.size.widthClass}`;
    }
}
customElements.define('hcm-test-sized', Sized);

class Quiet extends LitElement {
    readonly windowClass = new WindowClassController(this, { Observer, reflect: false });
}
customElements.define('hcm-test-quiet', Quiet);

describe('height classes and sizes', () => {
    it.each([
        [0, 'compact'],
        [479, 'compact'],
        [480, 'medium'],
        [899, 'medium'],
        [900, 'expanded'],
    ] as const)('happyPath_%dpx_is_%s', (height, expected) => {
        expect(heightClassFor(height)).toBe(expected);
    });

    it('badPath_anInvalidHeightIsCompact', () => {
        expect(heightClassFor(Number.NaN)).toBe('compact');
    });

    it('happyPath_aSizeCarriesBothClasses', () => {
        expect(windowSizeFor(1280, 400)).toEqual({ width: 1280, height: 400, widthClass: 'large', heightClass: 'compact' });
    });
});

describe('container queries', () => {
    it('happyPath_atLeastAndOnlyGiveTheBreakpoints', () => {
        expect(atLeast('medium')).toBe('(width >= 600px)');
        expect(atLeast('compact')).toBe('(width >= 0px)');
        expect(onlyWindowClass('medium')).toBe('(width >= 600px) and (width < 840px)');
        expect(onlyWindowClass('compact')).toBe('(width >= 0px) and (width < 600px)');
        expect(onlyWindowClass('extra-large')).toBe('(width >= 1600px)');
    });
});

describe('observeWindowSize', () => {
    it('happyPath_reportsTheBorderBoxAndStops', () => {
        const element = document.createElement('div');
        const seen: WindowSize[] = [];

        const stop = observeWindowSize(element, (size) => seen.push(size), Observer);
        lastObserver().resize(700, 500);
        lastObserver().empty();
        stop();

        expect(seen).toEqual([windowSizeFor(700, 500)]);
        expect(lastObserver().observed).toEqual([element]);
        expect(lastObserver().disconnected).toBe(true);
    });

    it('happyPath_theRealResizeObserverMeasuresTheElement', async () => {
        const element = document.createElement('div');
        element.style.setProperty('width', '900px');
        element.style.setProperty('height', '300px');
        document.body.append(element);

        const size = await new Promise<WindowSize>((resolve) => {
            const stop = observeWindowSize(element, (measured) => {
                stop();
                resolve(measured);
            });
        });

        expect(size).toMatchObject({ widthClass: 'expanded', heightClass: 'compact' });
        element.remove();
    });
});

describe('WindowClassController', () => {
    afterEach(() => {
        sizes.length = 0;
        document.body.replaceChildren();
    });

    it('happyPath_reflectsTheClassesAndRerendersOnAChange', async () => {
        const element = document.createElement('hcm-test-sized') as Sized;
        document.body.append(element);
        await element.updateComplete;

        lastObserver().resize(1700, 1000);
        await element.updateComplete;

        expect(element.getAttribute('window-class')).toBe('extra-large');
        expect(element.getAttribute('height-class')).toBe('expanded');
        expect(element.shadowRoot?.textContent).toContain('extra-large');
        expect(sizes).toHaveLength(1);
    });

    it('badPath_aResizeWithinTheSameClassesChangesNothing', async () => {
        const element = document.createElement('hcm-test-sized') as Sized;
        document.body.append(element);
        lastObserver().resize(300, 300);
        lastObserver().resize(320, 310);
        await element.updateComplete;

        expect(sizes).toHaveLength(0);
        expect(element.windowClass.size.width).toBe(320);
        expect(element.hasAttribute('window-class')).toBe(false);
    });

    it('happyPath_stopsObservingWhenDisconnected', () => {
        const element = document.createElement('hcm-test-quiet') as Quiet;
        document.body.append(element);
        const observer = lastObserver();

        element.remove();
        element.remove();

        expect(observer.disconnected).toBe(true);
    });

    it('happyPath_withoutReflectTheAttributesStayAway', () => {
        const element = document.createElement('hcm-test-quiet') as Quiet;
        document.body.append(element);

        lastObserver().resize(650, 600);

        expect(element.windowClass.size.widthClass).toBe('medium');
        expect(element.hasAttribute('window-class')).toBe(false);
    });
});
