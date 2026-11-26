/**
 * W5, household computers (`packages/admin/src/worker/household.ts`, `docs/research/M7-local-worker.md` *Household computers*): the
 * city's computers as the list shows them (online by the clock, the removal's step, a disconnected one for a day), Rename, Pause,
 * Resume and Remove through `worker.manage`, Disconnect now anyway through `worker.revoke`, and Add another computer's line.
 */
import { FIRESTORE_PATHS, WORKER_STARTER_VERSION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createWorkerFeed } from '../../src/worker/feed.js';
import { cleanupLine, functionsBaseOf, headlessLine, Household, starterUrl } from '../../src/worker/household.js';
import { failure } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

const BASE = 'https://us-central1-demo-hcm.cloudfunctions.net';
const WORKER = 'w-0123456789abcdef';
const CODE = 'abcdefghijklmnopqrstuvwxyz';

function before(world: ContentWorld, seconds: number): string {
    return new Date(world.clock.now() - seconds * 1000).toISOString();
}

function workerDoc(seenAt: string, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uid: 'admin-uid',
        version: '1.0.0',
        startedAt: at('2025-10-01T00:00:00Z'),
        lastSeenAt: at(seenAt),
        state: 'idle',
        updatedBy: 'admin-uid',
        updatedAt: at(seenAt),
        ...more,
    };
}

function householdOf(world: ContentWorld): Household {
    const household = new Household(world.services, { functionsBase: BASE, adminUrl: 'https://demo-hcm.web.app/admin/#/jobs' });
    household.start();
    return household;
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the lines', () => {
    it('happyPath_theHeadlessLineCarriesTheCodeOnStandardInput @S-A143-HAPPY-HEADLESS-PAIR', () => {
        const line = headlessLine(BASE, CITY, CODE);

        expect(line).toBe(
            `curl -fsSL '${BASE}/worker-starter?city=${CITY}&os=linux&action=install' -o ~/hcm-worker.sh && echo ${CODE} | sh ~/hcm-worker.sh`,
        );
        // The code reaches the starter on standard input: never an argument of a program.
        expect(line.split('|')[1]).not.toContain(CODE);
    });

    it('happyPath_theCleanupLineFitsEachSystem', () => {
        expect(cleanupLine(BASE, CITY, 'linux')).toBe(
            `curl -fsSL '${starterUrl(BASE, CITY, 'linux', 'uninstall')}' -o ~/hcm-worker-remove.sh && sh ~/hcm-worker-remove.sh`,
        );
        expect(cleanupLine(BASE, CITY, 'mac')).toContain('~/hcm-worker-remove.command');
        expect(cleanupLine(BASE, CITY, 'windows')).toContain('Invoke-WebRequest');
        expect(functionsBaseOf('demo-hcm', true)).toBe('http://127.0.0.1:5001/demo-hcm/us-central1');
        expect(functionsBaseOf('demo-hcm', false)).toBe(BASE);
    });
});

describe('the city computers', () => {
    it('happyPath_eachComputerIsListedWithItsNameShareAndHelper @S-A143-HAPPY-LIST', async () => {
        const world = contentWorld();
        const share = { profile: 'quiet', why: 'user-active', cores: 8, threads: 2, memoryMb: 4096 };
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, WORKER),
            workerDoc(before(world, 30), { host: 'nuc', os: 'linux', starter: WORKER_STARTER_VERSION, share }),
        );
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, 'w-1111111111111111'),
            workerDoc(before(world, 600), { name: 'Laptop', pausedAt: at('2025-10-01T00:00:00Z') }),
        );
        const household = householdOf(world);
        await settle();

        expect(household.state.computers).toMatchObject([
            { id: WORKER, name: 'nuc', online: true, share, starterCurrent: true, os: 'linux', paused: false, removal: null },
            { id: 'w-1111111111111111', name: 'Laptop', online: false, paused: true, starter: null, starterCurrent: false, os: 'linux' },
        ]);
        // Three minutes on, the first goes offline with no change to read (the list looks again every 30 s).
        world.clock.advance(180_000);
        expect(household.state.computers[0]?.online).toBe(false);
        household.stop();
    });

    it('badPath_aComputerDisconnectedOverADayAgoIsNoLongerListed', async () => {
        const world = contentWorld();
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 60), { revokedAt: at(before(world, 3600)) }));
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, 'w-1111111111111111'),
            workerDoc(before(world, 60), { revokedAt: at(before(world, 2 * 86_400)) }),
        );
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, 'w-2222222222222222'),
            workerDoc(before(world, 120), {
                removal: { step: 'asked', askedAt: at(before(world, 60)), docker: true, keep: false },
            }),
        );
        const household = householdOf(world);
        await settle();

        expect(household.state.computers.map((computer) => [computer.id, computer.revoked, computer.online])).toEqual([
            [WORKER, true, false],
            ['w-2222222222222222', false, true],
        ]);
        expect(household.state.computers[1]?.removal).toEqual({ step: 'asked', docker: true, keep: false });
    });
});

