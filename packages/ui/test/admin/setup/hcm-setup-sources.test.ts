// M28 (docs/research/M28-sources.md §5): the Sources and Platform cards: switches, accounts, costs, details, the funnel's codes.
import { DEFAULT_SOURCES } from '@hcm/shared/sources';
import { FUNNEL_EVENT, type FunnelSignal } from '@hcm/shared/funnels';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmSetupPlatform, sectionReady, type HcmSetupPlatform } from '../../../src/admin/setup/hcm-setup-platform.js';
import { choiceReason, defineHcmSetupSources, type HcmSetupSources } from '../../../src/admin/setup/hcm-setup-sources.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, FINDER_NONE, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupSources();
defineHcmSetupPlatform();

async function sources(changes: ViewChanges = {}, locale = 'en') {
    const port = new FakeSetupPort(setupView(changes));
    const element = await fixture<HcmSetupSources>(
        html`<hcm-setup-sources .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-sources>`,
    );
    return { port, element };
}

async function platform(changes: ViewChanges = {}, locale = 'en') {
    const port = new FakeSetupPort(setupView(changes));
    const element = await fixture<HcmSetupPlatform>(
        html`<hcm-setup-platform .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-platform>`,
    );
    return { port, element };
}

function text(element: Element): string {
    return element.shadowRoot?.textContent.replace(/\s+/g, ' ') ?? '';
}

describe('<hcm-setup-sources>', () => {
    afterEach(cleanup);

    it('happyPath_theSuggestedSwitchesTheMonthAndSaveMyChoice @S-A180-HAPPY-SAVE-DEFAULTS', async () => {
        const { port, element } = await sources();
        const signals: FunnelSignal[] = [];
        element.addEventListener(FUNNEL_EVENT, (event) => signals.push((event as CustomEvent<FunnelSignal>).detail));

        expect(text(element)).toContain(
            "The app's platform, always on (Google Cloud and Firebase on the Blaze plan, Mapbox within its free allowance): about USD 0.5–2.",
        );
        expect(text(element)).toContain('Your sources: free.');
        expect(text(element)).toContain('In all: about USD 0.5–2 a month.');
        expect(text(element)).toContain('Nothing is saved yet');
        await expect
            .element(page.getByRole('switch', { name: 'Declassified spy-satellite photos (USGS)' }))
            .toHaveAttribute('aria-checked', 'true');
        await expect
            .element(page.getByRole('switch', { name: 'Paid scans of frames not scanned yet (USGS)' }))
            .toHaveAttribute('aria-checked', 'false');
        expect(text(element)).toContain('Always on: every old image is aligned with it.');

        await page.getByRole('button', { name: 'Save my choice' }).click();

        expect(port.calls).toEqual([['saveSources']]);
        expect(signals.map((signal) => (signal.kind === 'action' ? signal.action : signal.kind))).toContain('source.usgs.on_default');
        expect(signals).toHaveLength(8);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aSwitchCallsTheIntent_andPaidScansShowTheirOneOffPrice', async () => {
        const { port, element } = await sources({
            sources: { choices: { ...DEFAULT_SOURCES, usgsOrders: true, cloudAi: true }, saved: DEFAULT_SOURCES, finder: FINDER_NONE },
        });

        expect(text(element)).toContain('Each scan you order: USD 35 for one frame');
        expect(text(element)).toContain('Your sources: about USD 0–0.5.');
        expect(text(element)).toContain('You changed the choice');
        await page.getByRole('switch', { name: 'Landsat (USGS and NASA)' }).click();

        expect(port.calls).toEqual([['chooseSource', 'landsat', false]]);
    });

    it('happyPath_theUsgsAccountStates_needed_waiting_signedIn @S-A180-HAPPY-ACCOUNT-STATES', async () => {
        const needed = await sources({ steps: { usgs: { links: [{ id: 'usgs.register', url: 'https://ers.cr.usgs.gov/register' }] } } });
        expect(text(needed.element)).toContain('Account needed');
        const signUp = shadowPart(needed.element, 'a.action[target="_blank"]') as HTMLAnchorElement;
        expect(signUp.href).toBe('https://ers.cr.usgs.gov/register');
        cleanup();

        const waiting = await sources({ usgs: { ...setupView().usgs, pendingSince: '2026-10-12T09:00:00.000Z' } });
        expect(text(waiting.element)).toContain('USGS usually approves the access in 24 to 48 working hours');
        cleanup();

        const signedIn = await sources({
            steps: { usgs: { state: 'ok' }, billing: { state: 'ok' } },
            sources: { choices: { ...DEFAULT_SOURCES, cloudAi: true }, saved: null, finder: FINDER_NONE },
        });
        expect(text(signedIn.element)).toContain('Signed in');
        expect(text(signedIn.element)).not.toContain('Account needed');
    });

    it('badPath_cloudAiWithoutBillingSendsToTheBillingStep', async () => {
        const { element } = await sources({
            steps: { billing: { state: 'missing' } },
            sources: { choices: { ...DEFAULT_SOURCES, cloudAi: true }, saved: null, finder: FINDER_NONE },
        });

        const link = [...(element.shadowRoot?.querySelectorAll<HTMLAnchorElement>('a.action') ?? [])].find(
            (anchor) => anchor.textContent === 'Open the billing step',
        );
        expect(link?.getAttribute('href')).toBe('#/setup/billing');
    });

    it('badPath_paidScansWaitForTheDeclassifiedFrames_andTheUsgsStepIsLeftOut @S-A180-BAD-USGS-OFF', async () => {
        const off = { ...DEFAULT_SOURCES, usgs: false, landsat: false };
        const { element } = await sources({ sources: { choices: off, saved: off, finder: FINDER_NONE } }, 'ro');

        expect(text(element)).toContain('Porniți întâi fotografiile declasificate');
        expect(text(element)).toContain('pasul contului USGS este lăsat deoparte');
        expect(text(element)).toContain('Salvat: pașii și ecranele urmează această alegere.');
        await expect.element(page.getByRole('switch', { name: 'Scanări plătite ale cadrelor nescanate încă (USGS)' })).toBeDisabled();
        await expect.element(page.getByRole('button', { name: 'Salvați alegerea' })).toBeDisabled();
    });

    it('happyPath_theCollectionsByHandAndWhatIsNotUsable', async () => {
        const { element } = await sources();

        expect(element.shadowRoot?.querySelectorAll('[data-guided]')).toHaveLength(11);
        expect(text(element)).toContain("Facebook's terms forbid collecting its content automatically");
        expect(text(element)).toContain('An automatic import through its official interface is planned, not built yet.');
        await page.getByText('What it gives, pros, cons and costs').first().click();
        expect(text(element)).toContain('Corona: 7.5 m (KH-4)');
    });

    it('happyPath_eachReasonCode', () => {
        expect([
            choiceReason('usgs', true),
            choiceReason('usgs', false),
            choiceReason('cloudAi', true),
            choiceReason('cloudAi', false),
        ]).toEqual(['on_default', 'turned_off', 'turned_on', 'off_default']);
    });
});

