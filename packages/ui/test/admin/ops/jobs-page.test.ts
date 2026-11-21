import { JOB_TYPES } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { JobsIntentsPort, JobsViewState } from '../../../src/admin/jobs/jobs-port.js';
import { jobStatusText, jobTypeText, percentOf, statusTone, stepNameText, stepStateText } from '../../../src/admin/jobs/job-text.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { jobItem, jobsState, LOADING, nth, page, ready, route } from './fixtures.js';

function area(state: JobsViewState = jobsState()): FakeArea<JobsViewState, JobsIntentsPort> {
    return new FakeArea<JobsViewState, JobsIntentsPort>(state, { cancel: Promise.resolve({ ok: true }) });
}

function detail(job = jobItem()): NonNullable<JobsViewState['detail']> {
    return {
        id: job.id,
        job: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            doc: { id: job.id, path: `cities/bucharest/jobs/${job.id}`, version: '', pending: false, data: job },
        },
        logs: ready([
            { seq: 1, level: 'info', step: 'fetch', message: 'fetching the scene', at: '2026-10-17T09:01:00.000Z' },
            { seq: 2, level: 'error', step: null, message: '<b>not bold</b>', at: '2026-10-17T09:02:00.000Z' },
        ]),
    };
}

describe('<hcm-jobs-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theListOfJobsWithTheirStatusAndTheOpenJobsStepsAndLog', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/jobs/b', '#/jobs/a']);
        expect(rows[0]?.getAttribute('aria-current')).toBe('page');
        expect(rows[0]?.textContent).toContain('Running, 42 %');
        expect(deep(element, 'h2').textContent).toBe('USGS import');
        expect(
            deep(element, 'hcm-progress').getAttribute('aria-label') ??
                (deep(element, 'hcm-progress') as HTMLElement & { label: string }).label,
        ).toBe('Progress: 42 %');
        expect(deepAll(element, '.log li').map((line) => line.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            expect.stringContaining('Info · Downloading the scene: fetching the scene'),
            expect.stringContaining('Error: <b>not bold</b>'),
        ]);
        expect(deepAll(element, 'b')).toHaveLength(0);
        expect(jobs.named('open')).toEqual(['open ["b"]']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theFilterChipsAndMore', async () => {
        const jobs = area(jobsState({ list: ready([jobItem()], { hasMore: true }) }));
        const { element } = await page('jobs', jobs);

        const chips = deepAll(element, 'hcm-chip');
        deep(nth(chips, 2), 'button').click();
        deep(nth(chips, 0), 'button').click();
        deep(deep(element, '.more'), 'hcm-button').click();

        // The page asks once for the worker chunk's elements (M7: `workerElements`), then nothing but the user's actions.
        expect(jobs.calls.filter((call) => !call.startsWith('open'))).toEqual([
            'workerElements',
            'setFilter "failed"',
            'setFilter "all"',
            'more',
        ]);
        expect((chips[0] as HTMLElement & { selected: boolean }).selected).toBe(true);
        expect(deepText(element)).toContain('Choose a job to see its steps and log.');
    });

    it('happyPath_pauseAllAndResumeAllAskTheStoreAndAPausedJobReadsPaused @S-A170-HAPPY-ALL', async () => {
        const paused = jobItem({ paused: true, status: 'queued', progress: null });
        const jobs = area(jobsState({ list: ready([paused]), detail: detail(paused) }));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        expect(deep(element, 'a.row').textContent).toContain('Paused');
        expect(deep(element, '.pane [data-paused]').textContent).toBe('Paused');
        const [pauseAll, resumeAll] = deepAll(element, '[data-pause-all] hcm-button');
        pauseAll?.click();
        resumeAll?.click();
        expect(jobs.named('pauseAll')).toEqual(['pauseAll "pause"', 'pauseAll "resume"']);
    });

    it('badPath_whilePauseAllIsOnItsWayOrOnAReadOnlyPageItsButtonsAreOff', async () => {
        const jobs = area(jobsState({ pausingAll: true }));
        const { element } = await page('jobs', jobs);

        for (const button of deepAll(element, '[data-pause-all] hcm-button')) {
            expect((button as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        }
    });

    it('happyPath_cancelAsksFirstThenAsksTheJobToStop', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean };
        expect(dialog.open).toBe(true);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(jobs.named('cancel')).toEqual(['cancel']);
        expect(dialog.open).toBe(false);
    });

    it('badPath_keepingTheJobRunningCancelsNothingAndAStoppingJobsButtonIsOff', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element, app } = await page('jobs', jobs, { params: ['b'] });
        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        jobs.set({ detail: detail(jobItem({ cancelRequested: true })) });
        await updated(element);

        expect(jobs.named('cancel')).toEqual([]);
        const button = deep(element, '.pane .actions hcm-button') as HTMLElement & { disabled: boolean };
        expect([button.disabled, button.textContent.trim()]).toEqual([true, 'Stopping…']);
        expect(app.named('navigate')).toEqual([]);
    });
});

