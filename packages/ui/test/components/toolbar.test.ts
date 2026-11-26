import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmIconButton, type HcmIconButton } from '../../src/components/icon-button.js';
import { defineHcmToolbar, type HcmToolbar } from '../../src/components/toolbar.js';
import { cleanup, fixture, press } from '../helpers.js';

defineHcmToolbar();
defineHcmIconButton();

function toolbar(orientation = 'horizontal'): Promise<HcmToolbar> {
    return fixture<HcmToolbar>(
        html`<hcm-toolbar label="Hartă" orientation=${orientation}>
            <hcm-icon-button icon="layers" label="Straturi"></hcm-icon-button>
            <hcm-icon-button icon="my_location" label="Locație" disabled></hcm-icon-button>
            <hcm-icon-button icon="share" label="Distribuie"></hcm-icon-button>
            <hcm-icon-button icon="info" label="Despre"></hcm-icon-button>
        </hcm-toolbar>`,
    );
}

function focusedLabel(): string | null {
    const active = document.activeElement as HcmIconButton | null;
    return active?.label ?? null;
}

describe('<hcm-toolbar>', () => {
    afterEach(cleanup);

    it('happyPath_aNamedToolbarWithOneTabStop', async () => {
        const element = await toolbar();

        await expect.element(page.getByRole('toolbar', { name: 'Hartă' })).toHaveAttribute('aria-orientation', 'horizontal');
        expect(element.items().map((item) => item.tabIndex)).toEqual([0, -1, -1]);
        await userEvent.tab();
        expect(focusedLabel()).toBe('Straturi');
        await userEvent.tab();
        expect(focusedLabel()).not.toBe('Distribuie');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_arrowsMoveAndWrapPastDisabledControls', async () => {
        const element = await toolbar();
        const bar = element.shadowRoot?.querySelector('[role="toolbar"]') ?? element;

        press(bar, 'ArrowRight');
        expect(focusedLabel()).toBe('Distribuie');
        press(bar, 'ArrowRight');
        press(bar, 'ArrowRight');
        expect(focusedLabel()).toBe('Straturi');
        press(bar, 'ArrowLeft');
        expect(focusedLabel()).toBe('Despre');
        press(bar, 'Home');
        expect(focusedLabel()).toBe('Straturi');
        press(bar, 'End');
        expect(focusedLabel()).toBe('Despre');
        expect(element.items().map((item) => item.tabIndex)).toEqual([-1, -1, 0]);
    });

    it('happyPath_verticalUsesUpAndDownAndClickingMovesTheTabStop', async () => {
        const element = await toolbar('vertical');
        const bar = element.shadowRoot?.querySelector('[role="toolbar"]') ?? element;

        press(bar, 'ArrowDown');
        expect(focusedLabel()).toBe('Distribuie');
        await userEvent.click(page.getByRole('button', { name: 'Despre' }));
        expect(element.items().map((item) => item.tabIndex)).toEqual([-1, -1, 0]);
        const ignored = press(bar, 'ArrowRight');
        expect(ignored.defaultPrevented).toBe(false);
    });

    it('badPath_anEmptyToolbarIgnoresKeys', async () => {
        const element = await fixture<HcmToolbar>(html`<hcm-toolbar label="Empty"></hcm-toolbar>`);
        const bar = element.shadowRoot?.querySelector('[role="toolbar"]') ?? element;

        expect(press(bar, 'End').defaultPrevented).toBe(false);
        expect(element.items()).toEqual([]);
    });

    it('badPath_focusOnTheToolbarItselfKeepsTheTabStop', async () => {
        const element = await toolbar();
        const bar = element.shadowRoot?.querySelector('[role="toolbar"]') ?? element;

        bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));

        expect(element.items().map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    });
});
