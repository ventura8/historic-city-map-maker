// M7's elements (docs/research/M7-local-worker.md §7): the local worker's panel and a version's place, over a fake feed that
// a fake app's Jobs store hands out, as the admin's `JobsIntents.worker` does.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { html, render, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { wordedWait, versionDetail } from '../../../src/admin/imagery/imagery-text.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { defineWorkerElements } from '../../../src/admin/worker/define.js';
import { defineWorkerLocal } from '../../../src/admin/worker/hcm-worker-local.js';
import { loadWorkerElements } from '../../../src/admin/worker/load.js';
import type { WorkerFeedPort, WorkerHostPort, WorkerViewPort } from '../../../src/admin/worker/worker-port.js';
import { FakeHousehold } from './fake-household.js';
import { FakeLocal } from './fake-local.js';
import { defineWorkerHousehold } from '../../../src/admin/worker/hcm-worker-household.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { setupView, stepView } from '../setup/fixtures.js';
import { installSliceView } from '../setup/install-fixtures.js';

defineWorkerElements();
defineWorkerElements();
defineHcmSetupPipeline();

const DIGEST = `sha256:${'b'.repeat(64)}`;

function view(changes: Partial<WorkerViewPort> = {}): WorkerViewPort {
    return {
        city: 'bucharest',
        status: 'ready',
        failure: null,
        worker: null,
        connected: false,
        choice: 'auto',
        image: DIGEST,
        usage: { vcpuSeconds: 12_345, gibSeconds: 45_678 },
        job: null,
        acting: false,
        refusal: null,
        ...changes,
    };
}

/** A worker as the feed reads it: idle, its image current, not disconnected. */
function seen(changes: Partial<NonNullable<WorkerViewPort['worker']>> = {}): NonNullable<WorkerViewPort['worker']> {
    return {
        id: 'w-1',
        state: 'idle',
        seenAt: '2026-11-02T09:00:00.000Z',
        jobId: null,
        lastJob: null,
        version: '1.0.0',
        outdated: false,
        revoked: false,
        ai: null,
        paused: null,
        ...changes,
    };
}

class FakeFeed implements WorkerFeedPort {
    readonly calls: string[] = [];
    readonly locals: FakeLocal[] = [];
    localFails = false;
    readonly #listeners = new Set<(state: WorkerViewPort) => void>();
    state: WorkerViewPort;

    constructor(state: WorkerViewPort) {
        this.state = state;
    }

    readonly intents = {
        setChoice: (choice: string): Promise<boolean> => this.#record(`setChoice ${choice}`),
        runJob: (place: string, ok: boolean): Promise<boolean> => this.#record(`runJob ${place} ${String(ok)}`),
        retry: (): void => {
            this.calls.push('retry');
        },
        disconnect: (): Promise<boolean> => this.#record('disconnect'),
        pauseJob: (action: string): Promise<boolean> => this.#record(`pauseJob ${action}`),
        pauseComputer: (length: string | null): Promise<boolean> => this.#record(`pauseComputer ${String(length)}`),
        local: (project: string): Promise<FakeLocal> => {
            this.calls.push(`local ${project}`);
            if (this.localFails) {
                return Promise.reject(new Error('chunk lost'));
            }
            defineWorkerLocal();
            const local = new FakeLocal();
            this.locals.push(local);
            return Promise.resolve(local);
        },
        household: (project: string): Promise<FakeHousehold> => {
            this.calls.push(`household ${project}`);
            defineWorkerHousehold();
            return Promise.resolve(new FakeHousehold());
        },
    };

