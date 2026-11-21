import { describe, expect, it, vi } from 'vitest';

import { bootstrapRecordKey, readBootstrapRecord, writeBootstrapRecord, type BootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { createSetupController } from '../../src/setup/controller.js';
import { PROJECT_ID, createHarness, flush, functionsError, provisionedItems, statusView, type Harness } from './harness.js';

const CHECKED = '2026-10-12T08:00:00.000Z';
const BUDGET = 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1';

const RECORD: BootstrapRecord = {
    version: 1,
    projectId: PROJECT_ID,
    updatedAt: CHECKED,
    steps: {
        signIn: { state: 'ok', checkedAt: CHECKED },
        billing: { state: 'ok', checkedAt: CHECKED },
        provision: { state: 'ok', checkedAt: CHECKED },
        deploy: { state: 'pending', checkedAt: CHECKED, detail: 'adminSetup.deploy.progress', params: { ready: '3', total: '32' } },
    },
    billing: { accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' },
    provision: { items: provisionedItems() },
    deploy: { ready: 3, total: 32 },
};

const READY_VIEW = statusView({
    billing: { state: 'ok', checkedAt: CHECKED, budgetId: BUDGET },
    provision: { state: 'ok', checkedAt: CHECKED, items: provisionedItems(true) },
});

function setup(prepare: (harness: Harness) => void = () => undefined) {
    const harness = createHarness();
    prepare(harness);
    return { harness, controller: createSetupController(harness.deps) };
}

describe('start', () => {
    it('happyPath_aNewOwnerStartsAtBillingWithSignInDone', async () => {
        const { harness, controller } = setup((h) => {
            h.google.grant('cloudReadOnly');
        });

        await controller.start('bootstrap', null);

        expect(controller.getState()).toMatchObject({ mode: 'bootstrap', openStep: 'billing', done: 1 });
        expect(controller.getState().steps.signIn.state).toBe('ok');
        expect(harness.cloud.disabledApis).toHaveBeenCalledTimes(1);
        expect(harness.backend.status).not.toHaveBeenCalled();
    });

    it('happyPath_aReloadResumesFromTheRecordAndWatchesTheDeployment', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.google.grant('cloudPlatform');
        });

        await controller.start('bootstrap', null);
        await flush();

        expect(controller.getState().openStep).toBe('deploy');
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        expect(controller.getState().deploy.watching).toBe(true);
        controller.dispose();
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_aReloadWithoutATokenOffersContinueOnTheDeployment', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
        });

        await controller.start('bootstrap', null);
        await flush();

        expect(harness.cloud.deployment).not.toHaveBeenCalled();
        expect(controller.getState().steps.deploy.needsContinue).toBe(true);
    });

    it('happyPath_theAddressCanNameTheStepToOpen', async () => {
        const { controller } = setup();

        await controller.start('bootstrap', 'provision');

        expect(controller.getState().openStep).toBe('provision');
    });

    it('happyPath_normalModeLoadsTheServersRecordAndTheImport', async () => {
        const { harness, controller } = setup((h) => {
            h.backend.status.mockResolvedValue(READY_VIEW);
        });

        await controller.start('normal', null);

        expect(harness.backend.status).toHaveBeenCalledTimes(1);
        expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        // M28: the harness's city holds a choice of sources, so that step is done too.
        expect(controller.getState()).toMatchObject({ openStep: 'mapbox', error: null, done: 6 });
    });

    it('badPath_aCardOpenedWhileTheFirstChecksRunStaysOpen', async () => {
        const detection: { finish?: (progress: { done: number; total: number; failed: [] }) => void } = {};
        const { harness, controller } = setup((h) => {
            h.backend.status.mockResolvedValue(READY_VIEW);
            h.importer.detect.mockReturnValue(
                new Promise((resolve) => {
                    detection.finish = resolve;
                }),
            );
        });

        const starting = controller.start('normal', null);
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });
        controller.intents.open('analytics');
        detection.finish?.({ done: 0, total: 45, failed: [] });
        await starting;

        expect(controller.getState().openStep).toBe('analytics');
    });

    /** A setup whose legacy import's detection ends only when the test says so. */
    function slowDetection(view: ReturnType<typeof statusView>) {
        const detection: { finish?: (progress: { done: number; total: number; failed: [] }) => void } = {};
        const started = setup((h) => {
            h.backend.status.mockResolvedValue(view);
            h.importer.detect.mockReturnValue(
                new Promise((resolve) => {
                    detection.finish = resolve;
                }),
            );
        });
        return { ...started, detection };
    }

    it('happyPath_theNextStepOpensAsSoonAsTheServersRecordIsInNotAfterTheImportsDetection', async () => {
        const { harness, controller, detection } = slowDetection(READY_VIEW);

        const starting = controller.start('normal', null);
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });

        expect(controller.getState().openStep).toBe('mapbox');
        detection.finish?.({ done: 0, total: 45, failed: [] });
        await starting;
        expect(controller.getState().openStep).toBe('mapbox');
    });

    it('badPath_whenOnlyTheImportIsLeftItsDetectionDecidesWhatOpens', async () => {
        const ok = { state: 'ok' as const, checkedAt: CHECKED };
        // M6: the imagery pipeline (an optional step before the import) recorded installed; the site comes last anyway.
        const install = { pipeline: { state: 'installed', checkedAt: CHECKED } } as const;
        const { harness, controller, detection } = slowDetection(
            statusView({ ...READY_VIEW, mapbox: ok, usgs: ok, analytics: ok, crash: ok, install }),
        );

        const starting = controller.start('normal', null);
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });

        expect(controller.getState().openStep).toBeNull();
        detection.finish?.({ done: 10, total: 45, failed: [] });
        await starting;
        expect(controller.getState().openStep).toBe('legacyImport');
    });

    it('badPath_aServerThatDoesNotAnswerIsShownOnThePage', async () => {
        const { controller } = setup((h) => {
            h.backend.status.mockRejectedValue(functionsError('apiError.unavailable'));
        });

        await controller.start('normal', null);

        expect(controller.getState().error).toEqual({ key: 'apiError.unavailable' });
        expect(controller.getState().steps.mapbox.unknown).toBe(false);
    });
});

