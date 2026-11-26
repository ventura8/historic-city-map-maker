import { translate } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmConsentBanner, type HcmConsentBanner } from '../../src/components/consent-banner.js';
import { cleanup, fixture, recordEvents } from '../helpers.js';

defineHcmConsentBanner();

function banner(locale: 'ro' | 'en'): Promise<HcmConsentBanner> {
    return fixture<HcmConsentBanner>(
        html`<hcm-consent-banner
            headline=${translate(locale, 'consent.title')}
            body=${translate(locale, 'consent.body')}
            accept-label=${translate(locale, 'consent.accept')}
            decline-label=${translate(locale, 'consent.decline')}
        ></hcm-consent-banner>`,
    );
}

describe('<hcm-consent-banner>', () => {
    afterEach(cleanup);

    it('happyPath_acceptInRomanianGrantsConsent', async () => {
        const element = await banner('ro');
        const decisions = recordEvents(element, 'hcm-consent');

        await expect.element(page.getByRole('region', { name: translate('ro', 'consent.title') })).toBeVisible();
        await userEvent.click(page.getByRole('button', { name: translate('ro', 'consent.accept') }));

        expect(decisions).toEqual([{ decision: 'granted' }]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_declineInEnglishDeniesConsentAndNeverTakesTheFocus', async () => {
        const element = await banner('en');
        const decisions = recordEvents(element, 'hcm-consent');

        expect(element.shadowRoot?.activeElement ?? null).toBeNull();
        await userEvent.click(page.getByRole('button', { name: 'Decline' }));

        expect(decisions).toEqual([{ decision: 'denied' }]);
    });
});
