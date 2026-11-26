import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import type { HcmSetupStep } from '../../../src/admin/setup/hcm-setup-step.js';
import { defineHcmSetupStep } from '../../../src/admin/setup/hcm-setup-step.js';
import type { SetupStepView } from '../../../src/admin/setup/setup-port.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, stepView } from './fixtures.js';

defineHcmSetupStep();

const BILLING = stepView('billing', {
    scope: 'cloudBilling',
    links: [{ id: 'gcp.billingAccounts', url: 'https://console.cloud.google.com/billing' }],
    budget: { inputs: 1, consents: 1 },
    used: { inputs: 1, consents: 0 },
});

async function render(step: SetupStepView | null, options: { mode?: string; open?: boolean; locale?: string } = {}) {
    const port = new FakeSetupPort();
    const element = await fixture<HcmSetupStep>(
        html`<hcm-setup-step
            .step=${step}
            .intents=${port.intents}
            .noteParams=${{ projectId: 'demo-hcm', domain: 'demo-hcm.firebaseapp.com', amount: '5 USD' }}
            mode=${options.mode ?? 'inline'}
            locale=${options.locale ?? 'ro'}
            ?open=${options.open ?? true}
            ><p>corp</p></hcm-setup-step
        >`,
    );
    return { element, port };
}