// Finding 32 of 2026-10-31: right after a reload every chip read "To do" (0 of 11) until the checks answered.
describe('the first checks (finding 32 of 2026-10-31)', () => {
    const firstChecks = (state: ReturnType<ReturnType<typeof createSetupController>['getState']>): string[] =>
        state.order.filter((id) => state.steps[id].firstCheck);

    it('happyPath_everyStepReadsCheckingUntilTheServersRecordAndThenTheImportAnswer', async () => {
        const detection: { finish?: (progress: { done: number; total: number; failed: [] }) => void } = {};
        const { harness, controller } = setup((h) => {
            h.backend.status.mockResolvedValue(READY_VIEW);
            h.importer.detect.mockReturnValue(
                new Promise((resolve) => {
                    detection.finish = resolve;
                }),
            );
        });
        expect(controller.getState().loading).toBe(true);
        expect(firstChecks(controller.getState())).toEqual(controller.getState().order);

        const starting = controller.start('normal', null);
        expect(controller.getState().loading).toBe(true);
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });
        expect(firstChecks(controller.getState())).toEqual(['legacyImport']);

        detection.finish?.({ done: 45, total: 45, failed: [] });
        await starting;
        expect(controller.getState()).toMatchObject({ loading: false, done: 7 });
        expect(firstChecks(controller.getState())).toEqual([]);
    });

    it('badPath_aRecordThatCannotBeReadEndsCheckingWithTheReason', async () => {
        const { controller } = setup((h) => {
            h.backend.status.mockRejectedValue(functionsError('apiError.unavailable'));
            h.importer.detect.mockRejectedValue(functionsError('apiError.unavailable'));
        });

        await controller.start('normal', null);

        expect(controller.getState()).toMatchObject({ loading: false, error: { key: 'apiError.unavailable' } });
    });

    it('happyPath_inStartUpModeTheTabsRecordAnswersAtOnce', async () => {
        const { controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
        });

        await controller.start('bootstrap', null);

        expect(controller.getState().loading).toBe(false);
        expect(controller.getState().steps.billing.state).toBe('ok');
    });
});

describe('a server older than the admin (finding 27 of 2026-10-31)', () => {
    it('badPath_aRecordOlderThanTheAdminLeavesItsStepsUnknownNotToDo @S-A03-BAD-OLDER-SERVER-STATUS', async () => {
        // Finding 27 of 2026-10-31: the server answered, in a shape the admin cannot read.
        const { controller } = setup((h) => {
            h.backend.status.mockRejectedValue(functionsError('apiError.serverOutdated'));
        });

        await controller.start('normal', null);

        const state = controller.getState();
        expect(state).toMatchObject({ error: { key: 'apiError.serverOutdated' }, serverOutdated: true });
        expect(['signIn', 'deploy', 'claim'].map((id) => state.steps[id as 'claim'].state)).toEqual(['ok', 'ok', 'ok']);
        expect(state.steps.mapbox).toMatchObject({ state: 'missing', unknown: true });
        expect(state.steps.usgs.unknown).toBe(true);
        expect(state.steps.claim.unknown).toBe(false);
        expect(state.steps.provision.state).not.toBe('ok');
        expect(state.steps.deploy.available).toBe(true);
    });
});