describe('<hcm-jobs-page>: a revoked admin', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_aReadOnlyPageCannotCancelAJob', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'], revoked: true });

        expect((deep(element, '.pane .actions hcm-button') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(deepText(element)).toContain('Downloading the scene');
    });
});

describe('<hcm-jobs-page>: waiting, finished and failing jobs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aWaitingJobSaysWhenAndAFinishedOneOffersNoCancelButShowsItsError', async () => {
        const waiting = jobItem({
            id: 'w',
            type: 'layer-delete',
            status: 'queued',
            progress: null,
            steps: [],
            dispatchAt: '2026-10-24T09:00:00.000Z',
        });
        const jobs = area(jobsState({ list: ready([waiting]), detail: detail(waiting) }));
        const { element, app } = await page('jobs', jobs, { params: ['w'] });
        expect(deepText(element)).toContain('Runs after Oct 24, 2026');
        expect(deep(element, 'h2').textContent).toBe("Deleting a layer's tiles");

        // Admin sweep 2026-11-14 (bug 2): never the stored message or a raw key, always the code's plain sentence.
        const failed = jobItem({
            status: 'failed',
            finished: true,
            error: { code: 'usgs.down', message: 'ZeroDivisionError: division by zero' },
        });
        jobs.set({ detail: detail(failed) });
        await route(app, element, ['b']);

        expect(deepAll(element, '.pane .actions hcm-button')).toHaveLength(0);
        expect(deep(element, '.alert').textContent).toContain('a fault on our side');
        expect(deep(element, '.alert').textContent).not.toContain('ZeroDivisionError');
        const stale = {
            code: 'apiError.imagery.joinPartGone',
            message: 'apiError.imagery.joinPartGone',
            params: { frame: 'DS1103-1058DF027' },
        };
        jobs.set({ detail: detail({ ...failed, error: stale }) });
        await updated(element);
        expect(deep(element, '.alert').textContent).toContain('DS1103-1058DF027');
        expect(deep(element, '.alert').textContent).not.toContain('apiError');
        jobs.set({ detail: { ...detail(failed), logs: ready([]) } });
        await updated(element);
        expect(deepText(element)).toContain('No log lines yet.');
        expect(deep(element, '.tag').dataset['tone']).toBe('error');
    });

    it('badPath_loadingErrorNotFoundEmptyAndReconnecting', async () => {
        const jobs = area(
            jobsState({
                list: LOADING,
                detail: { id: 'x', job: { status: 'loading', doc: null, reconnecting: false, failure: null }, logs: LOADING },
            }),
        );
        const { element, app } = await page('jobs', jobs, { params: ['x'], width: 1300 });
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(2);

        jobs.set({ detail: { id: 'x', job: { status: 'ready', doc: null, reconnecting: false, failure: null }, logs: ready([]) } });
        await updated(element);
        expect(deep(element, 'h2').textContent).toBe('This job does not exist.');

        jobs.set({
            list: { ...ready([]), status: 'error', failure: { kind: 'denied', code: 'permission-denied' } },
            detail: {
                id: 'x',
                job: { status: 'error', doc: null, reconnecting: false, failure: { kind: 'failed', code: 'internal' } },
                logs: ready([]),
            },
        });
        await updated(element);
        const alerts = deepAll(element, '[role="alert"]').map((alert) => alert.textContent.trim());
        expect(alerts).toEqual(['Access was refused. Check that you are still an admin.', 'This could not be read. Try again.']);
        // The list's Try again (Pause all and Resume all sit above the list since 2026-11-13).
        deepAll(element, '.actions:not([data-pause-all]) hcm-button')[0]?.click();
        expect(jobs.named('retry')).toHaveLength(1);

        jobs.set({ list: ready([], { reconnecting: true }), detail: null });
        await route(app, element, []);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('Reconnecting…');
        expect(deepText(element)).toContain('No jobs yet.');
    });

    it('happyPath_onAPhoneTheOpenJobReplacesTheListAndCloseGoesBack', async () => {
        const jobs = area(jobsState({ detail: detail(jobItem({ steps: [], progress: null })) }));
        const { element, app } = await page('jobs', jobs, { params: ['b'], width: 360 });

        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();

        expect(app.named('navigate')).toEqual(['navigate {"id":"jobs","params":[]}']);
        expect(deepAll(element, 'hcm-progress')).toHaveLength(0);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAStoreThePageIsEmptyAndDisconnectingCloses', async () => {
        const { element } = await page('jobs', null);
        expect(element.shadowRoot?.childElementCount).toBe(0);

        const jobs = area();
        const second = await page('jobs', jobs);
        second.element.remove();

        expect(jobs.named('close')).toEqual(['close']);
        expect(jobs.listening).toBe(0);
    });

    it('happyPath_aJoinAndItsStepsHaveTheirWords', () => {
        expect([jobTypeText('en', 'layer-join'), stepNameText('en', 'align'), stepNameText('en', 'merge')]).toEqual([
            'Join frames',
            'Aligning the seams',
            'Merging the frames',
        ]);
        expect([jobTypeText('ro', 'layer-join'), stepNameText('ro', 'align'), stepNameText('ro', 'merge')]).toEqual([
            'Unire cadre',
            'Alinierea îmbinărilor',
            'Contopirea cadrelor',
        ]);
    });

    it('happyPath_everyJobTypeHasItsOwnTitle_anArchiveSeriesIsAnArchiveImport', () => {
        for (const locale of ['ro', 'en'] as const) {
            const other = jobTypeText(locale, 'something-new');
            expect(JOB_TYPES.filter((type) => jobTypeText(locale, type) === other)).toEqual([]);
        }
        expect([jobTypeText('en', 'archive-series'), jobTypeText('ro', 'archive-series')]).toEqual(['Archive import', 'Import din arhivă']);
    });

    it('happyPath_theWordsOfJobsInRomanian', () => {
        expect([
            jobTypeText('ro', 'something-new'),
            jobStatusText('ro', 'waiting_usgs'),
            stepStateText('ro', 'odd'),
            stepStateText('ro', 'done'),
        ]).toEqual(['Procesare', 'Așteaptă USGS', 'În așteptare', 'Gata']);
        expect([
            statusTone({ status: 'cancelled', finished: true }),
            statusTone({ status: 'queued', finished: false }),
            percentOf({ progress: null }),
        ]).toEqual(['good', 'wait', null]);
    });
});

