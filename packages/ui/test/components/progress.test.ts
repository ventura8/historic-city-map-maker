import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HcmLoadingIndicator, defineHcmLoadingIndicator } from '../../src/components/loading-indicator.js';
import { HcmProgress, defineHcmProgress } from '../../src/components/progress.js';
import { cleanup, fixture, shadowPart } from '../helpers.js';

defineHcmProgress();
defineHcmLoadingIndicator();

describe('<hcm-progress>', () => {
    afterEach(cleanup);

    it('happyPath_aDeterminateLinearBarReportsPercent', async () => {
        const progress = await fixture<HcmProgress>(html`<hcm-progress value="0.42" label="Încărcare"></hcm-progress>`);

        await expect.element(page.getByRole('progressbar', { name: 'Încărcare' })).toHaveAttribute('aria-valuenow', '42');
        expect(shadowPart(progress, '.linear').style.getPropertyValue('--progress')).toBe('0.42');
        expect(await axeViolations(progress)).toEqual([]);
    });

    it('happyPath_aCircularIndicatorDrawsTheRemainingArc', async () => {
        const progress = await fixture<HcmProgress>(html`<hcm-progress kind="circular" value="1" label="Tiles"></hcm-progress>`);

        expect(Number(shadowPart(progress, '.ring').getAttribute('stroke-dashoffset'))).toBe(0);
        await expect.element(page.getByRole('progressbar', { name: 'Tiles' })).toHaveAttribute('aria-valuenow', '100');
    });

    it.each(['linear', 'circular'] as const)('badPath_indeterminate_%s_hasNoValue', async (kind) => {
        const progress = await fixture<HcmProgress>(html`<hcm-progress kind=${kind} indeterminate label="Wait"></hcm-progress>`);

        expect(shadowPart(progress, '[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
    });

    it('badPath_anOutOfRangeValueIsClamped', async () => {
        await fixture<HcmProgress>(html`<hcm-progress value="7" label="Over"></hcm-progress>`);

        await expect.element(page.getByRole('progressbar', { name: 'Over' })).toHaveAttribute('aria-valuenow', '100');
    });
});

describe('<hcm-loading-indicator>', () => {
    afterEach(cleanup);

    it('happyPath_isANamedProgressbarThatMorphs', async () => {
        const indicator = await fixture<HcmLoadingIndicator>(
            html`<hcm-loading-indicator label="Se încarcă harta"></hcm-loading-indicator>`,
        );

        await expect.element(page.getByRole('progressbar', { name: 'Se încarcă harta' })).toBeVisible();
        expect(getComputedStyle(shadowPart(indicator, '.shape')).animationName).toBe('morph');
        expect(await axeViolations(indicator)).toEqual([]);
    });

    it('happyPath_containedSitsOnADisc', async () => {
        const indicator = await fixture<HcmLoadingIndicator>(html`<hcm-loading-indicator contained label="Wait"></hcm-loading-indicator>`);

        expect(shadowPart(indicator, '.shape').offsetWidth).toBe(32);
    });
});

describe('reduced motion', () => {
    it.each([
        { tag: 'hcm-progress', styles: HcmProgress.styles },
        { tag: 'hcm-loading-indicator', styles: HcmLoadingIndicator.styles },
    ])('badPath_$tag_onlyPulsesUnderReducedMotion', ({ styles }) => {
        const rules = styles.flatMap((style) => [...(style.styleSheet?.cssRules ?? [])]);
        const reduced = rules.filter((rule) => rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion'));

        expect(reduced).toHaveLength(1);
        expect(reduced[0]?.cssText).toContain('pulse');
    });
});