describe('what each computer shares (M20 §22)', () => {
    const sharing = (world: ContentWorld, seconds: number, more: Record<string, unknown> = {}) => ({
        state: 'sending',
        computers: 2,
        jobId: 'ar-series',
        sentBytes: 300,
        totalBytes: 1000,
        day: new Date(world.clock.now()).toISOString().slice(0, 10),
        dayBytes: 0,
        at: at(before(world, seconds)),
        ...more,
    });

    it('happyPath_aCopyUnderWayAndTodaysLimitAreShown @S-A143-HAPPY-SHARING', async () => {
        const world = contentWorld();
        const seen = before(world, 30);
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(seen, { sharing: sharing(world, 20) }));
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, 'w-1111111111111111'),
            workerDoc(seen, { sharing: sharing(world, 3000, { state: 'dayLimit' }) }),
        );
        const household = householdOf(world);
        await settle();

        const byId = new Map(household.state.computers.map((computer) => [computer.id, computer.sharing]));
        expect(byId.get(WORKER)).toEqual({ state: 'sending', computers: 2, sentBytes: 300, totalBytes: 1000 });
        expect(byId.get('w-1111111111111111')).toMatchObject({ state: 'dayLimit' });
        household.stop();
    });

    it('badPath_aFinishedStaleOrYesterdaysShareIsNotShown @S-A143-BAD-SHARING-STALE', async () => {
        const world = contentWorld();
        const seen = before(world, 30);
        const docs: [string, Record<string, unknown> | undefined, boolean?][] = [
            [WORKER, sharing(world, 20, { state: 'done' })],
            ['w-1111111111111111', sharing(world, 3600)],
            ['w-2222222222222222', sharing(world, 60, { state: 'dayLimit', day: '2020-01-01' })],
            ['w-3333333333333333', sharing(world, 20), true],
            ['w-4444444444444444', undefined],
        ];
        for (const [id, said, revoked] of docs) {
            const more = { ...(said === undefined ? {} : { sharing: said }), ...(revoked === true ? { revokedAt: at(seen) } : {}) };
            world.store.docs.set(FIRESTORE_PATHS.worker(CITY, id), workerDoc(seen, more));
        }
        const household = householdOf(world);
        await settle();

        expect(household.state.computers.map((computer) => computer.sharing)).toEqual([null, null, null, null, null]);
        household.stop();
    });
});

describe('the disk of each computer', () => {
    const GB = 1024 ** 3;
    const disk = { workBytes: 12 * GB, freeBytes: 4 * GB, floorBytes: 10 * GB };

    it('happyPath_theDiskAndWhatFreeSpaceNowFreedAreShown @S-A62-HAPPY-FREE-SPACE', async () => {
        const world = contentWorld();
        const seen = before(world, 30);
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, WORKER),
            workerDoc(seen, {
                disk: { ...disk, at: at(seen) },
                freeSpaceAskedAt: at(before(world, 600)),
                freed: { bytes: 3 * GB, at: at(before(world, 60)) },
            }),
        );
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, 'w-1111111111111111'),
            workerDoc(seen, { disk: { ...disk, at: at(seen) }, freeSpaceAskedAt: at(before(world, 60)) }),
        );
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, 'w-2222222222222222'), workerDoc(before(world, 20)));
        const household = householdOf(world);
        await settle();

        expect(household.state.computers).toMatchObject([
            { id: 'w-2222222222222222', disk: null, freeing: false, freed: null },
            { id: WORKER, disk, freeing: false, freed: { bytes: 3 * GB, at: before(world, 60) } },
            { id: 'w-1111111111111111', disk, freeing: true, freed: null },
        ]);
        household.stop();
    });

    it('badPath_anOlderOutcomeDoesNotAnswerANewerRequest @S-A62-BAD-FREE-SPACE', async () => {
        const world = contentWorld();
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, WORKER),
            workerDoc(before(world, 30), { freeSpaceAskedAt: at(before(world, 60)), freed: { bytes: 1, at: at(before(world, 600)) } }),
        );
        const household = householdOf(world);
        await settle();

        expect(household.state.computers[0]).toMatchObject({ freeing: true, freed: { bytes: 1 } });
        household.stop();
    });

    it('happyPath_freeSpaceNowIsWorkerManage @S-A62-HAPPY-FREE-SPACE', async () => {
        const world = contentWorld();
        world.callables.answer('worker.manage', () => ({ changed: true }));
        const household = householdOf(world);

        await expect(household.intents.freeSpace(WORKER)).resolves.toBe(true);
        expect(world.callables.calls.map((call) => call.request)).toEqual([{ cityId: CITY, workerId: WORKER, action: 'freeSpace' }]);
    });
});

