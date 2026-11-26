import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { HCM_BUTTON_TAG, HcmButton, defineHcmButton } from '../../src/components/button.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmButton();

describe('<hcm-button>', () => {
    afterEach(cleanup);

    it('happyPath_theSlottedLabelIsTheAccessibleName', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button icon="share">Distribuie</hcm-button>`);

        await expect.element(page.getByRole('button', { name: 'Distribuie' })).toBeVisible();
        expect(shadowPart(button, 'hcm-icon').getAttribute('name')).toBe('share');
        expect(await axeViolations(button)).toEqual([]);
    });

    it('happyPath_aClickReachesTheHost', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button variant="tonal">Retry</hcm-button>`);
        const clicks = recordEvents(button, 'click');

        await userEvent.click(page.getByRole('button', { name: 'Retry' }));

        expect(clicks).toHaveLength(1);
        expect(button.variant).toBe('tonal');
    });

    it('happyPath_keyboardActivatesAndFocusIsDelegated', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button variant="outlined">OK</hcm-button>`);
        const clicks = recordEvents(button, 'click');

        button.focus();
        await userEvent.keyboard('{Enter}');

        expect(button.shadowRoot?.activeElement).toBe(shadowPart(button, 'button'));
        expect(clicks).toHaveLength(1);
    });

    it.each(['filled', 'text'] as const)('happyPath_variant_%s_rendersWithoutIcon', async (variant) => {
        const button = await fixture<HcmButton>(html`<hcm-button variant=${variant}>Go</hcm-button>`);

        expect(button.shadowRoot?.querySelector('hcm-icon')).toBeNull();
        expect(getComputedStyle(shadowPart(button, 'button')).height).toBe('40px');
    });

    it('happyPath_aToggleStatesItsPressedStateOnTheFocusedButton', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button .pressed=${true}>Draw</hcm-button>`);

        await expect.element(page.getByRole('button', { name: 'Draw', pressed: true })).toBeVisible();
        button.pressed = false;
        await button.updateComplete;
        expect(shadowPart(button, 'button').getAttribute('aria-pressed')).toBe('false');
    });

    it('badPath_aButtonThatIsNoToggleStatesNoPressedState', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button>Go</hcm-button>`);

        const inner = shadowPart(button, 'button');
        expect(['aria-pressed', 'aria-haspopup', 'aria-current', 'aria-label'].filter((name) => inner.hasAttribute(name))).toEqual([]);
    });

    it('happyPath_itsPopupItsCurrentStateAndItsNameReachTheFocusedButton', async () => {
        // docs/LESSONS.md 249: ARIA on the host names nothing, since the host is not the focused element.
        const button = await fixture<HcmButton>(
            html`<hcm-button .popup=${'dialog'} .current=${true} .label=${'City: Cluj'}>Cluj</hcm-button>`,
        );

        await expect.element(page.getByRole('button', { name: 'City: Cluj' })).toBeVisible();
        const inner = shadowPart(button, 'button');
        expect([inner.getAttribute('aria-haspopup'), inner.getAttribute('aria-current')]).toEqual(['dialog', 'true']);
        button.current = false;
        await button.updateComplete;
        expect(inner.hasAttribute('aria-current')).toBe(false);
    });

    it('badPath_aDisabledButtonIgnoresClicks', async () => {
        const button = await fixture<HcmButton>(html`<hcm-button disabled>Nope</hcm-button>`);
        const clicks = recordEvents(button, 'click');

        (shadowPart(button, 'button') as HTMLButtonElement).click();

        expect(clicks).toHaveLength(0);
        await expect.element(page.getByRole('button', { name: 'Nope' })).toBeDisabled();
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmButton();

        expect(customElements.get(HCM_BUTTON_TAG)).toBe(HcmButton);
    });
});
