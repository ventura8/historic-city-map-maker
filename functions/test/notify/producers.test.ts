/**
 * Every assists-notify producer emits its event once (`docs/research/M4-interfaces.md` §5.1, §5.2; CR-M4-8): USGS
 * granting downloads and a crash spike (`ops.tick`'s `health` step), the budget pausing processing (`ops.onBudget`), a
 * failed job, a version waiting for Approve after the policy left it and one waiting for points (`imagery.onJobWrite`).
 * Each event is a `notificationEvents/{id}` document with its kind, parameters and link; a second run writes nothing.
 * The order watch's events are the orders workstream's (`functions/test/imagery/orders*.test.ts`).
 */
import {
    FIRESTORE_PATHS,
    OPS_CRASHES_PATH,
    crashCounterDocSchema,
    notificationEventDocSchema,
    setupStatusDocSchema,
    timestampFromDate,
    type JobDoc,
    type NotificationEventDoc,
} from '@hcm/shared';
import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { emitNotification } from '../../src/api/notification-event.js';
import { noticeOf } from '../../src/imagery/job-notices.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { onBudgetAlert } from '../../src/ops/budget.js';
import { checkCrashSpike } from '../../src/ops/crash-spike.js';
import { runTick } from '../../src/ops/tick.js';
import { UpstreamError } from '../../src/ports/errors.js';
import {
    CITY,
    goldenGeoref,
    needsGcpsVersion,
    readyWorld,
    renderedVersion,
    runningJob,
    seedJob,
    seedVersion,
    type ImageryWorld,
} from '../imagery/world.js';
import { hoursBefore, opsDeps, type OpsTestDeps } from '../ops/fakes.js';

const NOW = '2026-10-24T08:30:00.000Z';

function events(deps: { readonly documents: { paths(prefix?: string): string[] } }): string[] {
    return deps.documents.paths('notificationEvents/').map((path) => path.slice('notificationEvents/'.length));
}

function event(deps: ImageryWorld['deps'] | OpsTestDeps, id: string): Promise<NotificationEventDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema);
}

async function pendingUsgs(deps: OpsTestDeps): Promise<void> {
    await deps.secrets.write('usgs-username', USGS_CREDENTIALS.approved.username);
    await deps.secrets.write('usgs-app-token', USGS_CREDENTIALS.approved.applicationToken);
    await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
        usgs: { state: 'pending', role: 'search', nextCheckAt: hoursBefore(NOW, 1) },
        updatedBy: 'system:setup',
        updatedAt: hoursBefore(NOW, 7),
    });
}

