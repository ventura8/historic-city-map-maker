import { describe, expect, it } from 'vitest';

import { clamp, defineOnce, emit, fillTemplate, snapToStep } from '../../src/components/internal.js';

describe('fillTemplate', () => {
    it('happyPath_fillsEveryPlaceholder', () => {
        expect(fillTemplate('{name}: opacity {percent} %', { name: 'Ortofoto 1945', percent: '40' })).toBe('Ortofoto 1945: opacity 40 %');
    });

    it('badPath_anUnknownPlaceholderStaysVisible', () => {
        expect(fillTemplate('Show {name} {missing}', { name: 'Photos' })).toBe('Show Photos {missing}');
    });
});

describe('snapToStep', () => {
    it.each([
        [41.4, 0, 100, 1, 41],
        [41.6, 0, 100, 1, 42],
        [0.30000000000000004, 0, 1, 0.1, 0.3],
        [-5, 0, 100, 1, 0],
        [105, 0, 100, 1, 100],
        [7, 0, 100, 5, 5],
    ])('happyPath_%d_in_%d..%d_step_%d_is_%d', (value, min, max, step, expected) => {
        expect(snapToStep(value, min, max, step)).toBe(expected);
    });

    it.each([0, -1, Number.NaN])('badPath_step_%d_onlyClamps', (step) => {
        expect(snapToStep(12.34, 0, 10, step)).toBe(10);
        expect(snapToStep(3.21, 0, 10, step)).toBeCloseTo(3.21, 10);
    });

    it('happyPath_clamp', () => {
        expect([clamp(-1, 0, 1), clamp(0.5, 0, 1), clamp(2, 0, 1)]).toEqual([0, 0.5, 1]);
    });
});

describe('emit and defineOnce', () => {
    it('happyPath_eventsBubbleAndCrossShadowRoots', () => {
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'open' });
        const inner = root.appendChild(document.createElement('span'));
        document.body.append(host);
        const seen: unknown[] = [];
        document.body.addEventListener('hcm-test', (event) => seen.push((event as CustomEvent).detail));

        emit(inner, 'hcm-test', { a: 1 });
        emit(inner, 'hcm-test');

        expect(seen).toEqual([{ a: 1 }, {}]);
        host.remove();
    });

    it('badPath_aSecondDefinitionIsIgnored', () => {
        class First extends HTMLElement {}
        class Second extends HTMLElement {}

        defineOnce(customElements, 'hcm-test-once', First);
        defineOnce(customElements, 'hcm-test-once', Second);

        expect(customElements.get('hcm-test-once')).toBe(First);
    });
});
