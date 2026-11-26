import { describe, expect, it } from 'vitest';

import { defineSetupElements, SETUP_PAGE_TAGS } from '../../../src/admin/setup/define.js';
import { loadSourcesCards } from '../../../src/admin/setup/hcm-setup-page.js';
import { copyToClipboard } from '../../../src/admin/setup/setup-body.js';
import { formatDate, formatDateTime, formatMoney, setupLabel, setupText } from '../../../src/admin/setup/setup-text.js';

describe('setupText', () => {
    it('happyPath_eachCatalogueSpeaksBothLanguages', () => {
        expect(setupText('ro', { key: 'adminSetup.deploy.failed', params: { name: 'admin-claim' } })).toBe(
            'Funcția admin-claim nu s-a instalat. Reia instalarea.',
        );
        expect(setupText('en', { key: 'adminShell.session.continue' })).toBe('Continue');
        expect(setupText('ro', { key: 'apiError.cloud.permission', params: { role: 'roles/owner' } })).toBe(
            'Contului serverului îi lipsește o permisiune în proiect: reia „Pregătește proiectul”.',
        );
        expect(setupLabel('en', 'adminSetup.title')).toBe('Setup');
    });

    it('happyPath_aScopeIsNamedByItsGoogleLabel', () => {
        expect(setupText('en', { key: 'adminShell.oauth.scopeDenied', params: { scope: 'cloudBilling' } })).toContain(
            '"Manage your Google Cloud billing"',
        );
    });

    it('happyPath_anItemAWaitingItemNamesIsShownByItsLabel', () => {
        expect(setupText('en', { key: 'adminSetup.provision.waiting', params: { item: 'secrets' } })).toBe(
            'Waiting for: Places for the secret keys.',
        );
        expect(setupText('ro', { key: 'adminSetup.provision.waiting', params: { item: 'billing' } })).toBe(
            'Așteaptă: Facturare Google Cloud și buget.',
        );
        expect(setupText('en', { key: 'adminSetup.provision.waiting', params: { item: 'something' } })).toBe('Waiting for: something.');
    });

    it('happyPath_anIsoTimeIsShownAsADateAndTime_badPath_aTimeAlreadyWrittenStaysAsItIs', () => {
        // Finding 34 of 2026-11-01: "Last checked {time}" on step c after a Check again without a Google token.
        const iso = '2026-10-31T12:05:00.000Z';
        expect(setupText('en', { key: 'adminSetup.provision.lastChecked', params: { time: iso } })).toBe(
            `Last checked ${formatDateTime('en', iso)}; sign in to Google Cloud to check again.`,
        );
        expect(setupText('ro', { key: 'adminSetup.provision.lastChecked', params: { time: iso } })).toContain(formatDateTime('ro', iso));
        expect(setupText('en', { key: 'adminSetup.provision.lastChecked', params: { time: 'yesterday' } })).toContain('yesterday');
    });

    it('badPath_aScopeThatIsNotAGoogleScopeStaysAsItIs', () => {
        expect(setupText('en', { key: 'adminShell.oauth.scopeDenied', params: { scope: 'drive' } })).toContain('"drive"');
    });
});

describe('formatting', () => {
    it('happyPath_datesTimesAndAmountsFollowTheLanguage', () => {
        expect(formatDate('en', '2026-10-22T00:00:00.000Z')).toBe('22 Oct 2026');
        expect(formatDate('ro', '2026-10-22T00:00:00.000Z')).toBe('22 oct. 2026');
        expect(formatDateTime('en', '2026-10-12T15:00:00.000Z')).toBe('12 Oct 2026, 18:00');
        expect(formatMoney('en', 5, 'USD')).toBe('US$5');
        expect(formatMoney('ro', 25, 'RON')).toBe('25\u00a0RON');
    });
});

describe('copyToClipboard', () => {
    it('happyPath_writesTheText', async () => {
        const written: string[] = [];

        expect(
            await copyToClipboard('demo-hcm', {
                writeText: (text) => {
                    written.push(text);
                    return Promise.resolve();
                },
            }),
        ).toBe(true);
        expect(written).toEqual(['demo-hcm']);
    });

    it('badPath_noClipboardOrARefusalIsFalse', async () => {
        expect(await copyToClipboard('x', undefined)).toBe(false);
        expect(await copyToClipboard('x', { writeText: () => Promise.reject(new Error('denied')) })).toBe(false);
    });
});

describe('defineSetupElements', () => {
    it('happyPath_registersEveryElementOnceInTheGivenRegistry', async () => {
        const defined = new Map<string, CustomElementConstructor>();
        const definitions: string[] = [];
        const registry = {
            get: (tag: string) => defined.get(tag),
            define: (tag: string, element: CustomElementConstructor) => {
                definitions.push(tag);
                defined.set(tag, element);
            },
        } as unknown as CustomElementRegistry;

        defineSetupElements(registry);
        defineSetupElements(registry);
        defineSetupElements();
        // M28: the Platform and Sources cards come in their own chunk.
        await loadSourcesCards(registry);

        expect(Object.values(SETUP_PAGE_TAGS).map((tag) => defined.has(tag))).toEqual([true, true]);
        expect(
            definitions
                .filter((tag) => tag.startsWith('hcm-setup-') || tag.startsWith('hcm-crash'))
                .toSorted((a, b) => a.localeCompare(b, 'en')),
        ).toEqual([
            'hcm-crash-groups',
            'hcm-crashes-page',
            'hcm-setup-analytics',
            'hcm-setup-billing',
            'hcm-setup-deploy',
            'hcm-setup-import',
            'hcm-setup-mapbox',
            'hcm-setup-page',
            'hcm-setup-pipeline',
            'hcm-setup-platform',
            'hcm-setup-provision',
            'hcm-setup-site',
            'hcm-setup-sources',
            'hcm-setup-step',
            'hcm-setup-usgs',
        ]);
        expect(defined.has('hcm-consent-note')).toBe(true);
        expect(customElements.get('hcm-crashes-page')).toBeDefined();
    });
});