describe('ops.tick and ops.onBudget emit @S-A46-HAPPY-PRODUCERS', () => {
    it('happyPath_usgsApprovingDownloadsIsToldOnce', async () => {
        const deps = opsDeps(NOW);
        await pendingUsgs(deps);

        await runTick(deps);

        await expect(event(deps, 'usgs.approved~download')).resolves.toMatchObject({
            kind: 'usgs.approved',
            severity: 'info',
            params: {},
            link: '#/imagery',
            updatedBy: 'system:ops',
        });
        await pendingUsgs(deps);
        await runTick(deps);
        expect(events(deps)).toEqual(['usgs.approved~download']);
    });

    it('badPath_aRoleStillPendingTellsNobody', async () => {
        const deps = opsDeps(NOW, { permissions: ['search'] });
        await pendingUsgs(deps);

        await runTick(deps);

        expect(events(deps)).toEqual([]);
    });

    it('happyPath_aCrashSpikeWithinTheHourIsToldOnceADay', async () => {
        const deps = opsDeps(NOW);
        const group = {
            groupId: 'g1',
            count: 4,
            firstSeen: NOW,
            lastSeen: NOW,
            resolution: 'OPEN',
            service: 'viewer',
            message: 'boom',
        } as const;
        deps.crashGroups.push(group);
        await expect(checkCrashSpike(deps, new Date(NOW))).resolves.toBe(0);

        deps.crashGroups.splice(0, 1, { ...group, count: 9 }, { ...group, groupId: 'g2', count: 5 });
        await expect(checkCrashSpike(deps, new Date('2026-10-24T08:45:00.000Z'))).resolves.toBe(10);
        await checkCrashSpike(deps, new Date('2026-10-24T09:00:00.000Z'));

        await expect(event(deps, 'crash.spike~2026-10-24')).resolves.toMatchObject({
            kind: 'crash.spike',
            params: { count: '10' },
            link: '#/crashes',
        });
        expect(events(deps)).toEqual(['crash.spike~2026-10-24']);
        await expect(deps.documents.get(OPS_CRASHES_PATH, crashCounterDocSchema)).resolves.toMatchObject({
            baseline: 4,
            baselineAt: timestampFromDate(new Date(NOW)),
            lastTotal: 14,
        });
    });

    it('badPath_aBaselineThatNoLongerReadsStartsAgain', async () => {
        const deps = opsDeps(NOW);
        deps.documents.seed(OPS_CRASHES_PATH, { baseline: 'many' });

        await expect(checkCrashSpike(deps, new Date(NOW))).resolves.toBe(0);

        await expect(deps.documents.get(OPS_CRASHES_PATH, crashCounterDocSchema)).resolves.toMatchObject({ baseline: 0, lastTotal: 0 });
    });

    it('badPath_aSlowRiseOverHoursAndAnErrorReportingOutageTellNobody', async () => {
        const deps = opsDeps(NOW);
        const group = {
            groupId: 'g1',
            count: 1,
            firstSeen: NOW,
            lastSeen: NOW,
            resolution: 'OPEN',
            service: 'viewer',
            message: 'boom',
        } as const;
        deps.crashGroups.push(group);
        await checkCrashSpike(deps, new Date(NOW));
        deps.crashGroups.splice(0, 1, { ...group, count: 30 });

        await expect(checkCrashSpike(deps, new Date('2026-10-24T09:31:00.000Z'))).resolves.toBe(0);
        deps.errorsRecorder.failNext('listGroups', new UpstreamError('error-reporting', 'forbidden', { status: 403 }));
        await expect(checkCrashSpike(deps, new Date('2026-10-24T09:40:00.000Z'))).resolves.toBe(0);

        expect(events(deps)).toEqual([]);
    });

    it('happyPath_theBudgetPauseIsToldOncePerPeriod', async () => {
        const deps = opsDeps(NOW);

        await onBudgetAlert(deps, { costAmount: 5.234, budgetAmount: 5, currencyCode: 'EUR', costIntervalStart: '2026-10-01T07:00:00Z' });

        await expect(event(deps, 'budget.paused~2026-10-01')).resolves.toMatchObject({
            kind: 'budget.paused',
            severity: 'error',
            params: { cost: '5.23', budget: '5.00', currency: 'EUR' },
            link: '#/imagery',
        });
    });

    it('badPath_anAlertWithoutAPeriodIsDatedTodayAndABudgetNotReachedTellsNobody', async () => {
        const deps = opsDeps(NOW);

        await onBudgetAlert(deps, { costAmount: 4, budgetAmount: 5 });
        expect(events(deps)).toEqual([]);
        await onBudgetAlert(deps, { costAmount: 6, budgetAmount: 5 });

        await expect(event(deps, 'budget.paused~2026-10-24')).resolves.toMatchObject({
            params: { cost: '6.00', budget: '5.00', currency: 'USD' },
        });
    });
});

