import { describe, expect, it } from 'vitest';

import { CRASH_GROUPS_REQUEST, createAnalyticsFlow } from '../../src/setup/analytics.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createLegacyImportFlow } from '../../src/setup/legacy-import.js';
import { initialSetupState } from '../../src/setup/state.js';
import { createHarness, functionsError, googleError } from './harness.js';

const CHECKED = '2026-10-12T09:00:00.000Z';
const FIREBASE = { apiKey: 'e2e-web-api-key', appId: '1:123456789012:web:abcdef', projectId: 'demo-hcm' };
const CONFIGURED = {
    analytics: { state: 'ok', checkedAt: CHECKED },
    measurementId: 'G-E2E12345',
    firebase: FIREBASE,
    manifestQueued: true,
} as const;
const GROUP = {
    groupId: 'g1',
    message: 'TypeError: x is undefined',
    service: 'viewer',
    count: 3,
    firstSeen: CHECKED,
    lastSeen: CHECKED,
    resolution: 'OPEN',
} as const;

function setup(mode: 'bootstrap' | 'normal' = 'normal') {
    const harness = createHarness();
    const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, mode)));
    return { harness, ctx, flow: createAnalyticsFlow(ctx) };
}

describe('analytics: the measurement id', () => {
    it('happyPath_openingTheCardDetectsTheIdAndListsTheCrashes', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.analyticsConfig.mockResolvedValue(CONFIGURED);
        harness.backend.listGroups.mockResolvedValue({ groups: [GROUP] });

        await flow.open();

        expect(harness.backend.analyticsConfig).toHaveBeenCalledWith({ cityId: 'bucharest' });
        expect(harness.backend.listGroups).toHaveBeenCalledWith(CRASH_GROUPS_REQUEST);
        expect(ctx.state().steps.analytics).toMatchObject({ state: 'ok', detail: null });
        expect(ctx.state().analytics.measurementId).toBe('G-E2E12345');
        expect(ctx.state().crashes).toMatchObject({ loaded: true, busy: false, error: null });
        expect(ctx.state().crashes.groups).toEqual([
            { groupId: 'g1', message: GROUP.message, service: 'viewer', count: 3, lastSeen: CHECKED },
        ]);
    });

    it('badPath_bootstrapModeCallsNothing', async () => {
        const { harness, flow } = setup('bootstrap');

        await flow.open();

        expect(harness.backend.analyticsConfig).not.toHaveBeenCalled();
    });

    it('badPath_analyticsNotEnabledIsTheCardsReasonAndTheLinkStartsAWatch', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.analyticsConfig.mockRejectedValueOnce(functionsError('apiError.analytics.notEnabled'));
        harness.backend.analyticsConfig.mockRejectedValueOnce(functionsError('apiError.analytics.notEnabled'));
        harness.backend.analyticsConfig.mockResolvedValueOnce({
            ...CONFIGURED,
            analytics: { state: 'pending', checkedAt: CHECKED, detail: 'apiError.analytics.noWebApp' },
        });
        harness.backend.analyticsConfig.mockResolvedValueOnce(CONFIGURED);

        await flow.open();
        expect(ctx.state().steps.analytics).toMatchObject({
            state: 'missing',
            detail: { key: 'apiError.analytics.notEnabled' },
            error: null,
        });

        flow.followLink();
        expect(ctx.state().analytics.watching).toBe(true);
        await harness.clock.advance(30_000);
        expect(ctx.state().steps.analytics).toMatchObject({ state: 'pending', detail: { key: 'apiError.analytics.noWebApp' } });
        expect(ctx.state().analytics.watching).toBe(true);

        await harness.clock.advance(15_000);
        expect(ctx.state().steps.analytics.state).toBe('ok');
        expect(ctx.state().analytics.watching).toBe(false);
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_aWatchGivesUpAfterFifteenMinutes', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.analyticsConfig.mockRejectedValue(functionsError('apiError.analytics.notEnabled'));

        flow.followLink();
        await harness.clock.advance(16 * 60_000);

        expect(ctx.state().analytics.watching).toBe(false);
        flow.dispose();
    });

    it('badPath_aServerAccountWithoutItsRoleIsAFailedCheck', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.analyticsConfig.mockRejectedValue(functionsError('apiError.cloud.permission', { role: 'roles/firebase.viewer' }));

        await flow.open();

        expect(ctx.state().steps.analytics.error).toEqual({ key: 'apiError.cloud.permission', params: { role: 'roles/firebase.viewer' } });
        expect(ctx.state().steps.analytics.state).toBe('missing');
    });
});