describe('<hcm-jobs-page>: its layout (batch 4)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theComputerIsAFullWidthCardAboveAListAndJobSideBySideFrom1200px @S-A62-HAPPY-JOBS-LAYOUT', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'], width: 1300 });
        await new Promise(requestAnimationFrame);
        await updated(element);
        const card = deep(element, 'details[data-computer]') as HTMLDetailsElement;
        const split = deep(element, 'hcm-list-detail');
        const list = deep(split, '.pane.list').getBoundingClientRect();

        expect(card.open).toBe(true);
        expect(deep(card, 'summary').textContent).toBe('Your computer, where new jobs run and Cloud Run this month');
        expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(split.getBoundingClientRect().top);
        expect(card.getBoundingClientRect().width).toBeGreaterThan(1200);
        expect(split.hasAttribute('split')).toBe(true);
        expect(list.width).toBeGreaterThanOrEqual(360);
        deep(card, 'summary').click();
        await updated(element);
        expect(card.open).toBe(false);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_under1200pxTheListAndTheJobAreStacked_theJobReplacesTheList @S-A62-BAD-JOBS-LAYOUT', async () => {
        const jobs = area(jobsState({ detail: detail(jobItem({ steps: [], progress: null })) }));
        const { element } = await page('jobs', jobs, { params: ['b'], width: 1000 });
        await new Promise(requestAnimationFrame);
        await updated(element);
        const split = deep(element, 'hcm-list-detail');

        expect(split.hasAttribute('split')).toBe(false);
        expect(deep(split, '.pane.list').hidden).toBe(true);
        expect(deep(split, '.back hcm-button').textContent.trim()).toBe('Back to the list');
    });
});
