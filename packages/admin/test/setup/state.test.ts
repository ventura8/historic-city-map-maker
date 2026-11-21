import { BACKGROUND_FUNCTIONS, CALLABLES, HTTP_ENDPOINTS, MAPBOX_BOOTSTRAP_SCOPES, PROVISION_ITEMS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    REGISTRY_FUNCTION_COUNT,
    initialSetupState,
    provisionHealth,
    refreshDerived,
    resumeStep,
    serverPrepared,
    withCount,
    withStep,
    worstState,
    type SetupState,
} from '../../src/setup/state.js';
import { SETUP_STEPS, type SetupStepId } from '../../src/setup/steps.js';
import { createHarness } from './harness.js';

function done(state: SetupState, ...ids: SetupStepId[]): SetupState {
    return ids.reduce((current, id) => withStep(current, id, { state: 'ok' }), state);
}

describe('initialSetupState of a project of the owner own (CR-M5-7, M14)', () => {
    it('happyPath_noGithubVariablesAndNoOldPhotosToImport', () => {
        const state = initialSetupState({ ...createHarness().host, github: false }, 'bootstrap');
        expect(state.deploy.variables).toEqual([]);
        expect(state.order).not.toContain('legacyImport');
        expect(state.total).toBe(state.order.length);
        expect(state.steps.legacyImport).toBeDefined();
    });
});

describe('initialSetupState', () => {
    it('happyPath_everyStepStartsToDoWithItsLinksAndBudget', () => {
        const state = initialSetupState(createHarness().host, 'bootstrap');

        expect(state.order).toEqual(SETUP_STEPS);
        expect(SETUP_STEPS.map((id) => state.steps[id].state)).toEqual(SETUP_STEPS.map(() => 'missing'));
        expect(state.steps.billing.links.map((link) => link.id)).toEqual(['gcp.billingAccounts', 'gcp.blazeUpgrade']);
        expect(state.steps.usgs.budget).toEqual({ inputs: 3, consents: 0 });
        expect(state.steps.billing.scope).toBe('cloudBilling');
        // Sign-in and the claim ask Google from the shell's panels, never from their cards.
        expect([state.steps.signIn.scope, state.steps.claim.scope, state.steps.mapbox.scope]).toEqual([null, null, null]);
        expect({ done: state.done, total: state.total, ready: state.ready }).toEqual({ done: 0, total: 13, ready: false });
    });

    it('happyPath_theCardsKnowTheProjectBeforeAnyCheck', () => {
        const state = initialSetupState(createHarness().host, 'bootstrap');

        expect(state.billing).toMatchObject({ amount: 5, currency: 'USD' });
        expect(state.provision.items.map((item) => item.id)).toEqual(PROVISION_ITEMS);
        expect(state.deploy.variables).toEqual([
            {
                name: 'GCP_WIF_PROVIDER',
                value: 'projects/123456789012/locations/global/workloadIdentityPools/github/providers/site-master',
            },
            { name: 'GCP_DEPLOY_SA', value: 'gh-deployer@demo-hcm.iam.gserviceaccount.com' },
            { name: 'GCP_PROJECT_ID', value: 'demo-hcm' },
            { name: 'DEPLOY_ENABLED', value: 'true' },
        ]);
        expect(state.deploy.total).toBe(REGISTRY_FUNCTION_COUNT);
        expect(state.mapbox.requiredScopes).toEqual(MAPBOX_BOOTSTRAP_SCOPES);
        expect(state.usgs).toMatchObject({
            area: '25.9600, 44.3300, 26.2300, 44.5400',
            tokenPageUrl: 'https://ers.cr.usgs.gov/password/appgenerate',
        });
    });

    it('badPath_aCityWithoutBoundsHasNoArea', () => {
        const host = { ...createHarness().host, cityBBox: null };

        expect(initialSetupState(host, 'normal').usgs.area).toBeNull();
    });

    it('happyPath_theRegistryCountIsEveryFunction', () => {
        const count = Object.keys(CALLABLES).length + Object.keys(HTTP_ENDPOINTS).length + Object.keys(BACKGROUND_FUNCTIONS).length;

        expect(REGISTRY_FUNCTION_COUNT).toBe(count);
    });
});

