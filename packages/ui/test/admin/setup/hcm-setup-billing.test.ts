import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { HcmSetupBilling } from '../../../src/admin/setup/hcm-setup-billing.js';
import { defineHcmSetupBilling } from '../../../src/admin/setup/hcm-setup-billing.js';
import type { HcmSetupProvision } from '../../../src/admin/setup/hcm-setup-provision.js';
import { defineHcmSetupProvision } from '../../../src/admin/setup/hcm-setup-provision.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupBilling();
defineHcmSetupProvision();

/** The billing card still to do unless `changes` says otherwise. */
async function billing(changes: ViewChanges = {}, locale = 'ro') {
    const port = new FakeSetupPort(setupView({ ...changes, steps: { billing: { state: 'missing', ...changes.steps?.billing } } }));
    const element = await fixture<HcmSetupBilling>(
        html`<hcm-setup-billing .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-billing>`,
    );
    return { port, element };
}

const ACCOUNTS = [
    { name: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', displayName: 'Card personal', currency: 'USD' },
    { name: 'billingAccounts/DDDDDD-EEEEEE-FFFFFF', displayName: 'Firma', currency: 'RON' },
];

describe('<hcm-setup-billing>', () => {
    afterEach(cleanup);

    it('happyPath_statesTheBudgetAndLinksWithOneClick', async () => {
        const { port, element } = await billing({}, 'en');

        expect(shadowPart(element, '.body').textContent).toContain('The US$5 budget sends alerts at 50%, 90% and 100% of the spending.');
        await page.getByRole('button', { name: 'Link billing and create the US$5 budget' }).click();

        expect(port.calls).toEqual([['linkBilling']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aLinkedProjectSaysSoInTheAccountsCurrency', async () => {
        const { element } = await billing({
            steps: { billing: { state: 'ok' } },
            billing: { ...setupView().billing, amount: 25, currency: 'RON' },
        });

        expect(shadowPart(element, '.success').textContent).toBe('Planul Blaze este activ; bugetul este de 25\u00a0RON pe lună.');
        // Linked: nothing to link any more; only the owner's own word on a free trial (finding 6 of the M6 review).
        expect([...element.renderRoot.querySelectorAll('hcm-button')].map((button) => button.textContent.trim())).toEqual([
            'Contul este o probă gratuită',
        ]);
    });

    it('badPath_whileWaitingForANewAccountTheCardSaysSoAndOffersOnlyGooglesPage', async () => {
        const { element } = await billing({
            billing: { ...setupView().billing, waitingForAccount: true },
            steps: { billing: { busy: true, checkedAt: '2026-10-12T13:05:00.000Z', detail: { key: 'adminSetup.billing.noAccount' } } },
        });

        await expect.element(page.getByRole('progressbar', { name: 'Așteptăm contul nou de facturare…' })).toBeVisible();
        // M6 (finding 3): nothing to link yet, so no button; Google's create page is the primary action.
        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
        await expect
            .element(page.getByRole('link', { name: /Creează un cont de facturare/ }))
            .toHaveAttribute('href', 'https://console.cloud.google.com/billing/create');
        expect(shadowPart(element, '.waiting').textContent).toContain('Pagina verifică la 10 secunde și continuă singură');
        expect(shadowPart(element, '.last-check').textContent).toBe('Ultima verificare: 12 oct. 2026, 16:05.');
    });

    it('badPath_severalAccountsAreAChoiceWithTheFirstPreselected', async () => {
        const { port, element } = await billing({
            billing: { ...setupView().billing, accounts: ACCOUNTS, chosen: ACCOUNTS[0]?.name ?? null },
        });

        await expect.element(page.getByRole('radio', { name: 'Card personal (USD)' })).toBeChecked();
        await userEvent.click(page.getByRole('radio', { name: 'Firma (RON)' }));
        await page.getByRole('button', { name: 'Leagă acest cont' }).click();

        expect(port.calls).toEqual([['chooseBillingAccount', ACCOUNTS[1]?.name], ['confirmBillingAccount']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutIntentsNothingIsCalled', async () => {
        const view = setupView({ steps: { billing: { state: 'missing' } } });
        const element = await fixture<HcmSetupBilling>(html`<hcm-setup-billing .view=${view}></hcm-setup-billing>`);

        await page.getByRole('button', { name: /Leagă facturarea/ }).click();

        expect(element.intents).toBeNull();
    });

    it('badPath_noStateRendersNothing', async () => {
        const element = await fixture<HcmSetupBilling>(html`<hcm-setup-billing></hcm-setup-billing>`);

        expect(element.renderRoot.querySelector('.body')).toBeNull();
    });
});

describe('<hcm-setup-provision>', () => {
    afterEach(cleanup);

    async function provision(changes: ViewChanges = {}, locale = 'ro') {
        const port = new FakeSetupPort(setupView({ ...changes, steps: { provision: { state: 'missing', ...changes.steps?.provision } } }));
        const element = await fixture<HcmSetupProvision>(
            html`<hcm-setup-provision .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-provision>`,
        );
        return { port, element };
    }

    it('happyPath_theDoctorListsEveryItemAndOneClickPreparesTheProject', async () => {
        const { port, element } = await provision();

        // M6 (CR-M6-2): the imagery pipeline's repository is the 16th item; §210 the admin's own site the 17th.
        expect(element.renderRoot.querySelectorAll('.item')).toHaveLength(17);
        expect(shadowPart(element, '[data-item="apis"]').textContent).toContain('Servicii Google activate');
        expect(shadowPart(element, '.body > .note').textContent).toBe('0 din 17 elemente gata');
        await page.getByRole('button', { name: 'Pregătește proiectul' }).click();

        expect(port.calls).toEqual([['provision']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_afterARunTheButtonRetriesWhatFailedAndReasonsAreShown', async () => {
        const items = setupView().provision.items.map((item) => {
            if (item.id === 'secrets') {
                return { ...item, state: 'unavailable' as const, detail: { key: 'apiError.unavailable' as const } };
            }
            return item.id === 'scheduler' ? { ...item, state: 'pending' as const } : { ...item, state: 'ok' as const };
        });
        const { element } = await provision({ provision: { items }, steps: { provision: { state: 'unavailable' } } }, 'en');

        await expect.element(page.getByRole('button', { name: 'Retry what failed' })).toBeVisible();
        expect(shadowPart(element, '[data-item="secrets"] .reason').textContent).toBe('The service is unavailable right now. Try again.');
        expect(shadowPart(element, '[data-item="scheduler"] .reason').textContent).toBe('Created by the first server installation.');
        expect(shadowPart(element, '[data-item="scheduler"]').dataset['state']).toBe('pending');
    });

    it('happyPath_aProvisionedProjectHasNoButton', async () => {
        const { element } = await provision({ steps: { provision: { state: 'ok' } } });

        expect(element.renderRoot.querySelector('hcm-button')).toBeNull();
    });
});
