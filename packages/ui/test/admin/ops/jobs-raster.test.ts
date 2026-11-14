import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { JobItemPort, JobsIntentsPort, JobsViewState } from '../../../src/admin/jobs/jobs-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { jobItem, jobsState, page, ready } from './fixtures.js';

function area(state: JobsViewState): FakeArea<JobsViewState, JobsIntentsPort> {
    return new FakeArea<JobsViewState, JobsIntentsPort>(state, { cancel: Promise.resolve({ ok: true }), retryJob: Promise.resolve(true) });
}

function opened(job: JobItemPort, overrides: Partial<JobsViewState> = {}): JobsViewState {
    const doc = { id: job.id, path: `cities/bucharest/jobs/${job.id}`, version: '', pending: false, data: job };
    return jobsState({
        detail: { id: job.id, job: { status: 'ready', reconnecting: false, failure: null, doc }, logs: ready([]) },
        ...overrides,
    });
}

const FAILED = jobItem({
    status: 'failed',
    finished: true,
    retryable: true,
    error: { code: 'apiError.internal', message: 'gdalwarp ran out of memory' },
});

describe('<hcm-jobs-page>: raster jobs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theRasterStepsInWordsAndWhyAJobWaitsUntilWhen', async () => {
        const steps = ['extract', 'stitch', 'inspect', 'reference', 'register', 'guard', 'upload', 'tiles', 'finalize'].map((name) => ({
            name,
            status: 'done',
        }));
        const waiting = jobItem({ status: 'awaiting_approval', steps, waitReason: 'deferred', retryAt: '2026-10-21T09:00:00.000Z' });
        const { element } = await page('jobs', area(opened(waiting)), { params: ['b'] });

        expect(deepAll(element, '.facts dt').map((term) => term.textContent)).toEqual([
            'Unpacking the scan',
            "Joining the scan's parts",
            'Checking the file',
            'Preparing the reference map',
            'Recording the version',
            'Checking the budget',
            'Uploading to Mapbox',
            'Mapbox is building the tiles',
            'Finishing',
        ]);
        expect(deep(element, '[data-wait="deferred"]').textContent).toMatch(/^Publishes on .*21/);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aFailedRasterJobRunsAgainAndSaysItIsStarting', async () => {
        const jobs = area(opened(FAILED));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        const again = deepAll(element, '.pane .actions hcm-button').find((candidate) => candidate.textContent.trim() === 'Run it again');
        deep(again ?? element, 'button').click();
        jobs.set({ retrying: true });
        await updated(element);

        expect(jobs.named('retryJob')).toEqual(['retryJob']);
        expect(deepText(element)).toContain('Starting again…');
        expect(deepText(element)).toContain('gdalwarp ran out of memory');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aJobAwaitingItsPointsOpensTheGeoreferencer', async () => {
        const awaiting = jobItem({ status: 'awaiting_gcps', waitReason: 'gcps', versionId: 'job-1911' });
        const { element } = await page('jobs', area(opened(awaiting)), { params: ['b'] });

        expect(deep(element, '.pane .actions a').getAttribute('href')).toBe('#/georef/job-1911');
        expect(deepText(element)).toContain('Open the georeferencer');
    });

    it('badPath_noRetryForAJobOutOfAttemptsAReadOnlyPageOrAFinishedWait', async () => {
        const spent = jobItem({ status: 'failed', finished: true, retryable: false, waitReason: 'capacity' });
        const jobs = area(opened(spent));
        const { element } = await page('jobs', jobs, { params: ['b'] });
        const none = deepAll(element, '.pane .actions').length;
        const wait = deepAll(element, '[data-wait]').length;
        jobs.set(opened(FAILED));
        await updated(element);
        const awaitingWithoutVersion = jobItem({ status: 'awaiting_gcps', versionId: null });
        const readOnly = await page('jobs', area(opened(FAILED)), { params: ['b'], revoked: true });
        const button = deep(readOnly.element, '.pane .actions hcm-button') as HTMLElement & { disabled: boolean };
        jobs.set(opened(awaitingWithoutVersion));
        await updated(element);

        expect([none, wait]).toEqual([0, 0]);
        expect(button.disabled).toBe(true);
        expect(deepAll(element, '.pane .actions a')).toHaveLength(0);
    });
});

describe('<hcm-jobs-page>: Run again with the latest pipeline (lesson 728)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aCancelledSceneImportRunsAgainOnTheLatestPipeline @S-A130-HAPPY-RUN-AGAIN-JOB', async () => {
        const cancelled = jobItem({ status: 'cancelled', finished: true, rerunScene: 'LT51820291991181XXX03' });
        const jobs = new FakeArea<JobsViewState, JobsIntentsPort>(opened(cancelled), { runAgain: Promise.resolve(true) });
        const { element } = await page('jobs', jobs, { params: ['b'] });

        deep(deep(element, '[data-run-again]'), 'button').click();
        jobs.set({ rerunning: true });
        await updated(element);

        expect(jobs.calls).toContain('runAgain');
        expect(deep(element, '[data-run-again]').textContent).toContain('Importing');
        expect(deepText(element)).toContain('Free new download');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aJobWithNoSceneToRunAgainOffersNoButton @S-A130-BAD-RUN-AGAIN-JOB', async () => {
        const { element } = await page('jobs', area(opened(FAILED)), { params: ['b'] });

        expect(deepAll(element, '[data-run-again]')).toHaveLength(0);
    });
});