describe('availability', () => {
    it('happyPath_bootstrapOpensOnlyTheStepsWithoutServer', () => {
        const state = done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn', 'billing', 'provision', 'deploy');

        // The imagery pipeline (d3, M6) installs before the server answers: it needs Google only.
        // M28: so does the platform card, which only reads the other steps.
        expect(SETUP_STEPS.filter((id) => state.steps[id].available)).toEqual([
            'signIn',
            'billing',
            'provision',
            'deploy',
            'pipeline',
            'platform',
        ]);
    });

    it('happyPath_normalModeOpensEveryStepWhosePrerequisitesAreDone', () => {
        const state = done(initialSetupState(createHarness().host, 'normal'), 'signIn', 'billing', 'provision', 'deploy', 'claim');

        expect(SETUP_STEPS.every((id) => state.steps[id].available)).toBe(true);
        expect(state.done).toBe(5);
    });

    it('badPath_aStepWaitsForItsPrerequisite', () => {
        const state = initialSetupState(createHarness().host, 'normal');

        expect(state.steps.billing.available).toBe(false);
        expect(refreshDerived(done(state, 'signIn')).steps.billing.available).toBe(true);
    });

    it('happyPath_anItemOnlyTheImageryPipelineNeedsDoesNotHoldTheServerBack @S-A55-HAPPY-PIPELINE-ITEM-FAILED', () => {
        // Finding 31 of 2026-10-31: the repository `hcm` failed; every item the server needs is done.
        const base = done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn', 'billing');
        const items = PROVISION_ITEMS.map((id) => ({
            id,
            state: id === 'artifact-registry' ? ('invalid' as const) : ('ok' as const),
            detail: null,
        }));
        const state = withStep({ ...base, provision: { items } }, 'provision', { state: 'invalid' });

        expect(serverPrepared(state)).toBe(true);
        expect(state.steps.provision.state).toBe('invalid');
        expect([state.steps.deploy.available, state.steps.pipeline.available]).toEqual([true, true]);
        expect(state.ready).toBe(false);
    });

    it('badPath_anItemTheServerNeedsKeepsStepDWaiting @S-A55-BAD-SERVER-ITEM-FAILED', () => {
        const base = done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn', 'billing');
        const items = PROVISION_ITEMS.map((id) => ({
            id,
            state: id === 'secrets' ? ('unavailable' as const) : ('ok' as const),
            detail: null,
        }));
        const state = withStep({ ...base, provision: { items } }, 'provision', { state: 'unavailable' });

        expect(serverPrepared(state)).toBe(false);
        expect([state.steps.deploy.available, state.steps.pipeline.available]).toEqual([false, false]);
        // Nothing checked yet: every item is to do, so nothing is prepared.
        expect(serverPrepared(base)).toBe(false);
    });

    it('happyPath_readyNeedsBillingProvisioningMapboxAndUsgs', () => {
        const base = initialSetupState(createHarness().host, 'normal');

        expect(done(base, 'billing', 'provision', 'mapbox').ready).toBe(false);
        expect(done(base, 'billing', 'provision', 'mapbox', 'usgs').ready).toBe(true);
    });

    it('badPath_inStartUpModeAnOlderServerLeavesTheStepsItRecordsUnknown', () => {
        // Finding 27 of 2026-10-31: the install card reads the server as an update; what it recorded is not "To do".
        const base = done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn', 'billing', 'provision');
        const older = refreshDerived({
            ...base,
            install: { ...base.install, server: { ...base.install.server, state: 'updateAvailable' } },
        });

        expect(SETUP_STEPS.filter((id) => older.steps[id].unknown)).toEqual([
            'deploy',
            'claim',
            'mapbox',
            'usgs',
            'analytics',
            'legacyImport',
        ]);
        expect(SETUP_STEPS.some((id) => base.steps[id].unknown)).toBe(false);
        // A step a check has seen is what the check said.
        expect(withStep(older, 'deploy', { state: 'pending', checkedAt: '2026-10-31T10:00:00.000Z' }).steps.deploy.unknown).toBe(false);
    });

    it('badPath_aServerOrSiteSeenNotInstalledHoldsReadyBack', () => {
        // M6 §4.1 (CR-M6-13): Setup is done with the server and the public map installed; a target nothing has looked at
        // yet (a map from before M6) does not hold it back, as `setupDone` reads a `setup/status` without `install`.
        const base = done(initialSetupState(createHarness().host, 'normal'), 'billing', 'provision', 'mapbox', 'usgs');
        const seen = (state: string) =>
            ({ ...base.install.site, state, checkedAt: '2026-10-30T09:00:00.000Z' }) as typeof base.install.site;

        expect(refreshDerived({ ...base, install: { ...base.install, site: seen('notInstalled') } }).ready).toBe(false);
        expect(refreshDerived({ ...base, install: { ...base.install, site: seen('updateAvailable') } }).ready).toBe(true);
        expect(refreshDerived({ ...base, install: { ...base.install, server: { ...seen('failed'), target: 'server' } } }).ready).toBe(
            false,
        );
    });

    it('happyPath_anUpdateUnderWayKeepsReadyWhileAReleaseIsInstalled', () => {
        // Finding 5 of the M6 review, as `setupDone` reads it: the installed release serves while its update runs or stops.
        const base = done(initialSetupState(createHarness().host, 'normal'), 'billing', 'provision', 'mapbox', 'usgs');
        const server = (state: string) =>
            ({
                ...base.install.server,
                state,
                installedRelease: '0.9.0+0000000',
                checkedAt: '2026-10-30T09:00:00.000Z',
            }) as typeof base.install.server;

        expect(refreshDerived({ ...base, install: { ...base.install, server: server('working') } }).ready).toBe(true);
        expect(refreshDerived({ ...base, install: { ...base.install, server: server('failed') } }).ready).toBe(true);
    });
});

