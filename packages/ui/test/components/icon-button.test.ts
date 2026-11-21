import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmIconButton, type HcmIconButton } from '../../src/components/icon-button.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmIconButton();

describe('<hcm-icon-button>', () => {
    afterEach(cleanup);

    it('happyPath_theLabelIsTheAccessibleName', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button icon="close" label="Închide"></hcm-icon-button>`);
        const clicks = recordEvents(button, 'click');
        const changes = recordEvents(button, 'hcm-change');

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));

        expect(clicks).toHaveLength(1);
        expect(changes).toEqual([]);
        expect(shadowPart(button, 'button').hasAttribute('aria-pressed')).toBe(false);
        expect(shadowPart(button, 'button').hasAttribute('aria-expanded')).toBe(false);
        expect(await axeViolations(button)).toEqual([]);
    });

    it('happyPath_expandedSaysWhatTheButtonCollapses', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button icon="chevron_left" label="Collapse layers"></hcm-icon-button>`);
        button.expanded = true;
        await button.updateComplete;

        await expect.element(page.getByRole('button', { name: 'Collapse layers' })).toHaveAttribute('aria-expanded', 'true');
        button.expanded = false;
        await expect.element(page.getByRole('button', { name: 'Collapse layers' })).toHaveAttribute('aria-expanded', 'false');
        expect(await axeViolations(button)).toEqual([]);
    });

    it('happyPath_aToggleFlipsSelectedAndFillsItsIcon', async () => {
        const button = await fixture<HcmIconButton>(
            html`<hcm-icon-button toggle icon="layers" label="Layers" variant="tonal"></hcm-icon-button>`,
        );
        const changes = recordEvents(button, 'hcm-change');
        const control = page.getByRole('button', { name: 'Layers' });

        await userEvent.click(control);
        await expect.element(control).toHaveAttribute('aria-pressed', 'true');
        expect(shadowPart(button, 'hcm-icon').hasAttribute('filled')).toBe(true);
        button.focus();
        await userEvent.keyboard(' ');

        expect(changes).toEqual([{ selected: true }, { selected: false }]);
        expect(button.selected).toBe(false);
    });

    it('badPath_aDisabledToggleNeverChanges', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button toggle disabled icon="layers" label="Layers"></hcm-icon-button>`);
        const changes = recordEvents(button, 'hcm-change');

        (shadowPart(button, 'button') as HTMLButtonElement).click();

        expect(changes).toEqual([]);
        await expect.element(page.getByRole('button', { name: 'Layers' })).toBeDisabled();
    });

    it('badPath_aSoftDisabledButtonSaysSoKeepsTheFocusAndItsToggleNeverChanges', async () => {
        const button = await fixture<HcmIconButton>(
            html`<hcm-icon-button toggle soft-disabled icon="add" label="Zoom in"></hcm-icon-button>`,
        );
        const changes = recordEvents(button, 'hcm-change');
        const control = page.getByRole('button', { name: 'Zoom in' });

        button.focus();
        await userEvent.keyboard('{Enter}');

        await expect.element(control).toHaveAttribute('aria-disabled', 'true');
        await expect.element(control).not.toHaveAttribute('disabled');
        expect(button.shadowRoot?.activeElement).toBe(shadowPart(button, 'button'));
        expect(changes).toEqual([]);
        expect(await axeViolations(button)).toEqual([]);
    });

    // Forced colours override the color-mix dimming: the soft-disabled button turns GrayText as a disabled one does.
    it('badPath_inForcedColoursASoftDisabledButtonIsGrayText', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button soft-disabled icon="add" label="Zoom in"></hcm-icon-button>`);

        const rules = (button.shadowRoot?.adoptedStyleSheets ?? []).flatMap((sheet) => [...sheet.cssRules]);
        const forced = rules.filter((rule) => rule instanceof CSSMediaRule && rule.conditionText.includes('forced-colors: active'));
        const inner = forced.flatMap((rule) => [...(rule as CSSMediaRule).cssRules]) as CSSStyleRule[];

        expect(inner.find((rule) => rule.selectorText.includes('soft-disabled'))?.style.color).toBe('graytext');
    });

    it('badPath_aSoftDisabledButtonShowsNoHoverLayer', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button soft-disabled icon="add" label="Zoom in"></hcm-icon-button>`);
        const control = shadowPart(button, 'button');

        await userEvent.hover(page.getByRole('button', { name: 'Zoom in' }));
        await Promise.all(control.getAnimations({ subtree: true }).map((animation) => animation.finished));

        expect(getComputedStyle(control, '::before').opacity).toBe('0');
        expect(getComputedStyle(control).cursor).toBe('default');
    });

    it('happyPath_softDisabledOffHasNoAriaDisabled', async () => {
        const button = await fixture<HcmIconButton>(html`<hcm-icon-button icon="add" label="Zoom in"></hcm-icon-button>`);

        button.softDisabled = true;
        await button.updateComplete;
        button.softDisabled = false;
        await button.updateComplete;

        expect(shadowPart(button, 'button').hasAttribute('aria-disabled')).toBe(false);
        expect(button.hasAttribute('soft-disabled')).toBe(false);
    });
});
