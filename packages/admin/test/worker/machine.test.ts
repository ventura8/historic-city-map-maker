// M26 "This computer" (`packages/admin/src/worker/machine.ts`): the worker's `machine` read from its `/state`, an older
// worker that says none, and the owner's profile posted to `POST /profile`.
import { WORKER_STARTER_VERSION, type WorkerMachine } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { LOCAL_WORKER, LocalComputer } from '../../src/worker/local.js';
import { machineOf, postProfile, versionsOf } from '../../src/worker/machine.js';
import { CITY, contentWorld } from '../content/world.js';

const PROJECT = 'demo-hcm';

const MACHINE: WorkerMachine = {
    cpu: { cores: 16 },
    memory: { totalMb: 30_720, availableMb: 23_040 },
    power: { source: 'ac' },
    gpus: [],
    npus: [],
    backend: { matcher: 'cpu', why: 'no-gpu' },
    profile: { chosen: 'auto', active: 'full', why: 'idle' },
    budget: { threads: 14, memoryMb: 13_824, gpuFraction: 0.7 },
    usage: { cpuPct: 1, othersCpuPct: 2, memoryMb: 300 },
};

function state(machine: unknown): Record<string, unknown> {
    return { workerId: 'w-0123456789abcdef', signedIn: true, pairable: false, city: CITY, project: PROJECT, machine };
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

describe("this computer's machine (M26)", () => {
    it('happyPath_theStateSaysTheMachineAndTheOwnersProfileIsPosted @S-A141-HAPPY', async () => {
        const world = contentWorld();
        const posted: string[] = [];
        let answer = state(MACHINE);
        const fetch = (url: string, init?: RequestInit): Promise<Response> => {
            if (url === `${LOCAL_WORKER}/profile`) {
                posted.push(typeof init?.body === 'string' ? init.body : '');
                answer = state({ ...MACHINE, profile: { chosen: 'quiet', active: 'quiet', why: 'owner' } });
            }
            return Promise.resolve(Response.json(answer));
        };
        const local = new LocalComputer(world.services, {
            project: PROJECT,
            functionsBase: 'https://x.invalid',
            fetch,
            userAgent: 'Linux',
        });
        expect(local.state.machine).toEqual({ kind: 'unknown' });
        local.intents.find();
        await settle();
        expect(local.state.machine).toEqual({ kind: 'known', machine: MACHINE, failed: false });

        await local.intents.profile('quiet');
        expect(posted).toEqual(['{"profile":"quiet"}']);
        const shown = local.state.machine;
        expect(shown.kind === 'known' ? shown.machine.profile : null).toEqual({ chosen: 'quiet', active: 'quiet', why: 'owner' });
        local.stop();
    });

    it('badPath_aRefusedProfileIsSaidOnTheCardAndAnOldWorkerSaysNone @S-A141-BAD-OLD-WORKER', async () => {
        const world = contentWorld();
        let refuse = false;
        const fetch = (url: string): Promise<Response> =>
            url.endsWith('/profile') && refuse
                ? Promise.resolve(new Response('{}', { status: 400 }))
                : Promise.resolve(Response.json(state(MACHINE)));
        const local = new LocalComputer(world.services, {
            project: PROJECT,
            functionsBase: 'https://x.invalid',
            fetch,
            userAgent: 'Linux',
        });
        await local.intents.profile('full');
        local.intents.find();
        await settle();
        refuse = true;
        await local.intents.profile('full');
        expect(local.state.machine).toEqual({ kind: 'known', machine: MACHINE, failed: true });
        local.stop();

        expect(machineOf({ workerId: 'w-1' })).toEqual({ kind: 'old' });
        expect(machineOf(null)).toEqual({ kind: 'old' });
        expect(machineOf({ machine: null })).toEqual({ kind: 'unknown' });
        expect(machineOf({ machine: { cpu: { cores: 0 } } })).toEqual({ kind: 'old' });
        expect(await postProfile(() => Promise.reject(new TypeError('Failed to fetch')), LOCAL_WORKER, 'auto')).toBeNull();
    });
});

describe("this computer's versions", () => {
    const DIGEST = `sha256:${'cd'.repeat(32)}`;

    it('happyPath_theStateSaysTheImageAndTheStartersVersionOfThisRelease @S-A142-HAPPY-VERSIONS', async () => {
        const world = contentWorld();
        const answer = {
            ...state(MACHINE),
            image: DIGEST,
            outdated: false,
            starter: { version: WORKER_STARTER_VERSION, update: 'current' },
        };
        const local = new LocalComputer(world.services, {
            project: PROJECT,
            functionsBase: 'https://x.invalid',
            fetch: () => Promise.resolve(Response.json(answer)),
            userAgent: 'Linux',
        });
        expect(local.state.versions).toBeNull();
        local.intents.find();
        await settle();
        expect(local.state.versions).toEqual({
            said: true,
            image: DIGEST,
            imageCurrent: true,
            starter: WORKER_STARTER_VERSION,
            starterCurrent: true,
            update: 'current',
        });
        local.stop();
    });

    it('badPath_anOldStarterAnOutdatedImageAndWordsNobodyKnows @S-A142-BAD-OLD-STARTER', () => {
        expect(versionsOf({ image: 'latest', outdated: true, starter: { version: '2', update: 'whatever' } })).toEqual({
            said: true,
            image: null,
            imageCurrent: false,
            starter: '2',
            starterCurrent: false,
            update: null,
        });
        expect(versionsOf({ starter: { version: 'Bad Word!', update: 'bad-sum' } })).toMatchObject({ starter: null, update: 'bad-sum' });
        expect(versionsOf({ starter: null })).toMatchObject({ said: true, starter: null });
        expect(versionsOf(null)).toMatchObject({ said: false, image: null, imageCurrent: true, starter: null });
        expect(versionsOf({ outdated: false })).toMatchObject({ said: false });
    });

    it('happyPath_theSameInstalledDigestIsCurrentEvenWhileBusy @S-A142-HAPPY-VERSIONS', () => {
        expect(versionsOf({ image: DIGEST, outdated: false, starter: null }, DIGEST).imageCurrent).toBe(true);
        expect(versionsOf({ image: DIGEST, outdated: true, starter: null }, DIGEST).imageCurrent).toBe(true);
    });

    it('badPath_aDifferentDigestIsNotCurrentWhileTheOutdatedFlagIsStillFalse @S-A142-BAD-OLD-STARTER', () => {
        const installed = `sha256:${'ab'.repeat(32)}`;
        expect(versionsOf({ image: DIGEST, outdated: false, starter: null }, installed).imageCurrent).toBe(false);
    });

    it('badPath_anUnknownInstalledDigestFallsBackToTheOutdatedFlag @S-A142-BAD-OLD-STARTER', () => {
        expect(versionsOf({ image: DIGEST, outdated: false, starter: null }, null).imageCurrent).toBe(true);
        expect(versionsOf({ image: DIGEST, outdated: true, starter: null }, null).imageCurrent).toBe(false);
        expect(versionsOf({ image: DIGEST, outdated: false, starter: null }, 'not-a-digest').imageCurrent).toBe(true);
        expect(versionsOf({ image: DIGEST, outdated: true, starter: null }, 'not-a-digest').imageCurrent).toBe(false);
    });
});