describe('analytics: the stream setting and the crash e-mails', () => {
    it('happyPath_oneClickOneConsentTurnsHistoryPageViewsOff', async () => {
        const { harness, ctx, flow } = setup();

        await flow.disablePageChanges();

        expect(harness.google.requests).toEqual(['analyticsEdit']);
        expect(ctx.state().analytics.pageChangesOff).toBe(true);
        expect(ctx.state().steps.analytics.used).toEqual({ inputs: 1, consents: 1 });
        // The card's next popup is the crash e-mail switch's: its consent note says so.
        expect(ctx.state().steps.analytics.scope).toBe('cloudPlatform');
    });

    it('badPath_aStreamThatStillCountsPageChangesKeepsTheSettingOnTheCard', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.disablePageChanges.mockResolvedValue({ pageChangesEnabled: true });

        await flow.disablePageChanges();

        expect(ctx.state().analytics.pageChangesOff).toBe(false);
        expect(ctx.state().steps.analytics.scope).toBe('analyticsEdit');
    });

    it('badPath_withoutAStreamTheCardAsksToEnableAnalyticsFirst', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.disablePageChanges.mockRejectedValue(googleError('notFound'));

        await flow.disablePageChanges();

        expect(ctx.state().steps.analytics.error).toEqual({ key: 'adminSetup.analytics.noStream' });
        expect(ctx.state().analytics.pageChangesOff).toBe(false);
    });

    it('badPath_anotherStreamFailureKeepsItsMessage', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.disablePageChanges.mockRejectedValue(googleError('unavailable'));

        await flow.disablePageChanges();

        expect(ctx.state().steps.analytics.error).toEqual({ key: 'apiError.unavailable' });
    });

    it('happyPath_theCrashSwitchTurnsTheAlertPolicyOffAndOn', async () => {
        const { harness, ctx, flow } = setup();

        await flow.setCrashEmails(false);
        expect(ctx.state().analytics.crashEmails).toBe(false);
        await flow.setCrashEmails(true);

        expect(harness.cloud.setCrashAlerts.mock.calls.map((call) => call[1])).toEqual([false, true]);
        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().analytics.crashEmails).toBe(true);
    });

    it('badPath_aRefusedSwitchKeepsTheStateAndSaysWhy', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.setCrashAlerts.mockRejectedValue(googleError('forbidden', { role: 'roles/monitoring.alertPolicyEditor' }));

        await flow.setCrashEmails(false);

        expect(ctx.state().analytics.crashEmails).toBe(true);
        expect(ctx.state().steps.analytics.error?.key).toBe('apiError.cloud.permission');
    });

    it('badPath_aClosedPopupChangesNothing', async () => {
        const { harness, flow } = setup();
        harness.google.answer = () => Promise.resolve(null);

        await flow.disablePageChanges();
        await flow.setCrashEmails(false);
        await flow.enableApi('clouderrorreporting.googleapis.com');

        expect(harness.cloud.disablePageChanges).not.toHaveBeenCalled();
        expect(harness.cloud.setCrashAlerts).not.toHaveBeenCalled();
        expect(harness.cloud.enableApis).not.toHaveBeenCalled();
    });
});

describe('analytics: the measurement reports (§76f)', () => {
    function withMeasurementId() {
        const found = setup();
        found.ctx.update((state) => ({ ...state, analytics: { ...state.analytics, measurementId: 'G-E2E12345' } }));
        return found;
    }

    it('happyPath_oneClickRegistersTheDefinitionsOnTheStreamsPropertyAndSaysWhat', async () => {
        const { harness, ctx, flow } = withMeasurementId();

        await flow.createReports();

        expect(harness.google.requests).toEqual(['analyticsEdit']);
        expect(harness.cloud.createMeasurementReports.mock.calls[0]?.[1]).toBe('G-E2E12345');
        expect(ctx.state().analytics.reports).toEqual({ created: 14, skipped: 0 });
        expect(ctx.state().steps.analytics.used).toEqual({ inputs: 1, consents: 1 });
    });

    it('badPath_noPropertyTheOwnerCanEditSendsTheIdAndSaysSo', async () => {
        const { harness, ctx, flow } = withMeasurementId();
        harness.cloud.createMeasurementReports.mockResolvedValue(null);

        await flow.createReports();

        expect(ctx.state().steps.analytics.error).toEqual({ key: 'adminSetup.analytics.noProperty', params: { id: 'G-E2E12345' } });
        expect(ctx.state().analytics.reports).toBeNull();
    });

    it('badPath_aRefusedPropertyNamesTheRole_andWithoutAnIdOrAConsentNothingIsCalled', async () => {
        const { harness, ctx, flow } = withMeasurementId();
        harness.cloud.createMeasurementReports.mockRejectedValue(googleError('forbidden', { role: 'roles/analytics.editor' }));
        await flow.createReports();
        expect(ctx.state().steps.analytics.error?.key).toBe('apiError.cloud.permission');

        const bare = setup();
        await bare.flow.createReports();
        const closed = withMeasurementId();
        closed.harness.google.answer = () => Promise.resolve(null);
        await closed.flow.createReports();
        expect(
            [bare.harness.cloud.createMeasurementReports, closed.harness.cloud.createMeasurementReports].map((mock) => mock.mock.calls),
        ).toEqual([[], []]);
    });
});

