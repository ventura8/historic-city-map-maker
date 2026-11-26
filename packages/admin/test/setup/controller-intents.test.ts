// The controller's intents as the elements call them, and the follow-ups of a change (S-A30 budgets, A26 watch).
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createSetupController } from '../../src/setup/controller.js';
import { SETUP_STEP_SPECS } from '../../src/setup/steps.js';
import { createHarness, flush, googleError } from './harness.js';

const CHECKED = '2026-10-12T09:00:00.000Z';
const MINTED = { tokenId: 'cl0000000000000000000000a', allowedUrls: ['https://ventura8.github.io'] };

async function started(mode: 'bootstrap' | 'normal') {
    const harness = createHarness();
    const controller = createSetupController(harness.deps);
    await controller.start(mode, null);
    return { harness, controller };
}

describe('intents: navigation and inputs', () => {
    it('happyPath_openExpandsACardAndNullCollapsesThem', async () => {
        const { controller } = await started('bootstrap');

        controller.intents.open('usgs');
        expect(controller.getState().openStep).toBe('usgs');
        controller.intents.open(null);
        expect(controller.getState().openStep).toBeNull();
        expect(controller.getState().used).toEqual({ inputs: 0, consents: 0 });
    });

    it('happyPath_aFillOrPasteTheElementSawIsCounted', async () => {
        const { controller } = await started('normal');

        controller.intents.noteInput('usgs');

        expect(controller.getState().steps.usgs.used.inputs).toBe(1);
    });

    it('happyPath_theBootstrapHappyPathStaysWithinItsBudget', async () => {
        const { harness, controller } = await started('bootstrap');
        harness.cloud.observeBilling.mockResolvedValue({
            linkedAccount: null,
            accounts: [{ name: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', displayName: 'Card', currency: 'USD' }],
        });
        harness.cloud.provision.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            return Promise.resolve([]);
        });
        harness.cloud.doctor.mockResolvedValue([]);

        await controller.intents.linkBilling();
        await flush();
        await controller.intents.provision();
        await flush();

        const { steps } = controller.getState();
        expect(steps.billing.used).toEqual({ inputs: SETUP_STEP_SPECS.billing.inputs, consents: SETUP_STEP_SPECS.billing.consents });
        expect(steps.provision.used).toEqual({ inputs: SETUP_STEP_SPECS.provision.inputs, consents: SETUP_STEP_SPECS.provision.consents });
        expect(harness.google.requests).toEqual(['cloudBilling', 'cloudPlatform']);
        controller.dispose();
    });
});

describe('intents: continue after an expired token', () => {
    it('happyPath_continueResumesTheStepWithOneConsent', async () => {
        const { harness, controller } = await started('bootstrap');
        harness.cloud.provision.mockRejectedValueOnce(googleError('unauthorized'));

        await controller.intents.provision();
        await flush();
        expect(controller.getState().steps.provision.needsContinue).toBe(true);

        await controller.intents.continueGoogle('provision');
        await flush();

        expect(harness.cloud.provision).toHaveBeenCalledTimes(2);
        expect(controller.getState().steps.provision.needsContinue).toBe(false);
    });

    it('happyPath_continueOnBillingAndDeploymentRunsTheirOwnChecks', async () => {
        const { harness, controller } = await started('bootstrap');

        await controller.intents.continueGoogle('billing');
        await flush();
        await controller.intents.continueGoogle('deploy');
        await flush();

        expect(harness.cloud.observeBilling).toHaveBeenCalledTimes(1);
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        controller.dispose();
    });

    it('badPath_aStepWithoutAGoogleActionOnlyClearsTheFlag', async () => {
        const { controller } = await started('normal');

        await controller.intents.continueGoogle('analytics');
        await flush();

        expect(controller.getState().steps.analytics).toMatchObject({ needsContinue: false, error: null });
    });
});

