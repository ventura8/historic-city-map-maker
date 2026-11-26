import { axeViolations } from '@hcm/test-support/axe';
import { FUNNEL_EVENT, type FunnelSignal } from '@hcm/shared/funnels';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import type { HcmSetupPage } from '../../../src/admin/setup/hcm-setup-page.js';
import { defineHcmSetupPage } from '../../../src/admin/setup/hcm-setup-page.js';
import type { HcmSetupStep } from '../../../src/admin/setup/hcm-setup-step.js';
import { cleanup, fixture, nextFrame, shadowPart } from '../../helpers.js';
import { FakeSetupPort, STEP_IDS, setupView, type ViewChanges } from './fixtures.js';
import { installSliceView, type InstallChanges } from './install-fixtures.js';

defineHcmSetupPage();

/** The themed container the fixture rendered into (its width is the page's). */
function hostOf(element: HcmSetupPage): HTMLElement {
    const host = element.parentElement;
    if (host === null) {
        throw new Error('the page has no host');
    }
    return host;
}

async function render(port: FakeSetupPort | null, width = 480, locale = 'ro') {
    const element = await fixture<HcmSetupPage>(html`<hcm-setup-page .port=${port} locale=${locale}></hcm-setup-page>`);
    hostOf(element).style.width = `${String(width)}px`;
    await nextFrame();
    await nextFrame();
    await nextFrame();
    await element.updateComplete;
    return element;
}

function steps(element: HcmSetupPage): HcmSetupStep[] {
    return [...element.renderRoot.querySelectorAll<HcmSetupStep>('hcm-setup-step')];
}

describe('<hcm-setup-page> one column', () => {
    afterEach(cleanup);

    it('badPath_theSelfTestsChecksAreListedAFailingOneWithItsReasonAndItsStep', async () => {
        const checks = [
            { id: 'firestore', state: 'ok', detail: null },
            { id: 'secrets', state: 'unavailable', detail: { key: 'apiError.secrets.unavailable' } },
            { id: 'error-reporting', state: 'invalid', detail: { key: 'apiError.errorReporting.unavailable' } },
        ] as const;
        const port = new FakeSetupPort(setupView({ selfTest: { checks } }));
        const element = await render(port, 480, 'en');

        const rows = [...element.renderRoot.querySelectorAll<HTMLElement>('.check')];
        expect(rows.map((row) => [row.dataset['check'], row.dataset['state']])).toEqual([
            ['firestore', 'ok'],
            ['secrets', 'unavailable'],
            ['error-reporting', 'invalid'],
        ]);
        expect(rows[0]?.querySelector('a')).toBeNull();
        expect(rows[1]?.querySelector('.reason')?.textContent).not.toBe('');
        expect(rows[1]?.querySelector('a')?.getAttribute('href')).toBe('#/setup/provision');
        expect(rows[2]?.querySelector('a')?.getAttribute('href')).toBe('#/setup/analytics');
        await expect.element(page.getByRole('heading', { level: 2, name: 'Server checks' })).toBeVisible();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_noSelfTestYetListsNoCheck', async () => {
        const element = await render(new FakeSetupPort());

        expect(element.renderRoot.querySelector('.self-test')).toBeNull();
    });

    it('happyPath_theProgressRingAndOneCardPerStepTheOpenOneExpanded', async () => {
        const port = new FakeSetupPort();
        const element = await render(port);

        await expect.element(page.getByRole('heading', { level: 1, name: 'Configurare' })).toBeVisible();
        await expect.element(page.getByRole('progressbar', { name: '5 din 9 pași gata' })).toHaveAttribute('aria-valuenow', '56');
        expect(steps(element).map((step) => step.step?.id)).toEqual(STEP_IDS);
        expect(
            steps(element)
                .filter((step) => step.open)
                .map((step) => step.mode),
        ).toEqual(['inline']);
        expect(element.renderRoot.querySelector('hcm-setup-mapbox')).not.toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_followsTheControllerAndCarriesTheInputTotals', async () => {
        const port = new FakeSetupPort();
        const element = await render(port);

        port.set({ openStep: 'billing', used: { inputs: 4, consents: 2 }, ready: true });
        await element.updateComplete;

        expect(element.renderRoot.querySelector('hcm-setup-billing')).not.toBeNull();
        expect(element.renderRoot.querySelector('hcm-setup-mapbox')).toBeNull();
        expect({ inputs: element.dataset['inputs'], consents: element.dataset['consents'] }).toEqual({ inputs: '4', consents: '2' });
        expect(shadowPart(element, '.ready').textContent).toBe('Harta este configurată: toți pașii obligatorii sunt gata.');
    });

    it('happyPath_checkAgainChecksTheWholePage', async () => {
        const port = new FakeSetupPort();
        await render(port);

        await page.getByRole('button', { name: 'Verifică din nou' }).first().click();

        expect(port.calls).toEqual([['recheck']]);
    });

    it('badPath_aRunningCheckAndAPageFailureAreShown', async () => {
        const port = new FakeSetupPort(setupView({ checking: true, error: { key: 'apiError.unavailable' }, openStep: null }));
        const element = await render(port, 480, 'en');

        expect(shadowPart(element, '[role="status"]').textContent).toBe('Checking every step…');
        expect(shadowPart(element, '[role="alert"]').textContent).toContain('The service is unavailable right now.');
        expect(steps(element).some((step) => step.open)).toBe(false);
    });

    it('happyPath_rightAfterAReloadTheHeaderSaysCheckingWithoutACount', async () => {
        // Finding 32 of 2026-10-31: "0 of 11 steps done" while the first checks had not answered.
        const port = new FakeSetupPort(setupView({ loading: true, done: 0, openStep: null }));
        const element = await render(port, 480, 'en');

        const status = shadowPart(element, '.note[role="status"]');
        expect(status.textContent).toBe('Checking every step…');
        expect(status.hasAttribute('data-loading')).toBe(true);
        await expect.element(page.getByRole('progressbar', { name: 'Checking every step…' })).not.toHaveAttribute('aria-valuenow');
        expect(element.renderRoot.querySelector('.count')).toBeNull();
        await expect.element(page.getByRole('button', { name: 'Check again' }).first()).toBeDisabled();
        expect(await axeViolations(element)).toEqual([]);

        port.set({ loading: false, done: 5 });
        await element.updateComplete;
        expect(shadowPart(element, '.note[role="status"]').textContent).toBe('5 of 9 steps done');
        expect(shadowPart(element, '.count').textContent).toBe('5/9');
    });

    it('happyPath_everyStepOpensWithItsOwnBody', async () => {
        const port = new FakeSetupPort();
        const element = await render(port);
        const bodies = {
            billing: 'hcm-setup-billing',
            provision: 'hcm-setup-provision',
            deploy: 'hcm-setup-deploy',
            mapbox: 'hcm-setup-mapbox',
            platform: 'hcm-setup-platform',
            sources: 'hcm-setup-sources',
            usgs: 'hcm-setup-usgs',
            analytics: 'hcm-setup-analytics',
            legacyImport: 'hcm-setup-import',
        } as const;

        for (const [step, tag] of Object.entries(bodies)) {
            port.set({ openStep: step as keyof typeof bodies, order: [...STEP_IDS, 'platform', 'sources'] });
            await element.updateComplete;
            const open = steps(element).find((card) => card.open);
            expect(open?.firstElementChild?.localName).toBe(tag);
        }
    });

    it('happyPath_aStepWithoutABodyOpensWithItsTextsOnly', async () => {
        const element = await render(new FakeSetupPort(setupView({ openStep: 'claim' })));

        const claim = steps(element).find((step) => step.step?.id === 'claim');
        expect(claim?.open).toBe(true);
        expect(claim?.children).toHaveLength(0);
    });
});