describe('analytics: crash reports', () => {
    it('badPath_errorReportingDisabledIsEnabledWithGoogleThenListed', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.listGroups.mockRejectedValueOnce(
            functionsError('apiError.cloud.apiDisabled', { api: 'clouderrorreporting.googleapis.com' }),
        );

        await flow.loadCrashGroups();
        expect(ctx.state().crashes).toMatchObject({ loaded: true, disabledApi: 'clouderrorreporting.googleapis.com' });

        await flow.enableApi('clouderrorreporting.googleapis.com');

        expect(harness.cloud.enableApis).toHaveBeenCalledWith(harness.google.current, ['clouderrorreporting.googleapis.com']);
        expect(ctx.state().crashes).toMatchObject({ error: null, disabledApi: null, groups: [] });
    });

    it('badPath_aDisabledApiWithoutItsNameOffersRetry', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.listGroups.mockRejectedValue(functionsError('apiError.cloud.apiDisabled'));

        await flow.loadCrashGroups();

        expect(ctx.state().crashes.disabledApi).toBeNull();
    });

    it('badPath_anUnavailableErrorReportingOffersRetry', async () => {
        const { harness, ctx, flow } = setup();
        harness.backend.listGroups.mockRejectedValue(functionsError('apiError.errorReporting.unavailable'));

        await flow.loadCrashGroups();

        expect(ctx.state().crashes).toMatchObject({
            error: { key: 'apiError.errorReporting.unavailable' },
            disabledApi: null,
            busy: false,
        });
    });

    it('badPath_anApiThatCannotBeEnabledSaysWhy', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.enableApis.mockRejectedValue(googleError('forbidden'));

        await flow.enableApi('clouderrorreporting.googleapis.com');

        expect(ctx.state().steps.analytics.error?.key).toBe('apiError.cloud.permission');
    });
});

describe('legacy import', () => {
    it('happyPath_oneClickImportsEveryPhotoAndShowsTheProgress', async () => {
        const harness = createHarness();
        const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'normal')));
        const flow = createLegacyImportFlow(ctx);
        const seen: number[] = [];
        harness.importer.run.mockImplementation((onProgress) => {
            onProgress({ done: 20, total: 45, failed: [] });
            seen.push(ctx.state().legacyImport.done);
            return Promise.resolve({ done: 45, total: 45, failed: [] });
        });

        await flow.detect();
        expect(ctx.state().steps.legacyImport.state).toBe('missing');
        await flow.run();

        expect(seen).toEqual([20]);
        expect(ctx.state().legacyImport).toEqual({ done: 45, total: 45, failed: [], running: false, directions: 0, credits: false });
        expect(ctx.state().steps.legacyImport).toMatchObject({ state: 'ok', busy: false, used: { inputs: 1, consents: 0 } });
    });

    it('badPath_aPartialImportIsPendingAndFailuresAreListed', async () => {
        const harness = createHarness();
        const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'normal')));
        const flow = createLegacyImportFlow(ctx);
        harness.importer.detect.mockResolvedValue({ done: 12, total: 45, failed: [] });
        harness.importer.run.mockResolvedValue({ done: 44, total: 45, failed: [{ id: 'ferdinand', detail: 'apiError.photo.tooLarge' }] });

        await flow.detect();
        expect(ctx.state().steps.legacyImport.state).toBe('pending');
        await flow.run();

        expect(ctx.state().steps.legacyImport).toMatchObject({
            state: 'invalid',
            detail: { key: 'adminSetup.import.failed', params: { count: '1' } },
        });
    });

    it('badPath_aMapWithEveryPhotoButADirectionOrAnAuthorToAddIsPending', async () => {
        const harness = createHarness();
        const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'normal')));
        const flow = createLegacyImportFlow(ctx);
        harness.importer.detect.mockResolvedValueOnce({ done: 57, total: 57, failed: [], directions: 1, credits: true });
        harness.importer.detect.mockResolvedValueOnce({ done: 57, total: 57, failed: [], credits: true });
        harness.importer.run.mockResolvedValue({ done: 57, total: 57, failed: [], directions: 0, credits: false });

        await flow.detect();
        expect(ctx.state().legacyImport).toMatchObject({ directions: 1, credits: true });
        expect(ctx.state().steps.legacyImport.state).toBe('pending');
        await flow.detect();
        expect(ctx.state().steps.legacyImport.state).toBe('pending');
        await flow.run();

        expect(ctx.state().steps.legacyImport.state).toBe('ok');
    });

    it('badPath_anImportThatStopsIsShownAndCanBeRunAgain', async () => {
        const harness = createHarness();
        const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'normal')));
        const flow = createLegacyImportFlow(ctx);
        harness.importer.detect.mockRejectedValue(functionsError('apiError.unavailable'));
        harness.importer.run.mockRejectedValue(functionsError('apiError.unavailable'));

        await flow.detect();
        await flow.run();

        expect(ctx.state().legacyImport.running).toBe(false);
        expect(ctx.state().steps.legacyImport).toMatchObject({ busy: false, error: { key: 'apiError.unavailable' } });
    });
});