    subscribe(listener: (state: WorkerViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    start(jobId: string | null): void {
        this.calls.push(`start ${String(jobId)}`);
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
    readonly calls: string[] = [];
    readonly feeds: FakeFeed[] = [];
    fails = false;
    /** The feeds' computer part does not load (its chunk lost). */
    localFails = false;

    constructor(readonly state: WorkerViewPort = view()) {}

    readonly content = {
        jobs: {
            intents: {
                worker: (): Promise<FakeFeed> => {
                    const feed = new FakeFeed(this.state);
                    feed.localFails = this.localFails;
                    this.feeds.push(feed);
                    return Promise.resolve(feed);
                },
                workerElements: (): Promise<void> => {
                    this.calls.push('workerElements');
                    return Promise.resolve();
                },
            },
        },
    };

    loadPage(id: 'jobs'): Promise<unknown> {
        this.calls.push(`loadPage ${id}`);
        return this.fails ? Promise.reject(new Error('chunk lost')) : Promise.resolve('hcm-jobs-page');
    }

    get feed(): FakeFeed {
        const feed = this.feeds.at(-1);
        if (feed === undefined) {
            throw new Error('no feed yet');
        }
        return feed;
    }
}

function t(locale: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(locale, key, params);
}

async function panel(host: WorkerHostPort | null, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(html`<hcm-worker-panel .app=${host} locale=${locale} project="demo-hcm"></hcm-worker-panel>`);
    await updated(element);
    return element;
}

async function place(host: WorkerHostPort, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(html`<hcm-run-place .app=${host} locale=${locale} job="j1"></hcm-run-place>`);
    await updated(element);
    return element;
}

function button(element: Element, label: string): HTMLElement {
    const found = deepAll(element, 'hcm-button').find((candidate) => candidate.textContent.trim() === label);
    if (found === undefined) {
        throw new Error(`no button ${label}`);
    }
    return deep(found, 'button');
}

describe('<hcm-worker-panel>', () => {
    afterEach(cleanup);

    it('happyPath_aConnectedComputerItsLastJobThisComputersPartTheChoiceAndTheMeter', async () => {
        const seenAt = '2026-11-02T09:59:00.000Z';
        const host = new FakeHost(
            view({
                connected: true,
                worker: seen({ seenAt, lastJob: { id: 'j0', outcome: 'done', at: seenAt } }),
            }),
        );
        const element = await panel(host);
        await updated(element);
        const text = deepText(element);

        expect(host.feed.calls).toEqual(['start null', 'local demo-hcm', 'household demo-hcm']);
        expect(text).toContain(t('en', 'adminWorker.connected', { when: '' }).split(' Seen')[0] ?? '');
        expect(text).toContain(t('en', 'adminWorker.lastDone', { when: '' }).slice(0, 10));
        expect(deep(element, '[data-worker-version]').textContent).toBe(t('en', 'adminWorker.version', { version: '1.0.0' }));
        // Finding 72: this computer's part comes from the lazy chunk, started with the panel and stopped when it goes.
        const local = deep(element, 'hcm-worker-local') as LitElement & { image: string; city: string; project: string };
        expect([local.image, local.city, local.project]).toEqual([DIGEST, 'bucharest', 'demo-hcm']);
        expect(host.feed.locals[0]?.calls).toEqual(['start']);
        expect(text).not.toContain('mkdir');
        expect(text).toContain('Processor: 12,345 of 180,000 free seconds · memory: 45,678 of 360,000 free GiB-seconds');
        // The bar shows the larger share: 45,678 of 360,000 GiB-seconds is more than 12,345 of 180,000 vCPU-seconds.
        expect((deepAll(element, 'hcm-progress').at(-1) as LitElement & { value: number }).value).toBeCloseTo(45_678 / 360_000);
        expect(await axeViolations(element)).toEqual([]);
        element.remove();
        expect(host.feed.locals[0]?.calls).toEqual(['start', 'stop']);
    });

    it('badPath_aComputersPartThatDoesNotLoadLeavesThePanelWithoutIt', async () => {
        const host = new FakeHost();
        host.localFails = true;
        const element = await panel(host);
        await updated(element);

        expect(deepAll(element, 'hcm-worker-local')).toHaveLength(0);
        expect(deepText(element)).toContain(t('en', 'adminWorker.choice'));
    });

    it('happyPath_theChoiceIsChangedFromTheSegmentedButton', async () => {
        const host = new FakeHost();
        const element = await panel(host, 'ro');
        const choice = deepAll(element, 'hcm-segmented-button').find(
            (found) => (found as LitElement & { label: string }).label === t('ro', 'adminWorker.choice'),
        );
        const segments = deepAll(choice ?? element, 'button');

        expect(segments.map((segment) => segment.textContent.trim())).toEqual([
            t('ro', 'adminWorker.choice.auto'),
            t('ro', 'adminWorker.choice.local'),
            t('ro', 'adminWorker.choice.cloud'),
        ]);
        segments[2]?.click();
        await updated(element);
        expect(host.feed.calls).toContain('setChoice cloud');
        expect(deepText(element)).toContain('Procesor: 12.345 din 180.000 secunde gratuite');
    });

    it('badPath_noComputerAStaleOneABusyOneAndAFailedLastJob', async () => {
        const host = new FakeHost();
        const element = await panel(host);
        expect(deepText(element)).toContain(t('en', 'adminWorker.none'));

        const seenAt = '2026-11-02T09:00:00.000Z';
        host.feed.set({ worker: seen({ state: 'busy', seenAt, jobId: 'j7' }) });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.working'));
        expect(deep(element, 'a[href="#/jobs/j7"]').textContent).toBe('j7');
        // Silent while busy on a job: a long step, said as such with the way to Jobs, never "no computer connected".
        expect(deep(element, '[data-worker-silent="busy"]').textContent).toContain(
            t('en', 'adminWorker.busySilent', { when: '' }).slice(0, 30),
        );
        expect(deep(element, 'a[href="#/jobs"]').textContent).toBe(t('en', 'adminWorker.busyHelp'));
        expect(deepText(element)).not.toContain(t('en', 'adminWorker.none'));

        // Busy without a job yet, and no job before: nothing about jobs.
        host.feed.set({ worker: seen({ state: 'busy', seenAt }) });
        await updated(element);
        expect(deepAll(element, 'a[href^="#/jobs/"]')).toHaveLength(0);

        host.feed.set({ worker: seen({ seenAt, lastJob: { id: 'j7', outcome: 'failed', at: seenAt } }) });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.lastFailed', { when: '' }).slice(0, 15));
        expect(deepText(element)).toContain(t('en', 'adminWorker.lastSeen', { when: '' }).slice(0, 9));
    });

    it('badPath_withoutTheImagesDigestNoCommandButTheWayToUpdateThePipeline', async () => {
        const host = new FakeHost(view({ image: null }));
        const element = await panel(host);

        expect(deepAll(element, 'pre')).toHaveLength(0);
        expect(deepText(element)).toContain(t('en', 'adminWorker.noImage'));
        expect(deep(element, 'a[href="#/setup/pipeline"]').textContent).toBe(t('en', 'adminWorker.openSetup'));

        host.feed.set({ image: undefined });
        await updated(element);
        expect(deepAll(element, 'a[href="#/setup/pipeline"]')).toHaveLength(0);
    });

    it('badPath_aRefusalIsAnnouncedAndAStoppedListenerOffersTryAgain', async () => {
        const host = new FakeHost(view({ refusal: { key: 'apiError.imagery.versionState' } }));
        const element = await panel(host);
        expect(deep(element, '[role="alert"]').textContent).not.toBe('');

        host.feed.set({ status: 'error', failure: { kind: 'failed', code: 'internal' } });
        await updated(element);
        deep(deepAll(element, 'hcm-button').at(0) ?? element, 'button').click();
        expect(host.feed.calls).toContain('retry');
    });

    it('badPath_noAppAChunkThatDoesNotLoadAndALeavingPanelShowNothingAndStopTheFeed', async () => {
        expect(deepText(await panel(null))).toBe('');
        const failing = new FakeHost();
        failing.fails = true;
        expect(deepText(await panel(failing))).toBe('');

        const host = new FakeHost();
        const element = await panel(host);
        const first = host.feed;
        element.remove();
        expect(first.calls).toEqual(['start null', 'local demo-hcm', 'household demo-hcm', 'stop']);
        document.body.append(element);
        await updated(element);
        expect(host.feeds).toHaveLength(2);

        // A new app while the first is still answering: only the last one's feed starts.
        const next = new FakeHost();
        (element as LitElement & { app: WorkerHostPort }).app = new FakeHost();
        await element.updateComplete;
        (element as LitElement & { app: WorkerHostPort }).app = next;
        await updated(element);
        expect(next.feed.calls).toEqual(['start null', 'local demo-hcm', 'household demo-hcm']);
    });
});

describe('<hcm-worker-panel>: findings 66-68 of 2026-11-02', () => {
    afterEach(cleanup);

    it('happyPath_aConnectedWorkersJobShowsItsStepAndProgressAndDisconnectAsksTheFeed', async () => {
        const worker = seen({ state: 'busy', jobId: 'j7' });
        const estimate = { vcpuSeconds: 0, gibSeconds: 0 };
        const job = { id: 'j7', status: 'running', runOn: 'local', waitReason: null, estimate, paused: null } as const;
        const host = new FakeHost(view({ connected: true, worker, job: { ...job, step: 'georef', progress: 0.4, overdue: false } }));
        const element = await panel(host);

        expect(deep(element, '[data-progress]').textContent).toBe(t('en', 'adminWorker.progress', { step: 'georef', percent: '40' }));
        button(element, t('en', 'adminWorker.disconnect')).click();
        expect(host.feed.calls).toContain('disconnect');

        host.feed.set({ job: { ...job, step: null, progress: null, overdue: false } });
        await updated(element);
        expect(deepAll(element, '[data-progress]')).toHaveLength(0);
        host.feed.set({ job: { ...job, id: 'other', step: 'warp', progress: null, overdue: false } });
        await updated(element);
        expect(deepAll(element, '[data-progress]')).toHaveLength(0);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anOutdatedWorkerIsToldToUpdateAndADisconnectedOneSaysSo', async () => {
        const host = new FakeHost(view({ connected: true, worker: seen({ outdated: true }) }));
        const element = await panel(host);
        expect(deep(element, '[data-outdated]').textContent).toBe(t('en', 'adminWorker.outdated', { version: '1.0.0' }));
        expect(deepAll(element, '[data-worker-version]')).toHaveLength(0);

        host.feed.set({ connected: false, worker: seen({ revoked: true }) });
        await updated(element);
        expect(deepAll(element, '[data-outdated]')).toHaveLength(0);
        expect(deepText(element)).toContain(t('en', 'adminWorker.disconnected'));
        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.trim() === t('en', 'adminWorker.disconnect'))).toBe(false);
    });
});

describe('<hcm-worker-panel>: the local AI (docs/research/M10-local-ai.md)', () => {
    afterEach(cleanup);

    it('happyPath_itNamesTheGraphicsCardItRunsOn @S-A68-HAPPY-DEVICE-SHOWN', async () => {
        const ai = { state: 'ready', device: 'gpu', deviceName: 'NVIDIA RTX 3080' } as const;
        const element = await panel(new FakeHost(view({ connected: true, worker: seen({ ai }) })));

        expect(deep(element, '[data-ai="ready"]').textContent).toBe(t('en', 'adminWorker.ai.gpu', { name: 'NVIDIA RTX 3080' }));
        expect(deep(element, '[data-ai="ready"]').textContent).toBe('Local AI: graphics card NVIDIA RTX 3080.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        [{ state: 'ready', device: 'cpu' }, 'adminWorker.ai.cpu'],
        [{ state: 'idle' }, 'adminWorker.ai.idle'],
        [{ state: 'preparing' }, 'adminWorker.ai.preparing'],
    ] as const)('happyPath_%jIsSaid @S-A68-HAPPY-DEVICE-SHOWN', async (ai, key) => {
        const element = await panel(new FakeHost(view({ connected: true, worker: seen({ ai }) })));

        expect(deep(element, `[data-ai="${ai.state}"]`).textContent).toBe(t('en', key));
    });

    // M18 item 9 (docs/research/M18-improvements.md): an old starter file is what to do and what it unlocks, as an alert.
    it('badPath_anOldStarterFileSaysTheOneActionAndWhatItUnlocks @S-A68-BAD-OLD-STARTER', async () => {
        const ai = { state: 'unavailable', why: 'old-starter' } as const;
        const element = await panel(new FakeHost(view({ connected: true, worker: seen({ ai }) })));

        const said = deep(element, '[data-ai="old-starter"]');
        expect(said.className).toBe('alert');
        expect(said.textContent).toBe(t('en', 'adminWorker.ai.oldStarter'));
        expect(said.textContent).toContain('Use this computer');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each(['arm64', 'disk', 'pull', 'tampered', 'unreachable', 'no-answer', 'garbage'] as const)(
        'badPath_unavailableBecause_%s_saysWhy @S-A68-BAD-AI-UNAVAILABLE',
        async (why) => {
            const ai = { state: 'unavailable', why } as const;
            const element = await panel(new FakeHost(view({ connected: true, worker: seen({ ai }) })));

            const said = deep(element, '[data-ai="unavailable"]').textContent;
            expect(said).toBe(t('en', 'adminWorker.ai.unavailable', { why: t('en', `adminWorker.ai.why.${why}`) }));
            expect(said).not.toContain('{why}');
        },
    );

    it('badPath_noReasonOnRecordStillSaysItIsUnavailable @S-A68-BAD-AI-UNAVAILABLE', async () => {
        const element = await panel(new FakeHost(view({ connected: true, worker: seen({ ai: { state: 'unavailable' } }) })));

        expect(deep(element, '[data-ai="unavailable"]').textContent).toContain(t('en', 'adminWorker.ai.why.no-answer'));
    });

    it('badPath_aWorkerOlderThanTheAiOrNotConnectedSaysNothingOfIt @S-A68-BAD-AI-UNAVAILABLE', async () => {
        expect(deepAll(await panel(new FakeHost(view({ connected: true, worker: seen() }))), '[data-ai]')).toHaveLength(0);
        const gone = new FakeHost(view({ connected: false, worker: seen({ ai: { state: 'idle' } }) }));
        expect(deepAll(await panel(gone), '[data-ai]')).toHaveLength(0);
    });
});

describe('<hcm-run-place>', () => {
    afterEach(cleanup);

    function job(changes: Partial<NonNullable<WorkerViewPort['job']>> = {}): WorkerViewPort['job'] {
        return {
            id: 'j1',
            status: 'queued',
            runOn: 'cloud',
            waitReason: null,
            estimate: { vcpuSeconds: 12_600, gibSeconds: 50_400 },
            step: null,
            progress: null,
            overdue: false,
            paused: null,
            ...changes,
        };
    }

    it('happyPath_aCloudJobOffersTheComputerAndALocalOneTheCloud', async () => {
        const host = new FakeHost(view({ job: job() }));
        const element = await place(host);

        expect(host.feed.calls).toEqual(['start j1']);
        expect(deepText(element)).toContain(t('en', 'adminWorker.place.cloud'));
        button(element, t('en', 'adminWorker.runLocal')).click();
        expect(host.feed.calls).toContain('runJob local false');

        host.feed.set({ job: job({ runOn: 'local' }) });
        await updated(element);
        button(element, t('en', 'adminWorker.runCloud')).click();
        expect(host.feed.calls).toContain('runJob cloud false');

        host.feed.set({ job: job({ runOn: null }) });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.place.auto'));
        expect(deepAll(element, 'hcm-button')).toHaveLength(2);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_pastTheFreeTierItShowsTheEstimateAndTheMonthAndAsksForTheOk', async () => {
        const host = new FakeHost(view({ job: job({ waitReason: 'free-tier' }) }));
        const element = await place(host, 'ro');

        expect(deepText(element)).toContain(t('ro', 'adminWorker.estimate', { vcpu: '12.600', gib: '50.400' }));
        expect(deepText(element)).toContain(t('ro', 'adminWorker.meter'));
        button(element, t('ro', 'adminWorker.runCloudAnyway')).click();
        button(element, t('ro', 'adminWorker.runLocal')).click();
        expect(host.feed.calls).toEqual(['start j1', 'runJob cloud true', 'runJob local false']);
    });

    it('badPath_waitingForTheComputerLinksTheJobsPageAndTheCloudIsOneClickAway', async () => {
        const host = new FakeHost(view({ job: job({ runOn: 'local', waitReason: 'worker' }), acting: true }));
        const element = await place(host);

        expect(deepText(element)).toContain(t('en', 'adminWorker.waitWorker'));
        expect(deep(element, 'a[href="#/jobs"]').textContent).toBe(t('en', 'adminWorker.startWorker'));
        expect(button(element, t('en', 'adminWorker.runCloud')).hasAttribute('disabled')).toBe(true);
        expect(deepAll(element, '[data-overdue]')).toHaveLength(0);
    });

    it('happyPath_aJobNoComputerCameForOffersTheCloudInsteadFirst @S-A62-HAPPY-NO-WORKER-OFFER', async () => {
        const host = new FakeHost(view({ job: job({ runOn: 'local', waitReason: 'worker', overdue: true }) }));
        const element = await place(host, 'ro');

        expect(deep(element, '[data-overdue]').textContent).toBe(t('ro', 'adminWorker.waitOverdue', { minutes: '15' }));
        button(element, t('ro', 'adminWorker.runCloudInstead')).click();
        expect(host.feed.calls).toEqual(['start j1', 'runJob cloud false']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aLocalOnlyJobIsNeverOfferedTheCloud @S-A121-BAD-LOCAL-ONLY-CLOUD', async () => {
        const waiting = await place(new FakeHost(view({ job: job({ runOn: 'local', waitReason: 'worker', localOnly: true }) })));
        expect(deepText(waiting)).toContain(t('en', 'adminWorker.waitWorker'));
        expect(deepAll(waiting, 'hcm-button')).toHaveLength(0);
        const queued = await place(new FakeHost(view({ job: job({ runOn: 'local', waitReason: null, localOnly: true }) })));
        expect(deepAll(queued, 'hcm-button')).toHaveLength(0);
    });

    it('badPath_aRunningJobOrNoneShowsNothing', async () => {
        const host = new FakeHost(view({ job: job({ status: 'running' }) }));
        expect(deepText(await place(host))).toBe('');
        expect(deepText(await place(new FakeHost(view())))).toBe('');
        const empty = await fixture<LitElement & { job: string }>(html`<hcm-run-place .app=${new FakeHost()}></hcm-run-place>`);
        await updated(empty);
        expect(deepText(empty)).toBe('');
    });
});

describe('the worker chunk around its elements', () => {
    afterEach(cleanup);

    it('happyPath_aPageHasTheElementsRegisteredThroughTheJobsStore', async () => {
        const host = new FakeHost();
        loadWorkerElements(host);
        loadWorkerElements(null);
        await updated(document.body);
        expect(host.calls).toEqual(['loadPage jobs', 'workerElements']);

        const failing = new FakeHost();
        failing.fails = true;
        loadWorkerElements(failing);
        await updated(document.body);
        expect(failing.calls).toEqual(['loadPage jobs']);
    });

    it('happyPath_thePipelineCardShowsThePanelOnceAPipelineIsInstalled', async () => {
        const base = setupView({ install: installSliceView({ pipeline: { state: 'installed', installedRelease: '1.0.0' } }) });
        const state = { ...base, steps: { ...base.steps, pipeline: stepView('pipeline'), site: stepView('site') } };
        const host = new FakeHost();
        const card = await fixture<LitElement>(html`<hcm-setup-pipeline .view=${state} .app=${host} locale="en"></hcm-setup-pipeline>`);
        await updated(card);
        expect(deep(card, 'hcm-worker-panel').getAttribute('level')).toBe('3');
        expect(host.calls).toContain('workerElements');

        const none = setupView({ install: installSliceView() });
        render(
            html`<hcm-setup-pipeline .view=${{ ...none, steps: { ...none.steps, pipeline: stepView('pipeline') } }}></hcm-setup-pipeline>`,
            card.parentElement ?? document.body,
        );
        await updated(card);
    });

    it('happyPath_aWaitForTheComputerOrTheOkHasNoLineOfItsOwn', () => {
        expect(wordedWait('worker')).toBeNull();
        expect(wordedWait('free-tier')).toBeNull();
        expect(wordedWait(null)).toBeNull();
        expect(wordedWait('capacity')).toBe('capacity');
        const version = { state: 'processing' } as Parameters<typeof versionDetail>[1];
        expect(
            versionDetail('en', version, { waitReason: 'worker', retryAt: null, progress: null } as Parameters<typeof versionDetail>[2]),
        ).toBe('Processing');
    });
});
