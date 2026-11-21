// Pause (the owner's request of 2026-11-13; docs/research/M7-local-worker.md → Pause): `<hcm-job-pause>` on a job and the computer's
// pause in `<hcm-worker-panel>`, over a fake feed handed out by a fake app's Jobs store, as the admin's `JobsIntents.worker` does.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineWorkerElements } from '../../../src/admin/worker/define.js';
import type {
    WorkerFeedPort,
    WorkerHostPort,
    WorkerJobPort,
    WorkerSeenPort,
    WorkerViewPort,
} from '../../../src/admin/worker/worker-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';

defineWorkerElements();

const AT = '2026-11-13T09:00:00.000Z';

function view(changes: Partial<WorkerViewPort> = {}): WorkerViewPort {
    return {
        ...{ city: 'bucharest', status: 'ready', failure: null, worker: null, connected: true, choice: 'auto', image: null },
        ...{ usage: { vcpuSeconds: 0, gibSeconds: 0 }, job: null, acting: false, refusal: null },
        ...changes,
    };
}

function worker(changes: Partial<WorkerSeenPort> = {}): WorkerSeenPort {
    return {
        ...{ id: 'w-1', state: 'idle', seenAt: AT, jobId: null, lastJob: null, version: '1.0.0', outdated: false, revoked: false },
        ...{ ai: null, paused: null },
        ...changes,
    };
}

function job(changes: Partial<WorkerJobPort> = {}): WorkerJobPort {
    return {
        ...{ id: 'j1', status: 'queued', runOn: 'local', waitReason: null, estimate: { vcpuSeconds: 0, gibSeconds: 0 } },
        ...{ step: null, progress: null, overdue: false, paused: null },
        ...changes,
    };
}

class FakeFeed implements WorkerFeedPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: WorkerViewPort) => void>();

    constructor(public state: WorkerViewPort) {}

    readonly intents = {
        setChoice: (): Promise<boolean> => Promise.resolve(true),
        runJob: (): Promise<boolean> => Promise.resolve(true),
        retry: (): void => undefined,
        disconnect: (): Promise<boolean> => Promise.resolve(true),
        local: (): Promise<never> => Promise.reject(new Error('not here')),
        household: (): Promise<never> => Promise.reject(new Error('not here')),
        pauseJob: (action: string): Promise<boolean> => this.#record(`pauseJob ${action}`),
        pauseComputer: (length: string | null): Promise<boolean> => this.#record(`pauseComputer ${String(length)}`),
    };

    subscribe(listener: (state: WorkerViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    start(): void {
        this.calls.push('start');
    }

    stop(): void {
        this.calls.push('stop');
    }

    set(changes: Partial<WorkerViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }

    #record(call: string): Promise<boolean> {
        this.calls.push(call);
        return Promise.resolve(true);
    }
}

class FakeHost implements WorkerHostPort {
    readonly feed: FakeFeed;

    constructor(state: WorkerViewPort) {
        this.feed = new FakeFeed(state);
    }

    readonly content = { jobs: { intents: { worker: (): Promise<FakeFeed> => Promise.resolve(this.feed) } } };

    loadPage(): Promise<unknown> {
        return Promise.resolve('hcm-jobs-page');
    }
}

function t(key: AdminWorkerKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminWorker(locale, key, params);
}

function button(element: Element, label: string): HTMLElement {
    const found = deepAll(element, 'hcm-button').find((candidate) => candidate.textContent.trim() === label);
    if (found === undefined) {
        throw new Error(`no button ${label}`);
    }
    return deep(found, 'button');
}

async function jobPause(host: FakeHost, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(html`<hcm-job-pause .app=${host} locale=${locale} job="j1" self="u-me"></hcm-job-pause>`);
    await updated(element);
    return element;
}

async function panel(host: FakeHost): Promise<LitElement> {
    const element = await fixture<LitElement>(
        html`<hcm-worker-panel .app=${host} locale="en" project="demo-hcm" self="u-me"></hcm-worker-panel>`,
    );
    await updated(element);
    return element;
}