describe('imagery.onJobWrite emits @S-A46-HAPPY-PRODUCERS', () => {
    const JOB = 'job-1966-0712';

    async function transition(world: ImageryWorld, before: JobDoc | undefined, after: JobDoc): Promise<void> {
        await seedJob(world, JOB, after);
        await onJobWrite(world.deps, CITY, JOB, { before, after });
    }

    it('happyPath_aFailedJobIsToldPerAttemptWithTheVersionsLabels', async () => {
        const world = await readyWorld(NOW);
        await seedVersion(world, JOB, renderedVersion());
        const failed = runningJob({ status: 'failed', error: { code: 'apiError.imagery.pipelineFailed', message: 'boom' } });

        await transition(world, runningJob(), failed);
        await transition(world, runningJob(), failed);

        const id = `job.failed~${CITY}~${JOB}~1`;
        await expect(event(world.deps, id)).resolves.toMatchObject({
            kind: 'job.failed',
            severity: 'error',
            cityId: CITY,
            params: { label: 'KH-4A Corona, 12 iulie 1966', labelEn: 'KH-4A Corona, 12 July 1966' },
            link: `#/imagery/version/${JOB}`,
            updatedBy: 'system:imagery',
        });
        expect(events(world.deps)).toEqual([id]);
    });

    it('happyPath_aVersionLeftWaitingForApproveIsTold', async () => {
        const world = await readyWorld(NOW);
        await seedVersion(world, JOB, renderedVersion());

        await transition(world, runningJob(), runningJob({ status: 'awaiting_approval' }));

        await expect(event(world.deps, `layer.readyToApprove~${CITY}~${JOB}`)).resolves.toMatchObject({ link: `#/imagery/version/${JOB}` });
    });

    it('badPath_aVersionThePolicyApprovedIsNotAnnounced', async () => {
        const world = await readyWorld(NOW);
        await seedVersion(world, JOB, renderedVersion({ georef: { ...goldenGeoref(), checkpointCount: 3 } }));

        await transition(world, runningJob(), runningJob({ status: 'awaiting_approval' }));

        expect(events(world.deps)).toEqual([]);
    });

    it('happyPath_aVersionWaitingForPointsLinksToTheGeoreferencer', async () => {
        const world = await readyWorld(NOW);
        await seedVersion(world, JOB, needsGcpsVersion());

        await transition(world, runningJob(), runningJob({ status: 'awaiting_gcps' }));

        await expect(event(world.deps, `layer.needsPoints~${CITY}~${JOB}`)).resolves.toMatchObject({
            kind: 'layer.needsPoints',
            params: { label: 'Planul Bucureștilor 1911' },
            link: `#/georef/${JOB}`,
        });
    });

    it('badPath_aFailedJobWithoutAVersionNamesItsTypeAndLinksToJobs', async () => {
        const world = await readyWorld(NOW);
        const job = runningJob({ type: 'layer-delete', versionId: 'gone-version', status: 'failed' });

        await transition(world, undefined, job);

        await expect(event(world.deps, `job.failed~${CITY}~${JOB}~1`)).resolves.toMatchObject({
            params: { label: 'layer-delete' },
            link: '#/jobs',
        });
    });

    it('badPath_aVersionThatNoLongerReadsIsLeftOutOfTheNotice', async () => {
        const world = await readyWorld(NOW);
        world.deps.documents.seed(FIRESTORE_PATHS.layerVersion(CITY, JOB), { state: 'nonsense' });

        await transition(world, runningJob(), runningJob({ status: 'failed' }));

        await expect(event(world.deps, `job.failed~${CITY}~${JOB}~1`)).resolves.toMatchObject({
            params: { label: 'usgs-import' },
            link: '#/jobs',
        });
    });

    it('happyPath_onlyAStatusReachedWithThisWriteIsANotice', () => {
        expect(noticeOf(runningJob({ status: 'failed' }), runningJob({ status: 'failed' }))).toBeUndefined();
        expect(noticeOf(undefined, runningJob())).toBeUndefined();
        expect(noticeOf(runningJob(), runningJob({ status: 'awaiting_gcps' }))).toBe('layer.needsPoints');
    });
});

describe('emitNotification', () => {
    it('badPath_aRefusedWriteIsLoggedAndNeverFailsItsProducer', async () => {
        const deps = opsDeps(NOW);
        deps.documents.recorder.failNext('create', new Error('unavailable'));

        await expect(emitNotification(deps, 'ops', { kind: 'usgs.approved', parts: ['download'], link: '#/imagery' })).resolves.toBe(false);
        await expect(emitNotification(deps, 'ops', { kind: 'usgs.approved', parts: ['not/an id'], link: '#/imagery' })).resolves.toBe(
            false,
        );

        expect(deps.recording.records.filter((record) => record.message === 'notification not emitted')).toHaveLength(2);
    });
});
