import { axeViolations } from '@hcm/test-support/axe';
import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { HcmSetupUsgs } from '../../../src/admin/setup/hcm-setup-usgs.js';
import { defineHcmSetupUsgs } from '../../../src/admin/setup/hcm-setup-usgs.js';
import { cleanup, deepFocus, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupUsgs();

async function usgs(changes: ViewChanges = {}, locale = 'ro') {
    const port = new FakeSetupPort(setupView(changes));
    const element = await fixture<HcmSetupUsgs>(
        html`<hcm-setup-usgs .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-usgs>`,
    );
    // As the page does: the element follows the state (the typed username lives there).
    port.subscribe((state) => {
        element.view = state;
    });
    return { port, element };
}

/** The calls besides the drafts of the typed fields. */
function actions(port: FakeSetupPort): readonly unknown[] {
    return port.calls.filter(([name]) => name !== 'draftUsgs');
}

function tokenBox(element: HcmSetupUsgs): HTMLInputElement {
    return shadowPart(element, '#usgs-token') as HTMLInputElement;
}

/** What a paste does to the box: the value, then the `input` event of a paste. */
function paste(box: HTMLInputElement, value: string): void {
    box.dispatchEvent(new Event('paste', { bubbles: true }));
    box.value = value;
    box.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
}

describe('<hcm-setup-usgs> the token', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    it('happyPath_theTokenPageButtonFocusesThePasteBoxFirstAndStartsTheCountdown', async () => {
        const { port, element } = await usgs();
        const link = page.getByRole('link', { name: /Deschide pagina tokenului USGS/ });
        await expect.element(link).toHaveAttribute('href', 'https://ers.cr.usgs.gov/password/appgenerate');
        await expect.element(link).toHaveAttribute('target', '_blank');
        link.element().addEventListener('click', (event) => {
            event.preventDefault();
        });

        await link.click();

        expect(deepFocus()).toBe(tokenBox(element));
        expect(port.calls).toEqual([['startUsgsCountdown']]);
        await expect.element(page.getByLabelText('Tokenul aplicației')).toHaveAttribute('type', 'password');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aPasteWithTheUsernameFilledSavesAtOnce', async () => {
        const { port, element } = await usgs();
        await userEvent.fill(page.getByLabelText('Numele de utilizator ERS'), USGS_CREDENTIALS.approved.username);
        shadowPart(element, '#usgs-username').dispatchEvent(new Event('change'));

        paste(tokenBox(element), ` ${USGS_CREDENTIALS.approved.applicationToken} `);

        expect(actions(port)).toEqual([
            ['noteInput', 'usgs'],
            ['noteInput', 'usgs'],
            ['saveUsgs', USGS_CREDENTIALS.approved],
        ]);
        expect(port.calls).toContainEqual(['draftUsgs', { username: USGS_CREDENTIALS.approved.username }]);
        expect(tokenBox(element).value).toBe('');
    });

    it('happyPath_theOptionalExpiryTravelsWithTheToken', async () => {
        const { port, element } = await usgs();
        await userEvent.fill(page.getByLabelText('Numele de utilizator ERS'), 'e2e-ok');
        const expiry = shadowPart(element, '#usgs-expires') as HTMLInputElement;
        // Typed as a Romanian writes a date (the field's pattern), whatever the browser's language.
        expect(expiry.type).toBe('text');
        expect(expiry.placeholder).toBe('zz.ll.aaaa');
        expiry.value = '12.10.2027';
        expiry.dispatchEvent(new Event('change'));

        paste(tokenBox(element), 'e2e-usgs-app-token-ok');

        expect(port.calls.at(-1)).toEqual([
            'saveUsgs',
            { username: 'e2e-ok', applicationToken: 'e2e-usgs-app-token-ok', expiresOn: '2027-10-12' },
        ]);
        await element.updateComplete;
        expect(expiry.value).toBe('12.10.2027');
    });

    it('badPath_anExpiryThatDoesNotReadAsADateIsSaidAndNotKept', async () => {
        const { port, element } = await usgs({}, 'en');
        const expiry = shadowPart(element, '#usgs-expires') as HTMLInputElement;

        expiry.value = '31/02/2027';
        expiry.dispatchEvent(new Event('change'));
        await element.updateComplete;

        expect(expiry.getAttribute('aria-invalid')).toBe('true');
        expect(shadowPart(element, '#usgs-expires-hint').textContent).toBe('This date cannot be read: write it as dd/mm/yyyy.');
        expect(port.calls.filter(([name, fields]) => name === 'draftUsgs' && 'expiresOn' in (fields as object))).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aPasteBeforeTheUsernameAsksForItAndKeepsTheToken', async () => {
        const { port, element } = await usgs({}, 'en');

        paste(tokenBox(element), 'e2e-usgs-app-token-ok');
        await element.updateComplete;

        expect(shadowPart(element, '#usgs-hint').textContent).toBe('Fill in the username first.');
        expect(tokenBox(element).value).toBe('e2e-usgs-app-token-ok');
        await userEvent.fill(page.getByLabelText('ERS username'), 'e2e-ok');
        await element.updateComplete;
        expect(shadowPart(element, '#usgs-hint').textContent).toBe('Paste the token here: it is saved at once.');
        tokenBox(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(port.calls.at(-1)).toEqual(['saveUsgs', { username: 'e2e-ok', applicationToken: 'e2e-usgs-app-token-ok' }]);
    });

    it('happyPath_theTypedFieldsSurviveTheCardBeingMadeAgain', async () => {
        const { port } = await usgs();
        await userEvent.fill(page.getByLabelText('Numele de utilizator ERS'), 'e2e-ok');
        cleanup();

        const again = await fixture<HcmSetupUsgs>(
            html`<hcm-setup-usgs .view=${port.getState()} .intents=${port.intents} locale="ro"></hcm-setup-usgs>`,
        );

        expect((shadowPart(again, '#usgs-username') as HTMLInputElement).value).toBe('e2e-ok');
        paste(tokenBox(again), 'e2e-usgs-app-token-ok');
        expect(port.calls.at(-1)).toEqual(['saveUsgs', { username: 'e2e-ok', applicationToken: 'e2e-usgs-app-token-ok' }]);
    });

    it('badPath_typingOrAnEmptyBoxSendsNothing', async () => {
        const { port, element } = await usgs();
        const box = tokenBox(element);

        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        box.value = 'typed';
        box.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));

        expect(port.calls).toEqual([]);
    });

    it('happyPath_theExpiryFieldIsOneStopWithItsRing', async () => {
        const { element } = await usgs();
        const expiry = shadowPart(element, '#usgs-expires') as HTMLInputElement;
        shadowPart(element, '#usgs-username').focus();

        await userEvent.keyboard('{Tab}');

        expect(element.shadowRoot?.activeElement).toBe(expiry);
        expect(getComputedStyle(expiry).outlineStyle).toBe('solid');
        expect(expiry.getAttribute('aria-describedby')).toBe('usgs-expires-hint');
    });
});