describe('intents: every card', () => {
    it('happyPath_billingChoiceIntentsReachTheBillingFlow', async () => {
        const { harness, controller } = await started('bootstrap');
        harness.cloud.observeBilling.mockResolvedValue({
            linkedAccount: null,
            accounts: [
                { name: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', displayName: 'A', currency: 'USD' },
                { name: 'billingAccounts/DDDDDD-EEEEEE-FFFFFF', displayName: 'B', currency: 'EUR' },
            ],
        });

        await controller.intents.linkBilling();
        await flush();
        controller.intents.chooseBillingAccount('billingAccounts/DDDDDD-EEEEEE-FFFFFF');
        await controller.intents.confirmBillingAccount();
        await flush();

        expect(harness.cloud.linkBilling).toHaveBeenCalledWith(harness.google.current, 'billingAccounts/DDDDDD-EEEEEE-FFFFFF');
    });

    it('happyPath_aFreeTrialSaidOnTheBillingCardReachesTheBillingFlow', async () => {
        const { controller } = await started('bootstrap');

        await controller.intents.markTrial();

        expect(controller.getState().billing.trialSince).not.toBeNull();
        expect(controller.getState().steps.billing.used.inputs).toBe(1);
    });

    it('happyPath_credentialIntentsReachTheirCallables', async () => {
        const { harness, controller } = await started('normal');
        harness.backend.saveMapbox.mockResolvedValue({ mapbox: { state: 'ok', checkedAt: CHECKED }, viewer: MINTED, admin: MINTED });
        harness.backend.saveUsgs.mockResolvedValue({ usgs: { state: 'ok', checkedAt: CHECKED, role: 'download' } });

        await controller.intents.saveMapbox(MAPBOX_TOKENS.bootstrap);
        harness.backend.rotatePublicToken.mockResolvedValue({
            tokenId: 'cl0000000000000000000000c',
            retiresOldAt: null,
            manifestQueued: false,
        });
        await controller.intents.rotatePublicToken('admin');
        expect(controller.getState().mapbox.rotation).toMatchObject({ audience: 'admin', done: true, retiresOldAt: null });
        controller.intents.draftUsgs({ username: 'e2e-ok' });
        controller.intents.draftUsgs({ expiresOn: '2027-10-12' });
        expect(controller.getState().usgs).toMatchObject({ username: 'e2e-ok', expiresOn: '2027-10-12' });
        controller.intents.startUsgsCountdown();
        expect(controller.getState().usgs.secondsLeft).toBe(60);
        await controller.intents.saveUsgs({ ...USGS_CREDENTIALS.approved });
        await flush();

        expect(controller.getState().steps.mapbox.state).toBe('ok');
        expect(controller.getState().steps.usgs.state).toBe('ok');
    });

    it('happyPath_analyticsIntentsReachTheAnalyticsFlow', async () => {
        const { harness, controller } = await started('normal');

        controller.intents.followLink('billing');
        expect(controller.getState().analytics.watching).toBe(false);
        controller.intents.followLink('analytics');
        expect(controller.getState().analytics.watching).toBe(true);
        await controller.intents.disableHistoryPageViews();
        await flush();
        await controller.intents.createMeasurementReports();
        await flush();
        await controller.intents.setCrashEmails(false);
        await flush();
        await controller.intents.enableApi('clouderrorreporting.googleapis.com');
        await flush();
        await controller.intents.loadCrashGroups();
        await flush();

        expect(controller.getState().analytics).toMatchObject({ pageChangesOff: true, crashEmails: false });
        expect(harness.cloud.enableApis).toHaveBeenCalledTimes(1);
        expect(harness.backend.listGroups).toHaveBeenCalledTimes(2);
        controller.dispose();
    });

    it('happyPath_theImportIntentRunsTheImport', async () => {
        const { harness, controller } = await started('normal');

        await controller.intents.importLegacy();
        await flush();

        expect(harness.importer.run).toHaveBeenCalledTimes(1);
        expect(controller.getState().steps.legacyImport.state).toBe('ok');
    });
});

describe('follow-ups of a change', () => {
    it('happyPath_openingTheAnalyticsCardDetectsTheMeasurementId', async () => {
        const { harness, controller } = await started('normal');

        controller.intents.open('analytics');
        controller.intents.open('analytics');
        await flush();

        expect(harness.backend.analyticsConfig).toHaveBeenCalledTimes(1);
    });

    it('happyPath_provisioningDoneInBootstrapModeStartsWatchingTheDeployment', async () => {
        const { harness, controller } = await started('bootstrap');
        harness.cloud.provision.mockImplementation((_access, _only, onItem) => {
            for (const id of [
                'apis',
                'service-accounts',
                'iam',
                'buckets',
                // M6 (CR-M6-2): the pipeline's repository.
                'artifact-registry',
                'bucket-cors',
                'bucket-lifecycle',
                'secrets',
                'task-queues',
            ] as const) {
                onItem({ id, state: 'ok' });
            }
            for (const id of [
                'workload-identity',
                'app-check',
                'budget-alerts',
                'org-policies',
                'crash-alerts',
                'api-key',
                'admin-site',
            ] as const) {
                onItem({ id, state: 'ok' });
            }
            onItem({ id: 'scheduler', state: 'pending' });
            return Promise.resolve([]);
        });

        await controller.intents.provision();
        await flush();

        expect(controller.getState().steps.provision.state).toBe('ok');
        expect(controller.getState().deploy.watching).toBe(true);
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        controller.dispose();
        expect(harness.clock.pending()).toBe(0);
        expect(harness.visibility.listening()).toBe(0);
    });

    it('happyPath_theDeploymentDoneChecksTheSchedulerWithTheLiveToken', async () => {
        const { harness, controller } = await started('bootstrap');
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockResolvedValue({ ready: 32, total: 32, failed: [] });

        await controller.intents.recheck('deploy');
        await flush();

        expect(controller.getState().steps.deploy.state).toBe('ok');
        expect(harness.cloud.doctor).toHaveBeenCalledWith(harness.google.current, ['scheduler'], expect.any(Function));
    });
});

describe('intents: the install cards through the controller', () => {
    it('happyPath_recheckAndContinueOnPipelineAndSiteAskTheInstallerAgain', async () => {
        const { harness, controller } = await started('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockClear();

        await controller.intents.recheck('pipeline');
        await controller.intents.recheck('site');
        await controller.intents.continueGoogle('pipeline');
        await controller.intents.continueGoogle('site');
        await flush();

        const targets = harness.installer.observe.mock.calls.map(([target]) => target);
        expect(targets.filter((target) => target === 'pipeline').length).toBeGreaterThanOrEqual(2);
        expect(targets.filter((target) => target === 'site').length).toBeGreaterThanOrEqual(2);
        controller.dispose();
    });

    it('happyPath_installUpdateAndInstallOverReachTheInstallCards', async () => {
        const { harness, controller } = await started('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockClear();

        await controller.intents.install('site');
        await controller.intents.updateMap('pipeline');
        await controller.intents.installOver('server');
        await controller.intents.postponeUsgs();
        await flush();

        expect(harness.installer.observe.mock.calls.length + harness.installer.submit.mock.calls.length).toBeGreaterThan(0);
        controller.dispose();
    });
});
