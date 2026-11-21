import { LOCALES, translate, type MessageKey } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_ERROR_CARD_TAG, HcmErrorCard, defineHcmErrorCard } from '../../src/viewer/hcm-error-card.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';

/** The errors a visitor can meet (the `error.config.*` ones speak to the city owner who set the page up). */
const VISITOR_ERRORS: readonly MessageKey[] = [
    'error.generic',
    'error.manifest.notFound',
    'error.manifest.network',
    'error.manifest.timeout',
    'error.manifest.invalid',
    'error.manifest.version',
    'error.manifest.engineTooOld',
    'error.webgl',
    'error.mapLoad',
    'error.tiles',
    'error.layer',
    'error.photoImage',
    'error.unknownPhoto',
];

/** Words a visitor should never have to know (the M1 UX review found "manifestul" and "WebGL" on the error card). */
const JARGON = /manifest|webgl|json|schema|engine|motor|basemap|tile|config/i;

describe('<hcm-error-card>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmErrorCard();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aRetryableErrorOffersRetry', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            error: { code: 'error.manifest.notFound', retryable: true },
        });
        const events = recordEvents(element, 'hcm-retry');

        await expect.element(page.getByRole('alert')).toHaveTextContent('Harta nu a fost găsită. Încearcă din nou mai târziu. Reîncearcă');
        await page.getByRole('button', { name: 'Reîncearcă' }).click();

        expect(events).toHaveLength(1);
    });

    it('happyPath_anM3ErrorContainerWithAFilledTonalRetry', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            error: { code: 'error.manifest.network', retryable: true },
        });
        element.style.setProperty('--md-sys-color-error-container', 'rgb(255, 218, 214)');
        element.style.setProperty('--md-sys-color-on-error-container', 'rgb(65, 0, 2)');

        const card = getComputedStyle(shadowQuery(element, '.card'));
        const retry = shadowQuery(element, 'hcm-button') as HTMLElement & { variant: string; icon: string };

        expect([card.backgroundColor, card.color]).toEqual(['rgb(255, 218, 214)', 'rgb(65, 0, 2)']);
        expect(getComputedStyle(shadowQuery(element, 'hcm-icon')).color).toBe('rgb(65, 0, 2)');
        expect([retry.variant, retry.icon]).toEqual(['tonal', 'refresh']);
    });

    it('badPath_noVisitorErrorSpeaksJargonInEitherLanguage', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG);
        const seen: string[] = [];
        for (const locale of LOCALES) {
            for (const code of VISITOR_ERRORS) {
                element.locale = locale;
                element.error = { code, retryable: false, params: { count: '1', version: '2.0.0', name: 'Corona 1966' } };
                await element.updateComplete;
                seen.push(shadowText(element));
            }
        }

        expect(seen.filter((text) => JARGON.test(text))).toEqual([]);
        expect(seen).toContain(translate('en', 'error.webgl'));
        expect(seen).toContain(translate('ro', 'error.manifest.engineTooOld', { version: '2.0.0' }));
    });

    it('badPath_aConfigurationErrorNamesTheProblemWithoutRetry', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            locale: 'en',
            error: { code: 'error.config.cityMismatch', retryable: false, params: { cityId: 'bacau', manifestCityId: 'bucuresti' } },
        });

        await expect
            .element(page.getByRole('alert'))
            .toHaveTextContent('The cityId in config.js (bacau) does not match the map (bucuresti).');
        expect(shadowText(element)).toContain('bucuresti');
        expect(element.shadowRoot?.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_anInvalidManifestNamesItsFirstIssueInTheVisitorsLanguage', async () => {
        const error = {
            code: 'error.manifest.invalid',
            retryable: false,
            params: {
                count: '2',
                detail: 'pois.1.geometry validation.ringClosed',
                issuePath: 'pois.1.geometry',
                issueCode: 'validation.ringClosed',
            },
        } as const;
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, { error });

        expect(shadowText(element)).toContain('Datele hărții sunt nevalide (probleme găsite: 2).');
        expect(shadowText(element)).toContain('pois.1.geometry: Un inel al poligonului trebuie să se termine unde începe.');
        element.locale = 'en';
        await element.updateComplete;
        expect(shadowText(element)).toContain('pois.1.geometry: A polygon ring must end where it starts.');
    });

    it('badPath_anIssueWithoutAPathOrWithAnUnknownCodeShowsWhatItCan', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            error: {
                code: 'error.manifest.invalid',
                retryable: false,
                params: { count: '1', issuePath: '', issueCode: 'validation.json' },
            },
        });

        expect(shadowText(element)).toContain('Conținutul nu este JSON valid.');
        expect(shadowText(element)).not.toContain(': Conținutul');
        element.error = { code: 'error.manifest.invalid', retryable: false, params: { count: '1', issueCode: 'not.a.code' } };
        await element.updateComplete;
        expect(element.shadowRoot?.querySelector('.issue')).toBeNull();
    });

    it('badPath_noErrorRendersNothing', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG);

        expect(shadowText(element)).toBe('');
        expect(customElements.get(HCM_ERROR_CARD_TAG)).toBe(HcmErrorCard);
    });
});