describe('<hcm-setup-step> header', () => {
    afterEach(cleanup);

    it('happyPath_anInlineCardIsAnAccordionButtonWithItsStatus', async () => {
        const { element, port } = await render(BILLING, { open: false });

        const header = page.getByRole('button', { name: /Facturare Google Cloud și buget/ });
        await expect.element(header).toHaveAttribute('aria-expanded', 'false');
        expect(shadowPart(element, '.status').textContent).toContain('De făcut');
        await header.click();

        expect(port.calls).toEqual([['open', 'billing']]);
        expect(element.renderRoot.querySelector('#body')).toBeNull();
    });

    it('badPath_aStepTheOlderServerCannotSayReadsUpdateTheServerNotToDo', async () => {
        // Finding 27 of 2026-10-31.
        const { element } = await render(stepView('mapbox', { unknown: true }), { open: false, locale: 'en' });

        const chip = shadowPart(element, '.status');
        expect(chip.hasAttribute('data-unknown')).toBe(true);
        expect(chip.textContent).toContain('Update the server to check');
        expect(chip.textContent).not.toContain('To do');
    });

    it('happyPath_aStepWhoseFirstCheckHasNotAnsweredReadsCheckingNotToDo', async () => {
        // Finding 32 of 2026-10-31: right after a reload.
        const { element } = await render(stepView('mapbox', { firstCheck: true }), { open: false, locale: 'en' });

        const chip = shadowPart(element, '.status');
        expect(chip.hasAttribute('data-checking')).toBe(true);
        expect(chip.hasAttribute('data-busy')).toBe(false);
        expect(chip.textContent).toContain('Checking…');
        expect(chip.textContent).not.toContain('To do');
        expect(chip.querySelector('hcm-loading-indicator')?.getAttribute('label')).toBe('Checking…');
    });

    it('badPath_aBusyStepSaysWorkingEvenDuringItsFirstCheck', async () => {
        const { element } = await render(stepView('provision', { firstCheck: true, busy: true }), { open: false, locale: 'ro' });

        const chip = shadowPart(element, '.status');
        expect(chip.hasAttribute('data-busy')).toBe(true);
        expect(chip.hasAttribute('data-checking')).toBe(false);
        expect(chip.textContent).toContain('Se lucrează…');
    });

    it('happyPath_anOpenInlineCardCollapsesOnItsHeader', async () => {
        const { port } = await render(BILLING, { open: true });

        await page.getByRole('button', { name: /Facturare/ }).click();

        expect(port.calls).toEqual([['open', null]]);
    });

    it('happyPath_aSummaryRowMarksTheOpenStep', async () => {
        const { element, port } = await render(BILLING, { mode: 'summary', open: true, locale: 'en' });

        const row = page.getByRole('button', { name: /Google Cloud billing and budget/ });
        await expect.element(row).toHaveAttribute('aria-current', 'step');
        await row.click();
        expect(port.calls).toEqual([['open', 'billing']]);
        expect(shadowPart(element, '.header').hasAttribute('aria-expanded')).toBe(false);
        expect(element.renderRoot.querySelector('#body')).toBeNull();
    });

    it('happyPath_theDetailPaneHasAHeadingAndNoButton', async () => {
        const { element } = await render(stepView('analytics', { state: 'ok' }), { mode: 'detail', open: false, locale: 'en' });

        await expect.element(page.getByRole('heading', { name: /Analytics and crash reports/ })).toBeVisible();
        expect(element.renderRoot.querySelector('button.header')).toBeNull();
        expect(shadowPart(element, '.optional').textContent).toBe('Optional');
        expect(shadowPart(element, '.status').textContent).toContain('Done');
    });

    it('badPath_aBusyStepShowsTheIndicatorAndDisablesCheckAgain', async () => {
        const { element } = await render(stepView('provision', { busy: true }));

        expect(element.renderRoot.querySelector('hcm-loading-indicator')).not.toBeNull();
        expect(shadowPart(element, '.recheck hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('badPath_noStepRendersNothing', async () => {
        const { element } = await render(null);

        expect(element.renderRoot.querySelector('.card')).toBeNull();
        expect(element.dataset['step']).toBeUndefined();
    });
});

describe('<hcm-setup-step> body', () => {
    afterEach(cleanup);

    it('happyPath_explainsWhyAndTheCostThenLinksAndTheConsentNote', async () => {
        const { element, port } = await render(BILLING);

        expect(shadowPart(element, '.body').textContent).toContain('Google rulează serverul hărții doar în planul Blaze');
        expect(shadowPart(element, '.body').textContent).toContain('estimăm 0,5–2 USD pe lună');
        const link = page.getByRole('link', { name: /Conturile de facturare Google Cloud/ });
        await expect.element(link).toHaveAttribute('target', '_blank');
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
        const note = shadowPart(element, 'hcm-consent-note');
        expect(note.shadowRoot?.textContent).toContain('Google îți cere acces la facturare: legăm contul și creăm bugetul de 5 USD.');
        expect(note.shadowRoot?.textContent).toContain('demo-hcm.firebaseapp.com');

        link.element().addEventListener('click', (event) => {
            event.preventDefault();
        });
        await link.click();
        expect(port.calls).toEqual([['followLink', 'billing']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theStepsOwnBodyIsSlottedAndCheckAgainChecksIt', async () => {
        const { element, port } = await render(BILLING);

        expect(element.textContent).toContain('corp');
        await page.getByRole('button', { name: 'Verifică din nou' }).click();

        expect(port.calls).toEqual([['recheck', 'billing']]);
    });

    it('happyPath_theHostCarriesTheInputBudgetForTheE2eTier', async () => {
        const { element } = await render(BILLING);

        expect(Object.fromEntries(Object.entries(element.dataset))).toEqual({
            step: 'billing',
            state: 'missing',
            inputs: '1',
            consents: '0',
            inputBudget: '1',
            consentBudget: '1',
        });
    });

    it('badPath_aRecordedReasonAndAFailureAreShown', async () => {
        const { element } = await render(
            stepView('provision', {
                state: 'invalid',
                detail: { key: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
                error: { key: 'adminShell.oauth.scopeDenied', params: { scope: 'cloudPlatform' } },
            }),
            { locale: 'en' },
        );

        expect(shadowPart(element, '.detail').dataset['detail']).toBe('apiError.cloud.permission');
        expect(shadowPart(element, '.detail').textContent).toContain('lacks a permission in the project');
        expect(page.getByRole('alert').element().textContent).toContain('"Manage your Google Cloud data"');
    });

    it('badPath_anExpiredTokenOffersContinue', async () => {
        const { port } = await render(stepView('deploy', { needsContinue: true }), { locale: 'en' });

        await page.getByRole('button', { name: 'Continue' }).click();

        expect(port.calls).toEqual([['continueGoogle', 'deploy']]);
    });

    it('badPath_aStepWaitingForEarlierStepsOrTheServerSaysSo', async () => {
        const { element } = await render(stepView('provision', { available: false, scope: 'cloudPlatform' }));
        expect(shadowPart(element, '.waiting').textContent).toBe('Disponibil după pașii de mai sus.');
        expect(element.renderRoot.querySelector('hcm-consent-note')).toBeNull();
        expect(element.renderRoot.querySelector('slot')).toBeNull();
        cleanup();

        const server = await render(stepView('mapbox', { available: false }));
        expect(shadowPart(server.element, '.waiting').textContent).toBe('Disponibil după instalarea serverului hărții.');
    });

    it('badPath_anInstallCardSaysItsCostOnceInItsBody_aWaitingOneInTheFrame', async () => {
        // Finding 10 of the M6 review: the frame's cost line and the card's were two.
        const open = await render(stepView('deploy', { available: true }), { locale: 'en' });
        expect(open.element.renderRoot.querySelector('#body')?.textContent).not.toContain("Within the Blaze plan's estimate above.");
        cleanup();

        const waiting = await render(stepView('site', { available: false }), { locale: 'en' });
        expect(waiting.element.renderRoot.querySelector('#body')?.textContent).toContain('Firebase Hosting: free up to 10 GB');
    });

    it('happyPath_aDoneStepWhoseNextActionAsksGoogleKeepsItsNote', async () => {
        const { element } = await render(stepView('billing', { state: 'ok', scope: 'cloudBilling' }));

        expect(element.renderRoot.querySelector('hcm-consent-note')).not.toBeNull();
    });

    it('badPath_aStepWhoseCardOpensNoPopupHasNoNote', async () => {
        const { element } = await render(stepView('signIn', { state: 'ok', scope: null }));

        expect(element.renderRoot.querySelector('hcm-consent-note')).toBeNull();
    });

    it('badPath_withoutIntentsTheButtonsDoNothing', async () => {
        const element = await fixture<HcmSetupStep>(
            html`<hcm-setup-step .step=${stepView('deploy', { needsContinue: true })} open></hcm-setup-step>`,
        );

        await page.getByRole('button', { name: /Instalarea serverului/ }).click();
        await page.getByRole('button', { name: 'Continuă' }).click();
        await page.getByRole('button', { name: 'Verifică din nou' }).click();

        expect(element.step?.id).toBe('deploy');
    });
});
