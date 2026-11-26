import { describe, expect, it } from 'vitest';

import { TEXT_FONT_STACK } from '../../src/fonts/font-files.js';
import {
    MOTION_EASINGS,
    MOTION_SPRINGS,
    REDUCED_MOTION_TOKENS,
    SHAPE_CORNERS,
    STATE_TOKENS,
    SYSTEM_TOKENS,
    TYPE_SCALE,
} from '../../src/theme/system.js';

describe('system tokens', () => {
    it('happyPath_theShapeScaleHasTheExpressiveSizes', () => {
        expect(SYSTEM_TOKENS['--md-sys-shape-corner-large-increased']).toBe('20px');
        expect(SYSTEM_TOKENS['--md-sys-shape-corner-extra-large-increased']).toBe('32px');
        expect(SYSTEM_TOKENS['--md-sys-shape-corner-extra-extra-large']).toBe('48px');
        expect(Object.keys(SHAPE_CORNERS)).toHaveLength(10);
    });

    it('happyPath_everyTypeStyleHasItsSixTokens', () => {
        for (const name of Object.keys(TYPE_SCALE)) {
            for (const suffix of ['font', 'size', 'line-height', 'tracking', 'weight']) {
                expect(SYSTEM_TOKENS[`--md-sys-typescale-${name}-${suffix}`]).toBeDefined();
            }
            expect(SYSTEM_TOKENS[`--md-sys-typescale-emphasized-${name}-weight`]).toBeDefined();
        }
        expect(SYSTEM_TOKENS['--md-sys-typescale-display-large-font']).toBe('var(--md-ref-typeface-brand)');
        expect(SYSTEM_TOKENS['--md-sys-typescale-title-large-font']).toBe('var(--md-ref-typeface-brand)');
        expect(SYSTEM_TOKENS['--md-sys-typescale-title-medium-font']).toBe('var(--md-ref-typeface-plain)');
        expect(SYSTEM_TOKENS['--md-ref-typeface-plain']).toBe(TEXT_FONT_STACK);
    });

    it('happyPath_theEmphasizedWeightIsTheNextOneUp', () => {
        expect(TYPE_SCALE['body-large']).toEqual({
            size: '1rem',
            lineHeight: '1.5rem',
            tracking: '0.03125rem',
            weight: '400',
            emphasizedWeight: '500',
        });
        expect(TYPE_SCALE['label-large']).toMatchObject({ weight: '500', emphasizedWeight: '700' });
        expect(SYSTEM_TOKENS['--md-sys-typescale-emphasized-title-medium-weight']).toBe('700');
    });

    it('happyPath_springsUseTheOfficialWebCurves', () => {
        expect(SYSTEM_TOKENS['--md-sys-motion-spring-fast-spatial-easing']).toBe('cubic-bezier(0.42, 1.67, 0.21, 0.9)');
        expect(SYSTEM_TOKENS['--md-sys-motion-spring-default-spatial-duration']).toBe('500ms');
        expect(MOTION_SPRINGS['default-spatial']).toMatchObject({ stiffness: 700, damping: 0.9 });
        expect(SYSTEM_TOKENS['--md-sys-motion-easing-standard']).toBe(MOTION_EASINGS.standard);
    });

    it('happyPath_elevationLevelsAreShadowsInTheSchemeShadowColour', () => {
        expect(SYSTEM_TOKENS['--md-sys-elevation-level0']).toBe('none');
        expect(SYSTEM_TOKENS['--md-sys-elevation-level3']).toContain('var(--md-sys-color-shadow)');
        expect(SYSTEM_TOKENS['--md-sys-elevation-level5']).toBeDefined();
        expect(SYSTEM_TOKENS['--md-sys-state-hover-state-layer-opacity']).toBe(STATE_TOKENS['--md-sys-state-hover-state-layer-opacity']);
    });

    it('badPath_reducedMotionStopsEverySpatialSpringButKeepsTheFades', () => {
        expect(REDUCED_MOTION_TOKENS['--md-sys-motion-spring-default-spatial-duration']).toBe('0ms');
        expect(REDUCED_MOTION_TOKENS['--md-sys-motion-spring-fast-spatial-easing']).toBe(MOTION_EASINGS.standard);
        expect(Object.keys(REDUCED_MOTION_TOKENS).some((name) => name.includes('effects'))).toBe(false);
        expect(Object.keys(REDUCED_MOTION_TOKENS)).toHaveLength(6);
    });
});
