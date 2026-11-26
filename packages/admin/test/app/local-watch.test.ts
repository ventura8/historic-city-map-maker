// Finding 72 of 2026-11-02 (`src/app/local-watch.ts`): the shell looks at this computer's worker while the admin is open,
// only for the city this browser set the computer up for, and stops on sign-out or another city.
import { describe, expect, it } from 'vitest';

import { localWatch, watchComputer } from '../../src/app/local-watch.js';
import { Store } from '../../src/state/store.js';
import type { ShellState } from '../../src/state/state.js';
import { LOCAL_KEY } from '../../src/worker/local-key.js';
import { MemoryStore, testLog } from './fakes.js';

function state(auth: ShellState['auth'], cityId: string | null): ShellState {
    return { auth, cityId } as ShellState;
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function watched(answer: () => Promise<{ start(): void; stop(): void } | null>) {
    const local = new MemoryStore();
    const calls: string[] = [];
    const part = { start: () => calls.push('start'), stop: () => calls.push('stop') };
    const watch = localWatch({
        local,
        log: testLog().log,
        projectId: 'demo-hcm',
        part: (project) => {
            calls.push(`part ${project}`);
            return answer().then((found) => (found === null ? null : part));
        },
    });
    return { local, calls, watch, part };
}

describe("the shell's look at this computer", () => {
    it('happyPath_theMarkedCityIsLookedAtOnceAndLeftOnSignOutOrAnotherCity', async () => {
        const { local, calls, watch, part } = watched(() => Promise.resolve({ start: () => undefined, stop: () => undefined }));
        local.set(LOCAL_KEY, 'bucharest');

        watch.stateChanged(state('admin', 'bucharest'));
        watch.stateChanged(state('admin', 'bucharest'));
        await settle();
        expect(calls).toEqual(['part demo-hcm', 'start']);

        watch.stateChanged(state('signedOut', null));
        await settle();
        expect(calls).toEqual(['part demo-hcm', 'start', 'stop']);
        watch.stateChanged(state('admin', 'bucharest'));
        watch.stateChanged(state('admin', 'bacau'));
        await settle();
        expect(calls.slice(3)).toEqual(['part demo-hcm', 'start', 'stop']);
        expect(part).toBeDefined();
    });

    it('badPath_noMarkOrAPartThatDoesNotLoadAsksNothingOfTheComputer', async () => {
        const unmarked = watched(() => Promise.resolve({ start: () => undefined, stop: () => undefined }));
        unmarked.watch.stateChanged(state('admin', 'bucharest'));
        await settle();
        expect(unmarked.calls).toEqual([]);

        const failing = watched(() => Promise.reject(new Error('chunk lost')));
        failing.local.set(LOCAL_KEY, 'bucharest');
        failing.watch.stateChanged(state('admin', 'bucharest'));
        await settle();
        failing.watch.stop();
        await settle();
        expect(failing.calls).toEqual(['part demo-hcm']);

        const none = watched(() => Promise.resolve(null));
        none.local.set(LOCAL_KEY, 'bucharest');
        none.watch.stateChanged(state('admin', 'bucharest'));
        await settle();
        expect(none.calls).toEqual(['part demo-hcm']);
    });
});

describe("the shell's wiring of the look (watchComputer)", () => {
    it('happyPath_theJobsAreasComputerPartIsStartedForTheMarkedCityAndStoppedWithTheShell', async () => {
        const local = new MemoryStore();
        local.set(LOCAL_KEY, 'bucharest');
        const calls: string[] = [];
        const part = { start: () => calls.push('start'), stop: () => calls.push('stop') };
        const shell = new Store<ShellState>(state('signedOut', null), testLog().log);
        const stores = {
            jobs: {
                intents: {
                    worker: () =>
                        Promise.resolve({ intents: { local: (project: string) => (calls.push(project), Promise.resolve(part)) } }),
                },
            },
        };
        const pages = { load: (id: 'jobs') => (calls.push(`load ${id}`), Promise.resolve('hcm-jobs-page')) };

        const stop = watchComputer({ local, log: testLog().log, config: { projectId: 'demo-hcm' }, pages }, shell, stores);
        shell.update({ auth: 'admin', cityId: 'bucharest' });
        await settle();
        await settle();
        expect(calls).toEqual(['load jobs', 'demo-hcm', 'start']);

        stop();
        await settle();
        shell.update({ cityId: 'bacau' });
        expect(calls).toEqual(['load jobs', 'demo-hcm', 'start', 'stop']);
    });

    it('badPath_withoutTheJobsAreaNothingStarts', async () => {
        const local = new MemoryStore();
        local.set(LOCAL_KEY, 'bucharest');
        const shell = new Store<ShellState>(state('admin', 'bucharest'), testLog().log);
        const pages = { load: () => Promise.resolve(null) };

        const stop = watchComputer({ local, log: testLog().log, config: { projectId: 'demo-hcm' }, pages }, shell, { jobs: null });
        shell.update({ cityId: 'bucharest', auth: 'signedOut' });
        shell.update({ auth: 'admin' });
        await settle();
        stop();
        expect(local.get(LOCAL_KEY)).toBe('bucharest');
    });
});