describe('<hcm-setup-usgs> the countdown and the status', () => {
    afterEach(cleanup);

    it('happyPath_theCountdownShowsTheSecondsLeft', async () => {
        const { element } = await usgs({ usgs: { ...setupView().usgs, secondsLeft: 42 } }, 'en');

        expect(shadowPart(element, '[role="timer"]').textContent).toBe('Paste the token within 42 s');
        await expect.element(page.getByRole('progressbar', { name: 'Paste the token within 42 s' })).toHaveAttribute('aria-valuenow', '70');
    });

    it('badPath_anEndedCountdownSaysSoAndTheBoxStaysOpen', async () => {
        const { element } = await usgs({ usgs: { ...setupView().usgs, expired: true } });

        expect(shadowPart(element, '[role="alert"]').textContent).toContain('Au trecut cele 60 de secunde.');
        expect(element.renderRoot.querySelector('[role="timer"]')).toBeNull();
        expect(tokenBox(element).disabled).toBe(false);
    });

    it('happyPath_theAccessRequestTextNamesTheDatasetsAndTheArea', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const { element } = await usgs({}, 'en');

        expect(shadowPart(element, '.copy-row').textContent).toContain(
            'Area (west, south, east, north): 25.9600, 44.3300, 26.2300, 44.5400.',
        );
        await page.getByRole('button', { name: 'Copy the request text' }).click();

        expect(writeText.mock.calls[0]?.[0]).toContain(
            'Datasets: corona2, declassii, declassiii, landsat_tm_c2_l1, landsat_etm_c2_l1, landsat_ot_c2_l1.',
        );
        vi.restoreAllMocks();
    });

    it('badPath_aCityWithoutBoundsLeavesTheAreaOut', async () => {
        const { element } = await usgs({ usgs: { ...setupView().usgs, area: null } }, 'en');

        expect(shadowPart(element, '.copy-row').textContent).not.toContain('Area');
    });

    it('badPath_aPendingRoleShowsTheNextCheckAndAnExpiringTokenTheReminder', async () => {
        const { element } = await usgs(
            {
                usgs: {
                    ...setupView().usgs,
                    role: 'search',
                    nextCheckAt: '2026-10-12T15:00:00.000Z',
                    tokenExpiresAt: '2026-10-22T00:00:00.000Z',
                    expiresSoon: true,
                },
            },
            'en',
        );

        expect(shadowPart(element, '.role').textContent).toBe('Role: search only (downloads wait for the approval).');
        expect(shadowPart(element, '.body').textContent).toContain('Next check: 12 Oct 2026, 18:00.');
        expect(shadowPart(element, '.expiring').textContent.trim()).toBe(
            'The token expires on 22 Oct 2026. Create a new one and paste it here.',
        );
    });

    it('happyPath_anApprovedRoleSaysSo', async () => {
        const { element } = await usgs({ usgs: { ...setupView().usgs, role: 'download' } });

        expect(shadowPart(element, '.role').textContent).toBe('Rol: căutare și descărcare.');
        expect(element.renderRoot.querySelector('.expiring')).toBeNull();
    });
});