describe('<hcm-setup-platform>', () => {
    afterEach(cleanup);

    it('happyPath_fiveSectionsWithTheirStateAndTheirSteps @S-A180-HAPPY-PLATFORM', async () => {
        const { element } = await platform({ steps: { mapbox: { state: 'ok' } } });

        expect(element.shadowRoot?.querySelectorAll('[data-platform]')).toHaveLength(5);
        expect(sectionReady(setupView({ steps: { mapbox: { state: 'ok' } } }), 'mapbox')).toBe(true);
        expect(text(element)).toContain('Firestore: the database');
        const open = [...(element.shadowRoot?.querySelectorAll<HTMLAnchorElement>('a.action') ?? [])].map((anchor) =>
            anchor.getAttribute('href'),
        );
        expect(open).toContain('#/setup/mapbox');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aSectionToDoOffersItsSignUpPage', async () => {
        const { element } = await platform(
            {
                steps: {
                    billing: { state: 'missing' },
                    mapbox: { state: 'missing', links: [{ id: 'mapbox.signup', url: 'https://account.mapbox.com/auth/signup/' }] },
                },
            },
            'ro',
        );

        const external = [...(element.shadowRoot?.querySelectorAll<HTMLAnchorElement>('a.action[target="_blank"]') ?? [])].map(
            (anchor) => anchor.href,
        );
        expect(external).toContain('https://account.mapbox.com/auth/signup/');
        expect(external).toContain('https://console.cloud.google.com/billing/create');
        expect(text(element)).toContain('De făcut în pasul său');
    });

    it('badPath_everySectionToDoOffersItsStepAndFirebaseItsConsole', async () => {
        const missing = { state: 'missing' as const };
        const { element } = await platform({
            steps: {
                signIn: { links: [{ id: 'gcp.firebaseConsole', url: 'https://console.firebase.google.com/' }] },
                ...{ billing: missing, provision: missing, deploy: missing, claim: missing, mapbox: missing },
            },
        });

        const links = [...(element.shadowRoot?.querySelectorAll<HTMLAnchorElement>('a.action') ?? [])].map((anchor) => anchor.href);
        expect(links).toContain('https://console.firebase.google.com/');
        expect(element.shadowRoot?.querySelectorAll('[data-account="needed"]')).toHaveLength(5);
    });
});