describe('the actions', () => {
    it('happyPath_renamePauseResumeAndRemoveGoThroughWorkerManage @S-A143-HAPPY-MANAGE', async () => {
        const world = contentWorld();
        world.callables.answer('worker.manage', () => ({ changed: true }));
        const household = householdOf(world);

        await expect(household.intents.rename(WORKER, 'Living room')).resolves.toBe(true);
        await household.intents.pause(WORKER);
        await household.intents.resume(WORKER);
        await household.intents.remove(WORKER, { docker: true, keep: false });

        expect(world.callables.calls.map((call) => call.request)).toEqual([
            { cityId: CITY, workerId: WORKER, action: 'rename', name: 'Living room' },
            { cityId: CITY, workerId: WORKER, action: 'pause' },
            { cityId: CITY, workerId: WORKER, action: 'resume' },
            { cityId: CITY, workerId: WORKER, action: 'remove', docker: true, keep: false },
        ]);
    });

    it('badPath_aRefusalIsSaidAndOneActionRunsAtATime @S-A143-BAD-MANAGE-REMOVED', async () => {
        const world = contentWorld();
        world.callables.fail('worker.manage', failure('failed-precondition', 'apiError.worker.revoked'));
        const household = householdOf(world);

        const first = household.intents.pause(WORKER);
        await expect(household.intents.pause(WORKER)).resolves.toBe(false);
        await expect(first).resolves.toBe(false);
        expect(household.state.refusal).not.toBeNull();
        expect(household.state.acting).toBeNull();
    });

    it('happyPath_disconnectNowAnywayIsWorkerRevoke @S-A143-BAD-REMOVE-FORCED', async () => {
        const world = contentWorld();
        world.callables.answer('worker.revoke', () => ({ revoked: true }));
        const household = householdOf(world);

        await expect(household.intents.disconnect(WORKER)).resolves.toBe(true);
        expect(world.callables.calls[0]).toMatchObject({ name: 'worker.revoke', request: { cityId: CITY, workerId: WORKER } });
        expect(household.cleanup('windows')).toContain('os=windows&action=uninstall');
    });

    it('happyPath_addingAComputerWithoutAScreenMintsALongerCodeOnce', async () => {
        const world = contentWorld();
        world.callables.answer('worker.pairCode', () => ({ code: CODE, expiresAt: '2025-10-09T09:00:00.000Z' }));
        const household = householdOf(world);

        household.intents.add('headless');
        await settle();
        household.intents.add('linux');
        household.intents.add('headless');
        await settle();

        expect(world.callables.calls.map((call) => call.request)).toEqual([{ cityId: CITY, household: true }]);
        expect(household.state).toMatchObject({ adding: 'headless', code: CODE, line: headlessLine(BASE, CITY, CODE), codeFailed: false });
    });

    it('badPath_aCodeThatCannotBeMintedIsSaid', async () => {
        const world = contentWorld();
        world.callables.fail('worker.pairCode', failure('permission-denied', 'apiError.notAdmin'));
        const household = householdOf(world);

        await household.intents.mint();

        expect(household.state).toMatchObject({ code: null, line: null, codeFailed: true });
        expect(household.state.refusal).not.toBeNull();
    });

    it('badPath_aListThatStopsOffersTryAgain', async () => {
        const world = contentWorld();
        const household = householdOf(world);
        await settle();
        household.intents.retry();
        household.stop();
        household.stop();

        expect(household.state.status).toBe('ready');
    });
});

describe('the feed hands out the household', () => {
    it('happyPath_theLazyChunkRegistersItsElement', async () => {
        const world = contentWorld();
        const feed = createWorkerFeed(world.services);

        const household = await feed.intents.household('demo-hcm');

        expect(household.state.link).toContain('#/jobs');
        expect(globalThis.customElements.get('hcm-worker-household')).toBeDefined();
    });
});