describe('<hcm-setup-page> list and detail', () => {
    afterEach(cleanup);

    it('happyPath_anExpandedWindowShowsTheListBesideTheOpenStep', async () => {
        const element = await render(new FakeSetupPort(), 1000);

        expect(element.getAttribute('window-class')).toBe('expanded');
        expect(steps(element).filter((step) => step.mode === 'summary')).toHaveLength(9);
        const detail = steps(element).find((step) => step.mode === 'detail');
        expect(detail?.step?.id).toBe('mapbox');
        expect(detail?.querySelector('hcm-setup-mapbox')).not.toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_noOpenStepLeavesTheDetailEmpty', async () => {
        const element = await render(new FakeSetupPort(setupView({ openStep: null })), 1300);

        expect(steps(element).some((step) => step.mode === 'detail')).toBe(false);
    });
});

describe('<hcm-setup-page> controller', () => {
    afterEach(cleanup);

    it('happyPath_theShellsOutletGivesTheStateTheIntentsAndTheLanguage', async () => {
        const port = new FakeSetupPort();
        const element = await fixture<HcmSetupPage>(
            html`<hcm-setup-page
                .app=${{ intents: { setup: port.intents } }}
                .state=${{ locale: 'en', setup: port.getState() }}
            ></hcm-setup-page>`,
        );

        await expect.element(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
        await page.getByRole('button', { name: 'Check again' }).first().click();
        expect(port.calls).toEqual([['recheck']]);

        element.state = { locale: 'ro', setup: setupView({ done: 9 }) };
        await element.updateComplete;
        await expect.element(page.getByRole('progressbar', { name: '9 din 9 pași gata' })).toBeVisible();
    });

    it('badPath_anOutletStateWithoutTheSetupShowsNothingYet', async () => {
        const element = await fixture<HcmSetupPage>(
            html`<hcm-setup-page .app=${{ intents: {} }} .state=${{ locale: 'en' }}></hcm-setup-page>`,
        );

        expect(element.renderRoot.querySelector('section')).toBeNull();
    });

    it('badPath_noControllerRendersNothing', async () => {
        const element = await render(null);

        expect(element.renderRoot.querySelector('section')).toBeNull();
        expect(element.dataset['inputs']).toBeUndefined();
    });

    it('badPath_aNewControllerReplacesTheOldSubscription', async () => {
        const first = new FakeSetupPort();
        const second = new FakeSetupPort(setupView({ done: 9, openStep: null }));
        const element = await render(first);

        element.port = second;
        await element.updateComplete;

        expect(first.listening()).toBe(0);
        expect(second.listening()).toBe(1);
        await expect.element(page.getByRole('progressbar', { name: '9 din 9 pași gata' })).toBeVisible();
        element.port = null;
        await element.updateComplete;
        expect(second.listening()).toBe(0);
        expect(element.renderRoot.querySelector('section')).toBeNull();
    });
});

describe('<hcm-setup-page> the consent note on an install card (finding 40 of 2026-11-01)', () => {
    afterEach(cleanup);

    /** The open server card's note, without a live token: the card's state decides whether a button asks Google. */
    async function deployNote(install: InstallChanges, deploy: NonNullable<ViewChanges['steps']>['deploy'] = {}): Promise<Element | null> {
        const changes: ViewChanges = {
            openStep: 'deploy',
            install: installSliceView(install),
            steps: { deploy: { scope: 'cloudPlatform', state: 'ok', ...deploy } },
        };
        const element = await render(new FakeSetupPort(setupView(changes)), 480, 'en');
        const card = steps(element).find((step) => step.step?.id === 'deploy');
        return card?.renderRoot.querySelector('hcm-consent-note') ?? null;
    }

    it('badPath_anInstalledServerWithNothingToDoShowsNoNote', async () => {
        expect(
            await deployNote({ server: { state: 'installed', installedRelease: '1.0.0+abc1234', checkedAt: '2026-11-01T09:00:00Z' } }),
        ).toBeNull();
        cleanup();
        expect(await deployNote({ server: { state: 'working', checkedAt: '2026-11-01T09:00:00Z' } })).toBeNull();
        cleanup();
        // The live finding of 2026-11-12: a newer server offers Install this admin's version anyway, which asks Google.
        expect(await deployNote({ server: { state: 'newerInstalled', checkedAt: '2026-11-01T09:00:00Z' } })).not.toBeNull();
    });

    it('happyPath_theNoteComesWithUpdateTheMap_TryAgain_AFirstInstall_orContinue', async () => {
        expect(await deployNote({ server: { state: 'updateAvailable', checkedAt: '2026-11-01T09:00:00Z' } })).not.toBeNull();
        cleanup();
        expect(await deployNote({ server: { state: 'failed', checkedAt: '2026-11-01T09:00:00Z' } })).not.toBeNull();
        cleanup();
        expect(await deployNote({}, { state: 'missing' })).not.toBeNull();
        cleanup();
        // A check that needs the token: Continue, the note beside it.
        expect(
            await deployNote({ server: { state: 'installed', checkedAt: '2026-11-01T09:00:00Z' } }, { needsContinue: true }),
        ).not.toBeNull();
    });
});

describe('<hcm-setup-page> funnel', () => {
    afterEach(cleanup);

    it('happyPath_theOpenCardAMoveBackAndAGuideLinkAreSignalled', async () => {
        // @S-A150-HAPPY-FUNNEL-ORDER: the Setup Assistant's cards as funnel steps.
        const seen: FunnelSignal[] = [];
        const listen = (event: Event): void => {
            seen.push((event as CustomEvent<FunnelSignal>).detail);
        };
        document.addEventListener(FUNNEL_EVENT, listen);
        const port = new FakeSetupPort(setupView({ openStep: 'mapbox' }));
        const element = await render(port);
        port.set({ openStep: 'billing' });
        await element.updateComplete;
        const link = document.createElement('a');
        link.target = '_blank';
        element.renderRoot.querySelector('section')?.append(link);
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
        document.removeEventListener(FUNNEL_EVENT, listen);
        expect(seen).toEqual([
            { kind: 'view', wizard: 'setup', step: 'mapbox', back: false },
            { kind: 'view', wizard: 'setup', step: 'billing', back: true },
            { kind: 'help', wizard: 'setup', step: 'billing' },
        ]);
    });
});
