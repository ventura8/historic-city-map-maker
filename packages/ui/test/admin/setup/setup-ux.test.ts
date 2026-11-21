/**
 * The Setup Assistant's M6 setup-ux elements (`docs/research/M6-interfaces.md` §3.1, §4.1; findings 3, 5, 6, 7, 15, 16,
 * 20 and 24 of 2026-10-25): the busy and postponed chips, the consent note only where a popup opens, a count said
 * once, a deep link's hint beside it, the billing card's trial note and its timeout, Do it later on USGS, a disabled
 * service on the provisioning card, the optional server checks apart, and the page's header.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import type { HcmSetupBilling } from '../../../src/admin/setup/hcm-setup-billing.js';
import { defineHcmSetupBilling } from '../../../src/admin/setup/hcm-setup-billing.js';
import type { HcmSetupPage } from '../../../src/admin/setup/hcm-setup-page.js';
import { defineHcmSetupPage } from '../../../src/admin/setup/hcm-setup-page.js';
import type { HcmSetupStep } from '../../../src/admin/setup/hcm-setup-step.js';
import type { SetupStepView } from '../../../src/admin/setup/setup-port.js';
import { cleanup, fixture, nextFrame, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, stepView, type ViewChanges } from './fixtures.js';

defineHcmSetupPage();
defineHcmSetupBilling();

const NOTE = { projectId: 'demo-hcm', domain: 'demo-hcm.firebaseapp.com', amount: '5 USD' };

async function step(view: SetupStepView, noteParams: typeof NOTE | null = NOTE, locale = 'en') {
    return fixture<HcmSetupStep>(
        html`<hcm-setup-step .step=${view} .noteParams=${noteParams} .intents=${new FakeSetupPort().intents} locale=${locale} open
            ><p>body</p></hcm-setup-step
        >`,
    );
}

async function body(tag: string, changes: ViewChanges, locale = 'en') {
    const port = new FakeSetupPort(setupView(changes));
    const view = port.getState();
    const element = await fixture<HTMLElement>(
        tag === 'hcm-setup-usgs'
            ? html`<hcm-setup-usgs .view=${view} .intents=${port.intents} locale=${locale}></hcm-setup-usgs>`
            : html`<hcm-setup-provision .view=${view} .intents=${port.intents} locale=${locale}></hcm-setup-provision>`,
    );
    return { port, element };
}

describe('the frame: chips (findings 6, 16)', () => {
    afterEach(cleanup);

    it('happyPath_aBusyChipHasTheIndicatorInPlaceOfItsIconAndSaysWorking', async () => {
        const element = await step(stepView('provision', { busy: true, state: 'missing' }));
        const chip = shadowPart(element, '.status');

        expect(chip.hasAttribute('data-busy')).toBe(true);
        expect(chip.textContent.trim()).toBe('Working…');
        const indicator = shadowPart(element, '.status hcm-loading-indicator');
        const shape = indicator.shadowRoot?.querySelector('[part="indicator"]')?.getBoundingClientRect();
        const box = indicator.getBoundingClientRect();
        // The shape is drawn inside its 18 px box: it never covers the label beside it.
        expect(box.width).toBe(18);
        expect(shape?.width ?? 99).toBeLessThanOrEqual(18 * 1.42);
        expect(Math.abs((shape?.x ?? 0) + (shape?.width ?? 0) / 2 - (box.x + box.width / 2))).toBeLessThan(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aPostponedStepReadsLaterUntilItIsDone', async () => {
        const later = await step(stepView('usgs', { postponed: true }));
        expect(shadowPart(later, '.status').textContent.trim()).toBe('Later');
        expect(shadowPart(later, '.status').hasAttribute('data-later')).toBe(true);
        cleanup();

        const done = await step(stepView('usgs', { postponed: true, state: 'ok' }));
        expect(shadowPart(done, '.status').textContent.trim()).toBe('Done');
    });
});

describe('the frame: consent note, count and hints (findings 7, 15)', () => {
    afterEach(cleanup);

    it('happyPath_noNoteWhileALiveTokenHoldsTheScopeAndTheCountOnce', async () => {
        const element = await step(
            stepView('deploy', {
                scope: 'cloudPlatform',
                detail: { key: 'adminSetup.deploy.progress', params: { ready: '3', total: '9' } },
            }),
            null,
        );

        expect(element.shadowRoot?.querySelector('hcm-consent-note')).toBeNull();
        expect(element.shadowRoot?.querySelector('.detail')).toBeNull();
    });

    it('badPath_anExpiredTokenPutsTheNoteBesideContinue', async () => {
        const element = await step(stepView('deploy', { scope: 'cloudPlatform', needsContinue: true }));

        const notes = element.shadowRoot?.querySelectorAll('hcm-consent-note') ?? [];
        expect(notes).toHaveLength(1);
        expect(notes[0]?.nextElementSibling?.querySelector('hcm-button')?.textContent).toBe('Continue');
    });

    it('happyPath_aLinkSaysWhatItsPageDoesAndItsAdviceIsBesideIt', async () => {
        const element = await step(
            stepView('mapbox', {
                links: [
                    { id: 'mapbox.signup', url: 'https://account.mapbox.com/auth/signup/' },
                    { id: 'mapbox.console', url: 'https://console.mapbox.com/' },
                ],
            }),
        );

        const consoleLink = page.getByRole('link', { name: /^Open the Mapbox console/ });
        await expect.element(consoleLink).toBeVisible();
        expect(consoleLink.element().textContent.replace('(opens in a new tab)', '')).not.toContain('(');
        expect(shadowPart(element, '[data-hint="mapbox.console"]').textContent).toBe(
            'There, add the payment method under Billing; if Mapbox asks about tokens, choose Rotate token.',
        );
        expect(element.shadowRoot?.querySelectorAll('[data-hint]')).toHaveLength(1);
    });
});

describe('the billing card (findings 3, 18)', () => {
    afterEach(cleanup);

    async function billing(changes: ViewChanges) {
        const port = new FakeSetupPort(setupView({ ...changes, steps: { billing: { state: 'missing', ...changes.steps?.billing } } }));
        return fixture<HcmSetupBilling>(
            html`<hcm-setup-billing .view=${port.getState()} .intents=${port.intents} locale="en"></hcm-setup-billing>`,
        );
    }

    it('happyPath_aLikelyTrialIsSaid', async () => {
        const element = await billing({ billing: { ...setupView().billing, trialSince: '2026-10-12T09:00:00.000Z' } });

        expect(shadowPart(element, '.trial').textContent).toContain('looks like a Google Cloud free trial');
    });

    it('happyPath_theCreatePageIsALinkNotCountedAsAnInput', async () => {
        const port = new FakeSetupPort(
            setupView({ billing: { ...setupView().billing, waitingForAccount: true }, steps: { billing: { state: 'missing' } } }),
        );
        await fixture<HcmSetupBilling>(
            html`<hcm-setup-billing .view=${port.getState()} .intents=${port.intents} locale="en"></hcm-setup-billing>`,
        );
        const create = page.getByRole('link', { name: /Create a billing account/ });
        await expect.element(create).toHaveAttribute('target', '_blank');
        create.element().addEventListener('click', (event) => {
            event.preventDefault();
        });

        await create.click();

        expect(port.calls).toEqual([['followLink', 'billing']]);
    });

    it('happyPath_aLinkedAccountCanBeSaidToBeAFreeTrialInOneClick', async () => {
        // Finding 6 of the M6 review: an account that existed before Setup is never inferred to be a trial.
        const port = new FakeSetupPort(setupView({ steps: { billing: { state: 'ok' } } }));
        await fixture<HcmSetupBilling>(
            html`<hcm-setup-billing .view=${port.getState()} .intents=${port.intents} locale="en"></hcm-setup-billing>`,
        );

        await page.getByRole('button', { name: 'This account is a free trial' }).click();

        expect(port.calls).toEqual([['markTrial']]);
    });

    it('badPath_noTrialButtonBeforeBillingIsLinkedOrOnceATrialIsKnown', async () => {
        const unlinked = await billing({});
        expect(unlinked.renderRoot.querySelector('.mark-trial')).toBeNull();
        cleanup();

        const known = await billing({
            steps: { billing: { state: 'ok' } },
            billing: { ...setupView().billing, trialSince: '2026-10-12T09:00:00.000Z' },
        });
        expect(known.renderRoot.querySelector('.mark-trial')).toBeNull();
        expect(shadowPart(known, '.trial').textContent).toContain('looks like a Google Cloud free trial');
    });

    it('badPath_afterTheWaitTheCreatePageAndTheLinkButtonAreBoth', async () => {
        const element = await billing({ steps: { billing: { detail: { key: 'adminSetup.billing.waitTimeout' } } } });

        await expect.element(page.getByRole('link', { name: /Create a billing account/ })).toBeVisible();
        await expect.element(page.getByRole('button', { name: /Link billing/ })).toBeVisible();
        expect(element.shadowRoot?.querySelector('.waiting')).toBeNull();
    });
});

describe('the USGS card: Do it later (finding 16)', () => {
    afterEach(cleanup);

    it('happyPath_doItLaterIsOneClickAndAPostponedStepSaysWhatItMeans', async () => {
        const { port } = await body('hcm-setup-usgs', { steps: { usgs: { state: 'missing' } } });

        await page.getByRole('button', { name: 'Do it later' }).click();
        expect(port.calls).toEqual([['postponeUsgs']]);
        cleanup();

        const postponed = await body('hcm-setup-usgs', {
            usgs: { ...setupView().usgs, postponedAt: '2026-10-12T09:00:00.000Z' },
        });
        expect(shadowPart(postponed.element, '.postponed').textContent).toContain('Postponed');
        expect(postponed.element.shadowRoot?.querySelector('.later')).toBeNull();
    });

    it('badPath_aDoneStepOffersNoLaterAndAPendingTokenSaysSinceWhen', async () => {
        const done = await body('hcm-setup-usgs', { steps: { usgs: { state: 'ok' } } });
        expect(done.element.shadowRoot?.querySelector('.later')).toBeNull();
        cleanup();

        const pending = await body('hcm-setup-usgs', {
            steps: { usgs: { state: 'pending' } },
            usgs: { ...setupView().usgs, pendingSince: '2026-10-12T09:00:00.000Z' },
        });
        expect(shadowPart(pending.element, '.since').textContent).toBe("Waiting for USGS's approval since 12 Oct 2026.");
    });

    it('badPath_aTokenWaitingForApprovalOffersNoDoItLater', async () => {
        // Finding 8 of the M6 review: Setup is done already; postponing would only turn "waiting since" into "not set up".
        const { element } = await body('hcm-setup-usgs', {
            steps: { usgs: { state: 'pending', detail: { key: 'apiError.usgs.accessPending' } } },
        });

        expect(element.shadowRoot?.querySelector('.later')).toBeNull();
        await expect.element(page.getByRole('button', { name: 'Do it later' })).not.toBeInTheDocument();
    });
});

describe('the provisioning card: a disabled service (finding 5)', () => {
    afterEach(cleanup);

    it('badPath_itsReasonNamesTheButtonOnTheCard', async () => {
        const { element } = await body('hcm-setup-provision', {
            steps: { provision: { state: 'missing' } },
            provision: {
                items: [
                    { id: 'apis', state: 'ok', detail: null },
                    {
                        id: 'service-accounts',
                        state: 'missing',
                        detail: { key: 'apiError.cloud.apiDisabled', params: { api: 'iam.googleapis.com' } },
                    },
                    { id: 'iam', state: 'missing', detail: { key: 'apiError.cloud.apiDisabled' } },
                ],
            },
        });

        const reasons = [...(element.shadowRoot?.querySelectorAll('.reason') ?? [])].map((reason) => reason.textContent);
        expect(reasons).toEqual([
            'The iam.googleapis.com service is not switched on yet. Retry what failed switches it on.',
            'The {api} service is not switched on yet. Retry what failed switches it on.',
        ]);
        await expect.element(page.getByRole('button', { name: 'Retry what failed' })).toBeVisible();
    });
});

describe('the page: header and optional checks (findings 7, 20, 24)', () => {
    afterEach(cleanup);

    async function render(changes: ViewChanges) {
        const element = await fixture<HcmSetupPage>(
            html`<hcm-setup-page .port=${new FakeSetupPort(setupView(changes))} locale="en"></hcm-setup-page>`,
        );
        await nextFrame();
        await element.updateComplete;
        return element;
    }

    it('happyPath_doneWithUsgsLaterIsSaidAndThePostponedStepCountedApart', async () => {
        const element = await render({ ready: true, doneNote: 'usgsLater', later: 1, done: 8, total: 9 });

        expect(shadowPart(element, '.header [role="status"]').textContent).toBe('8 of 9 steps done, 1 for later');
        expect(shadowPart(element, '.ready').textContent).toContain('USGS is left for later');
    });

    it('happyPath_doneWithTheApprovalPendingOrPlainlyDone', async () => {
        const pending = await render({ ready: true, doneNote: 'usgsPending' });
        expect(shadowPart(pending, '.ready').textContent).toContain('once USGS approves M2M access');
        cleanup();

        const done = await render({ ready: true });
        expect(shadowPart(done, '.ready').textContent).toBe('The map is set up: every required step is done.');
    });

    it('happyPath_theConsentNoteOnlyWhereThePopupWouldOpen', async () => {
        const live = await render({
            openStep: 'provision',
            liveScopes: ['cloudPlatform'],
            steps: { provision: { scope: 'cloudPlatform' } },
        });
        const card = (element: HcmSetupPage) => element.shadowRoot?.querySelector<HcmSetupStep>('hcm-setup-step[open]');
        expect(card(live)?.noteParams).toBeNull();
        cleanup();

        const asks = await render({
            openStep: 'provision',
            liveScopes: ['cloudBilling'],
            steps: { provision: { scope: 'cloudPlatform' } },
        });
        expect(card(asks)?.noteParams).toMatchObject({ projectId: 'demo-hcm' });
    });

    it('badPath_aFailingOptionalCheckIsListedApartQuietly', async () => {
        const element = await render({
            ready: true,
            selfTest: {
                checks: [
                    { id: 'firestore', state: 'ok', detail: null },
                    { id: 'ai', state: 'unavailable', detail: { key: 'apiError.internal' } },
                ],
            },
        });

        const optional = shadowPart(element, '[data-check="ai"]');
        expect(optional.hasAttribute('data-optional')).toBe(true);
        expect(optional.textContent).toContain('Translation drafts are off');
        expect(optional.querySelector('hcm-icon')?.getAttribute('name')).toBe('info');
        expect(shadowPart(element, '.checks:not(.optional)').querySelectorAll('[data-check]')).toHaveLength(1);
        expect(shadowPart(element, '.ready').textContent).toContain('every required step is done');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aFixLinkWearsTheKitsRingInTheListsOnColourNotTheBrowsersOwn', async () => {
        const element = await render({ selfTest: { checks: [{ id: 'mapbox', state: 'missing', detail: null }] } });
        const link = shadowPart(element, '[data-check="mapbox"] a.fix');

        const onSurface = document.createElement('span');
        onSurface.style.color = 'var(--md-sys-color-on-surface)';
        shadowPart(element, '.self-test').append(onSurface);
        link.focus({ focusVisible: true });
        const ring = getComputedStyle(link);

        expect(link.matches(':focus-visible')).toBe(true);
        expect(ring.outlineStyle).toBe('solid');
        expect(ring.outlineColor).toBe(getComputedStyle(onSurface).color);
    });

    it('happyPath_aWorkingOptionalCheckShowsItsName', async () => {
        const element = await render({ selfTest: { checks: [{ id: 'ai', state: 'ok', detail: null }] } });

        expect(shadowPart(element, '[data-check="ai"]').textContent).toContain('Translation drafts (Vertex AI)');
        expect(shadowPart(element, '[data-check="ai"]').querySelector('[data-model]')).toBeNull();
    });

    it('happyPath_aWorkingAiCheckNamesTheModelInUse', async () => {
        const element = await render({ selfTest: { checks: [{ id: 'ai', state: 'ok', detail: null, model: 'gemini-3.1-flash-lite' }] } });

        expect(shadowPart(element, '[data-check="ai"] [data-model]').textContent).toBe('Model in use: gemini-3.1-flash-lite');
    });
});