describe('the switch to normal mode', () => {
    it('happyPath_theClaimCreatesTheCityRecordsTheBootstrapAndOpensMapbox', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.backend.status.mockResolvedValue(READY_VIEW);
        });
        await controller.start('bootstrap', null);

        await controller.setMode('normal');

        expect(harness.backend.createCity).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud).toHaveBeenCalledWith(
            expect.objectContaining({ billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' } }),
        );
        expect(harness.session.get(bootstrapRecordKey(PROJECT_ID))).toBeNull();
        expect(controller.getState()).toMatchObject({ mode: 'normal', openStep: 'mapbox' });
        expect(controller.getState().steps.claim.state).toBe('ok');
    });

    it('badPath_aCardOpenedWhileTheSwitchLoadsStaysOpen', async () => {
        // The journey's Publish the map card, opened while the claim's import detection still read the photos, became Mapbox.
        const detection: { finish?: (progress: { done: number; total: number; failed: [] }) => void } = {};
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.backend.status.mockResolvedValue(READY_VIEW);
            h.importer.detect.mockReturnValue(
                new Promise((resolve) => {
                    detection.finish = resolve;
                }),
            );
        });
        await controller.start('bootstrap', null);

        const switching = controller.setMode('normal');
        await vi.waitFor(() => {
            expect(harness.importer.detect).toHaveBeenCalledTimes(1);
        });
        controller.intents.open('site');
        detection.finish?.({ done: 0, total: 45, failed: [] });
        await switching;

        expect(controller.getState()).toMatchObject({ mode: 'normal', openStep: 'site' });
    });

    it('badPath_aCityThatCannotBeCreatedKeepsTheRecordForTheNextTry', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
            h.backend.createCity.mockRejectedValueOnce(functionsError('apiError.internal'));
        });
        await controller.start('bootstrap', null);

        await controller.setMode('normal');
        expect(controller.getState().steps.claim.error).toEqual({ key: 'apiError.internal' });
        expect(readBootstrapRecord(harness.session, PROJECT_ID)).not.toBeNull();

        await controller.intents.recheck('claim');
        await flush();
        expect(harness.backend.createCity).toHaveBeenCalledTimes(2);
        expect(readBootstrapRecord(harness.session, PROJECT_ID)).toBeNull();
    });

    it('badPath_aClaimShownBeforeTheSetupStartedKeepsTheStartUpRecord', async () => {
        // The page was reloaded before the server appeared: normal mode, the map unclaimed, the claim runs first.
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, RECORD);
        });
        controller.setClaim('pending', { key: 'adminShell.auth.claiming' });

        await controller.start('normal', null);

        expect(harness.backend.recordCloud).toHaveBeenCalledWith(
            expect.objectContaining({ billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' } }),
        );
        expect(harness.session.get(bootstrapRecordKey(PROJECT_ID))).toBeNull();
    });

    it('badPath_aRecordWithNothingToRecordOnlyCreatesTheCity', async () => {
        const { harness, controller } = setup((h) => {
            writeBootstrapRecord(h.session, {
                version: 1,
                projectId: PROJECT_ID,
                updatedAt: CHECKED,
                steps: { signIn: { state: 'ok', checkedAt: CHECKED } },
            });
        });

        await controller.start('normal', null);

        expect(harness.backend.createCity).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_theSameModeOrBackToBootstrapLoadsNothing', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);

        await controller.setMode('bootstrap');
        await controller.setMode('normal');
        await controller.setMode('bootstrap');

        expect(harness.backend.status).toHaveBeenCalledTimes(1);
        expect(controller.getState().mode).toBe('bootstrap');
    });

    it('happyPath_theShellReportsTheClaim', async () => {
        const { controller } = setup();
        await controller.start('bootstrap', null);

        controller.setClaim('invalid', { key: 'apiError.claim.tokenMismatch' });

        expect(controller.getState().steps.claim).toMatchObject({ state: 'invalid', detail: { key: 'apiError.claim.tokenMismatch' } });
    });
});

