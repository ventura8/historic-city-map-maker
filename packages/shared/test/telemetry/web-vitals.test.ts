import { describe, expect, it } from 'vitest';

import {
    VIEWER_EVENT_PARAMS,
    eventProblem,
    eventSchemas,
    observeWebVitals,
    sanitizeTarget,
    shortTarget,
    vitalParams,
    type GaParams,
    type VitalMetric,
    type VitalObserver,
} from '../../src/index.js';

const CONTEXT = { app: 'viewer', window_class: 'medium', release: '1.2.0', page_location: 'https://example.org/bucharest/' };
const VIEWER = eventSchemas(VIEWER_EVENT_PARAMS);

function metric(overrides: Partial<VitalMetric> = {}): VitalMetric {
    return {
        name: 'LCP',
        value: 1830.4,
        delta: 1830.4,
        id: 'v6-1-2',
        rating: 'good',
        navigationType: 'navigate',
        attribution: {},
        ...overrides,
    };
}

interface FakeNode {
    nodeName: string;
    parentNode?: FakeNode | null;
    host?: FakeNode | null;
    classList?: string[];
}

/** `nodes` from the outermost to the innermost, each the parent of the next. */
function chain(...nodes: FakeNode[]): FakeNode {
    for (let index = 1; index < nodes.length; index += 1) {
        const child = nodes[index];
        if (child !== undefined) {
            child.parentNode = nodes[index - 1] ?? null;
        }
    }
    return nodes.at(-1) ?? { nodeName: '#document' };
}

describe('web vitals', () => {
    it('happyPath_lcpWithItsAttributionBecomesValidParameters', () => {
        const params = vitalParams(
            metric({
                attribution: {
                    target: 'hcm-photo-sheet div.details>img',
                    timeToFirstByte: 120.456,
                    resourceLoadDelay: 30,
                    resourceLoadDuration: 400,
                    elementRenderDelay: 12,
                    loadState: 'complete',
                },
            }),
        );
        expect(params).toEqual({
            metric_name: 'LCP',
            metric_value: 1830,
            metric_delta: 1830,
            metric_id: 'v6-1-2',
            metric_rating: 'good',
            navigation_type: 'navigate',
            value: 1830,
            debug_target: 'hcm-photo-sheet div.details>img',
            debug_load_state: 'complete',
            debug_ttfb: 120.46,
            debug_resource_delay: 30,
            debug_resource_duration: 400,
            debug_render_delay: 12,
        });
        expect(eventProblem(VIEWER, 'web_vitals', { ...params, ...CONTEXT })).toBeNull();
    });

    it('happyPath_inpClsFcpAndTtfbKeepTheirOwnAttribution', () => {
        const inp = vitalParams(
            metric({
                name: 'INP',
                value: 240,
                delta: 240,
                attribution: {
                    interactionTarget: 'hcm-layer-panel button',
                    interactionType: 'pointer',
                    inputDelay: 5,
                    processingDuration: 200,
                    presentationDelay: 35,
                },
            }),
        );
        expect(inp).toMatchObject({ debug_target: 'hcm-layer-panel button', debug_interaction_type: 'pointer', debug_processing: 200 });
        const cls = vitalParams(
            metric({ name: 'CLS', value: 0.123_456, delta: 0.1, attribution: { largestShiftTarget: 'page', largestShiftValue: 0.09 } }),
        );
        expect(cls).toMatchObject({ metric_value: 0.1235, metric_delta: 0.1, value: 100, debug_target: 'page', debug_shift_value: 0.09 });
        const ttfb = vitalParams(
            metric({
                name: 'TTFB',
                attribution: { dnsDuration: 1, connectionDuration: 2, requestDuration: 3, waitingDuration: 4, cacheDuration: 0 },
            }),
        );
        expect(ttfb).toMatchObject({ debug_dns: 1, debug_connection: 2, debug_request: 3, debug_waiting: 4, debug_cache: 0 });
        const fcp = vitalParams(metric({ name: 'FCP', attribution: { firstByteToFCP: 900, loadState: 'dom-interactive' } }));
        expect(fcp).toMatchObject({ debug_fcp_after_ttfb: 900, debug_load_state: 'dom-interactive' });
        for (const params of [inp, cls, ttfb, fcp]) {
            expect(eventProblem(VIEWER, 'web_vitals', { ...params, ...CONTEXT })).toBeNull();
        }
    });

    it('badPath_aSelectorWithAnIdOrAnAttributeAndBrokenNumbersAreLeftOut', () => {
        const params = vitalParams(
            metric({
                delta: -3,
                attribution: { target: 'html>body>div#photo-p-0042', timeToFirstByte: Number.NaN, resourceLoadDelay: -1 },
            }),
        );
        expect(params).not.toHaveProperty('debug_target');
        expect(params).not.toHaveProperty('debug_ttfb');
        expect(params).not.toHaveProperty('debug_resource_delay');
        expect(params['value']).toBe(0);
        expect(sanitizeTarget(undefined)).toBeUndefined();
        expect(sanitizeTarget('a[href="x"]')).toBeUndefined();
        expect(sanitizeTarget(`hcm-x ${'div>'.repeat(40)}`)).toHaveLength(100);
    });

    it('happyPath_theTargetIsTheAppsElementThenItsInnermostSegments', () => {
        const viewer: FakeNode = { nodeName: 'HCM-MAP-VIEWER', parentNode: { nodeName: 'BODY' } };
        const root: FakeNode = { nodeName: '#document-fragment', host: viewer };
        const node = chain(
            root,
            { nodeName: 'DIV', classList: ['frame'] },
            { nodeName: 'SECTION' },
            { nodeName: 'UL' },
            { nodeName: 'BUTTON', classList: ['Item', 'x'] },
        );
        expect(shortTarget(node)).toBe('hcm-map-viewer section>ul>button');
        expect(shortTarget(viewer)).toBe('hcm-map-viewer');
        const sheet = chain({ nodeName: 'HCM-PHOTO-SHEET', classList: ['open'] }, { nodeName: 'IMG', classList: ['thumb'] });
        expect(shortTarget(sheet)).toBe('hcm-photo-sheet img.thumb');
    });

    it('badPath_aNodeOutsideTheAppIsPageAndANonNodeIsNothing', () => {
        const node = chain({ nodeName: '#document' }, { nodeName: 'HTML' }, { nodeName: 'BODY' }, { nodeName: 'H1', classList: ['title'] });
        expect(shortTarget(node)).toBe('page');
        expect(shortTarget({ nodeName: 'svg:path', parentNode: { nodeName: '#document-fragment' } })).toBe('page');
        expect(shortTarget(null)).toBeUndefined();
        expect(shortTarget({ name: 'x' })).toBeUndefined();
    });

    it('happyPath_everyObserverReportsWithTheAppsSelector', () => {
        const reported: GaParams[] = [];
        const options: unknown[] = [];
        const observer =
            (name: VitalMetric['name']): VitalObserver =>
            (report, opts) => {
                options.push(opts.generateTarget({ nodeName: 'HCM-ABOUT-DIALOG' }));
                report(metric({ name }));
            };
        observeWebVitals([observer('LCP'), observer('CLS')], (params) => reported.push(params));
        expect(reported.map((params) => params['metric_name'])).toEqual(['LCP', 'CLS']);
        expect(options).toEqual(['hcm-about-dialog', 'hcm-about-dialog']);
    });
});
