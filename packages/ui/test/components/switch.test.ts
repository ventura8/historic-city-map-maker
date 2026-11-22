import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmSwitch, type HcmSwitch } from '../../src/components/switch.js';
import { cleanup, fixture, recordEvents } from '../helpers.js';

defineHcmSwitch();

describe('<hcm-switch>', () => {
    afterEach(cleanup);

    it('happyPath_clickAndKeysFlipItAndReportTheNewState', async () => {
        const toggle = await fixture<HcmSwitch>(html`<hcm-switch label="Arată Ortofoto 1945"></hcm-switch>`);
        const changes = recordEvents(toggle, 'hcm-change');
        const control = page.getByRole('switch', { name: 'Arată Ortofoto 1945' });

        await expect.element(control).toHaveAttribute('aria-checked', 'false');
        await userEvent.click(control);
        await expect.element(control).toHaveAttribute('aria-checked', 'true');
        toggle.focus();
        await userEvent.keyboard('{Enter}');

        expect(changes).toEqual([{ checked: true }, { checked: false }]);
        expect(await axeViolations(toggle)).toEqual([]);
    });

    it('happyPath_aCheckedSwitchShowsItsCheckMark', async () => {
        const toggle = await fixture<HcmSwitch>(html`<hcm-switch checked label="Photos"></hcm-switch>`);

        expect(getComputedStyle(toggle.shadowRoot?.querySelector('hcm-icon') ?? toggle).visibility).toBe('visible');
        await expect.element(page.getByRole('switch', { name: 'Photos' })).toBeChecked();
    });

    it('badPath_aDisabledSwitchIgnoresClicks', async () => {
        const toggle = await fixture<HcmSwitch>(html`<hcm-switch disabled label="Photos"></hcm-switch>`);
        const changes = recordEvents(toggle, 'hcm-change');

        toggle.shadowRoot?.querySelector('button')?.click();

        expect(changes).toEqual([]);
        expect(toggle.checked).toBe(false);
    });

    it('happyPath_compactIsTheThinVariantAndKeepsItsTouchTarget', async () => {
        const toggle = await fixture<HcmSwitch>(html`<hcm-switch compact label="Streets"></hcm-switch>`);
        const track = toggle.shadowRoot?.querySelector('button');

        expect(toggle.hasAttribute('compact')).toBe(true);
        expect(track?.getBoundingClientRect().width).toBe(40);
        expect(track?.getBoundingClientRect().height).toBe(24);
        expect(track?.classList.contains('touch-target')).toBe(true);
    });

    it('badPath_notCompactByDefault', async () => {
        const toggle = await fixture<HcmSwitch>(html`<hcm-switch label="Streets"></hcm-switch>`);

        expect(toggle.compact).toBe(false);
        expect(toggle.shadowRoot?.querySelector('button')?.getBoundingClientRect().width).toBe(52);
    });
});