describe('check again', () => {
    it('happyPath_theWholePageRunsTheSelfTestInNormalMode', async () => {
        const { harness, controller } = setup((h) => {
            h.backend.selfTest.mockResolvedValue({ checks: [], status: READY_VIEW });
        });
        await controller.start('normal', null);
        const checking: boolean[] = [];
        controller.subscribe((state) => checking.push(state.checking));

        await controller.intents.recheck();
        await flush();

        expect(harness.backend.selfTest).toHaveBeenCalledTimes(1);
        expect(checking[0]).toBe(true);
        expect(controller.getState()).toMatchObject({ checking: false, error: null });
        expect(controller.getState().steps.billing.state).toBe('ok');
    });

    it('badPath_aFailingCheckIsListedWithItsReasonAndTheOthersWithTheirStates', async () => {
        const checks = [
            { id: 'firestore', state: 'ok' },
            { id: 'secrets', state: 'unavailable', detail: 'apiError.secrets.unavailable' },
            { id: 'mapbox', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/secretmanager.secretAccessor' } },
            // §67g: a passing AI check names the model in use; a failing one names the models in its reason only.
            { id: 'ai', state: 'ok', params: { model: 'gemini-3.1-flash-lite' } },
            { id: 'usgs', state: 'ok' },
        ] as const;
        const { controller } = setup((h) => {
            h.backend.selfTest.mockResolvedValue({ checks: [...checks], status: READY_VIEW });
        });
        await controller.start('normal', null);
        expect(controller.getState().selfTest.checks).toEqual([]);

        await controller.intents.recheck();
        await flush();

        expect(controller.getState().selfTest.checks).toEqual([
            { id: 'firestore', state: 'ok', detail: null },
            { id: 'secrets', state: 'unavailable', detail: { key: 'apiError.secrets.unavailable' } },
            {
                id: 'mapbox',
                state: 'invalid',
                detail: { key: 'apiError.cloud.permission', params: { role: 'roles/secretmanager.secretAccessor' } },
            },
            { id: 'ai', state: 'ok', detail: null, model: 'gemini-3.1-flash-lite' },
            { id: 'usgs', state: 'ok', detail: null },
        ]);
    });

    it('badPath_aFailedSelfTestIsShownOnThePage', async () => {
        const { controller } = setup((h) => {
            h.backend.selfTest.mockRejectedValue(functionsError('apiError.notAdmin'));
        });
        await controller.start('normal', null);

        await controller.intents.recheck();
        await flush();

        expect(controller.getState()).toMatchObject({ checking: false, error: { key: 'apiError.notAdmin' } });
    });

    it('happyPath_inBootstrapModeThePageReadsTheRecordAgain', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);
        writeBootstrapRecord(harness.session, RECORD);

        await controller.intents.recheck();
        await flush();

        expect(controller.getState().steps.provision.state).toBe('ok');
    });

    it('happyPath_eachCardRunsItsOwnCheck', async () => {
        const { harness, controller } = setup();
        await controller.start('normal', null);

        for (const step of ['billing', 'provision', 'deploy', 'mapbox', 'analytics', 'legacyImport'] as const) {
            await controller.intents.recheck(step);
            await flush();
        }

        expect(harness.cloud.observeBilling).toHaveBeenCalledTimes(1);
        expect(harness.cloud.doctor).toHaveBeenCalledTimes(1);
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(1);
        expect(harness.backend.selfTest).toHaveBeenCalledTimes(1);
        expect(harness.backend.analyticsConfig).toHaveBeenCalledTimes(1);
        expect(harness.importer.detect).toHaveBeenCalledTimes(3);
        expect(controller.getState().steps.mapbox.used.inputs).toBe(1);
        controller.dispose();
    });

    it('badPath_theAnalyticsCardChecksNothingWhileAnotherPageShows', async () => {
        const { harness, controller } = setup();
        controller.setPageShown(false);
        await controller.start('normal', 'analytics');
        await flush();
        expect(controller.getState().openStep).toBe('analytics');
        expect(harness.backend.analyticsConfig).not.toHaveBeenCalled();

        // The Setup page shows: its open card checks, once.
        controller.setPageShown(true);
        controller.setPageShown(true);
        await flush();
        expect(harness.backend.analyticsConfig).toHaveBeenCalledTimes(1);
        controller.dispose();
    });

    it('badPath_inBootstrapModeAServerCardChecksNothing', async () => {
        const { harness, controller } = setup();
        await controller.start('bootstrap', null);

        await controller.intents.recheck('mapbox');
        await controller.intents.recheck('provision');
        await flush();

        expect(harness.backend.selfTest).not.toHaveBeenCalled();
        expect(harness.cloud.provision).toHaveBeenCalledTimes(1);
    });
});