describe('<hcm-job-pause>', () => {
    afterEach(cleanup);

    it('happyPath_aQueuedJobOffersPauseAndAPausedOneSaysWhoAndWhenAndOffersResume @S-A170-HAPPY', async () => {
        const host = new FakeHost(view({ job: job() }));
        const element = await jobPause(host);

        button(element, t('adminWorker.job.pause')).click();
        expect(host.feed.calls).toContain('pauseJob pause');

        host.feed.set({ job: job({ paused: { by: 'u-me', at: AT, until: null } }) });
        await updated(element);
        expect(deep(element, '[data-paused]').textContent).toContain(t('adminWorker.job.you'));
        button(element, t('adminWorker.job.resume')).click();
        expect(host.feed.calls).toContain('pauseJob resume');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aRunningJobAskedToPauseSaysItStopsAfterItsStepInRomanianToo', async () => {
        const host = new FakeHost(view({ job: job({ status: 'running', paused: { by: 'u-other', at: AT, until: null } }) }));
        const element = await jobPause(host, 'ro');

        const said = deep(element, '[data-paused]').textContent;
        expect(said).toContain(t('adminWorker.job.other', undefined, 'ro'));
        expect(said).toContain(t('adminWorker.job.pausing', { who: '', when: '' }, 'ro').split('(')[0]?.trim() ?? '');
    });

    it('badPath_aFinishedJobOrNoJobShowsNoPause @S-A170-BAD-FINISHED', async () => {
        const host = new FakeHost(view({ job: job({ status: 'awaiting_approval' }) }));
        const element = await jobPause(host);
        expect(deepAll(element, 'hcm-button')).toHaveLength(0);

        host.feed.set({ job: null });
        await updated(element);
        expect(deepText(element).trim()).toBe('');
    });

    it('badPath_aRefusedPauseIsSaidInPlace', async () => {
        const host = new FakeHost(view({ job: job(), refusal: { key: 'apiError.imagery.notPausable' } }));
        const element = await jobPause(host);

        expect(deep(element, '[role="alert"]').textContent).not.toBe('');
    });
});

describe('<hcm-worker-panel>: Pause this computer', () => {
    afterEach(cleanup);

    it('happyPath_theThreeLengthsPauseTheComputerAndAPausedOneSaysWhoUntilWhenAndOffersResume @S-A171-HAPPY', async () => {
        const host = new FakeHost(view({ worker: worker() }));
        const element = await panel(host);

        for (const [length, key] of [
            ['forever', 'adminWorker.pause.forever'],
            ['hour', 'adminWorker.pause.hour'],
            ['tomorrow', 'adminWorker.pause.tomorrow'],
        ] as const) {
            button(element, t(key)).click();
            expect(host.feed.calls).toContain(`pauseComputer ${length}`);
        }

        host.feed.set({ worker: worker({ paused: { by: 'u-me', at: AT, until: '2026-11-13T10:00:00.000Z' } }) });
        await updated(element);
        const said = deep(element, '[data-computer-paused]').textContent;
        expect(said).toContain(t('adminWorker.pause.byYou'));
        expect(said).toContain(t('adminWorker.pause.what'));
        button(element, t('adminWorker.pause.resume')).click();
        expect(host.feed.calls).toContain('pauseComputer null');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aComputerPausedAtItselfOrByAnotherAdminSaysSoAndADisconnectedOneHasNoPause', async () => {
        const host = new FakeHost(view({ worker: worker({ paused: { by: 'computer', at: AT, until: null } }) }));
        const element = await panel(host);
        expect(deep(element, '[data-computer-paused]').getAttribute('data-computer-paused')).toBe('computer');
        expect(deepText(element)).toContain(t('adminWorker.pause.byComputer'));

        host.feed.set({ worker: worker({ paused: { by: 'u-other', at: AT, until: null } }) });
        await updated(element);
        expect(deepText(element)).toContain(t('adminWorker.pause.byOther'));

        host.feed.set({ worker: worker({ revoked: true }) });
        await updated(element);
        expect(deepAll(element, '[data-computer-pause]')).toHaveLength(0);
    });
});