describe('withStep and withCount', () => {
    it('badPath_aGreenAnalyticsCardStaysOpenUntilItsStreamSettingIsDone', () => {
        const base = {
            ...done(initialSetupState(createHarness().host, 'normal'), 'signIn', 'billing', 'provision', 'deploy', 'claim'),
            openStep: 'analytics' as const,
        };

        expect(withStep(base, 'analytics', { state: 'ok' }).openStep).toBe('analytics');
        const streamOff = { ...base, analytics: { ...base.analytics, pageChangesOff: true } };
        expect(withStep(streamOff, 'analytics', { state: 'ok' }).openStep).not.toBe('analytics');
    });
    it('happyPath_theOpenStepHandsOverWhenItTurnsOk', () => {
        const state = { ...done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn'), openStep: 'billing' as const };

        expect(withStep(state, 'billing', { state: 'ok' }).openStep).toBe('provision');
    });

    it('badPath_anotherStepTurningOkLeavesTheOpenOneAlone', () => {
        const state = { ...initialSetupState(createHarness().host, 'bootstrap'), openStep: 'usgs' as const };

        expect(withStep(state, 'signIn', { state: 'ok' }).openStep).toBe('usgs');
        expect(withStep(done(state, 'billing'), 'billing', { state: 'ok', busy: false }).openStep).toBe('usgs');
    });

    it('happyPath_inputsAndConsentsAddUpPerStepAndInTotal', () => {
        let state = initialSetupState(createHarness().host, 'bootstrap');
        state = withCount(withCount(withCount(state, 'billing', 'inputs'), 'billing', 'consents'), 'provision', 'inputs');

        expect(state.steps.billing.used).toEqual({ inputs: 1, consents: 1 });
        expect(state.used).toEqual({ inputs: 2, consents: 1 });
    });

    it('happyPath_anInputStartsANewAttemptWithoutTheLastFailure_badPath_aConsentKeepsIt', () => {
        // Finding 49 of 2026-11-01: step g's "unavailable" stayed under the reports a later click created.
        const failed = withStep(initialSetupState(createHarness().host, 'normal'), 'analytics', { error: { key: 'apiError.unavailable' } });

        expect(withCount(failed, 'analytics', 'consents').steps.analytics.error).toEqual({ key: 'apiError.unavailable' });
        expect(withCount(failed, 'analytics', 'inputs').steps.analytics.error).toBeNull();
    });
});

describe('resumeStep, worstState and provisionHealth', () => {
    it('happyPath_resumesAtTheRequestedStepOrTheFirstIncompleteOne', () => {
        const state = done(initialSetupState(createHarness().host, 'bootstrap'), 'signIn');

        expect(resumeStep(state, 'usgs')).toBe('usgs');
        expect(resumeStep(state, null)).toBe('billing');
        expect(resumeStep(state, 'nonsense')).toBe('billing');
    });

    it('happyPath_theWorstStateWins', () => {
        expect(worstState([])).toBe('ok');
        expect(worstState(['ok', 'pending', 'missing'])).toBe('missing');
        expect(worstState(['unavailable', 'invalid', 'ok'])).toBe('invalid');
    });

    it('happyPath_aSchedulerWaitingForTheDeployDoesNotHoldProvisioningBack', () => {
        const items = PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? ('pending' as const) : ('ok' as const) }));

        expect(provisionHealth(items)).toBe('ok');
        expect(provisionHealth(items.map((item) => (item.id === 'secrets' ? { ...item, state: 'pending' as const } : item)))).toBe(
            'pending',
        );
        expect(provisionHealth(items.map((item) => (item.id === 'scheduler' ? { ...item, state: 'invalid' as const } : item)))).toBe(
            'invalid',
        );
    });
});
