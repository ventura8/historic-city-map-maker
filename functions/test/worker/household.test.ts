/**
 * W5, household computers (`functions/src/worker/{household,manage,claim,hello,pair-code}.ts`, `docs/research/M7-local-worker.md`
 * *Household computers*): "Add another computer" mints a longer one-time code for its one-line command (still one use, still
 * bound to its city); each computer says its name, its starter and its governor's share; the list renames, pauses and
 * resumes one; and a computer whose person is busy leaves the next job to a calm computer of the city.
 */
import { FIRESTORE_PATHS, WORKER_HOUSEHOLD_PAIR_SECONDS, workerPairingDocSchema, type WorkerShare } from '@hcm/shared';
import type { CallableFunction, CallableRequest } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { claimFunction } from '../../src/worker/claim.js';
import { helloFunction } from '../../src/worker/hello.js';
import { manageFunction } from '../../src/worker/manage.js';
import { pairCodeFunction } from '../../src/worker/pair-code.js';
import { pairFunction } from '../../src/worker/pair.js';
import { pairIdOf } from '../../src/worker/pairing.js';
import { revokeFunction } from '../../src/worker/revoke.js';
import { failureOf } from '../admin/world.js';
import { seedJob } from '../imagery/world.js';
import {
    CITY,
    NOW,
    OTHER_WORKER,
    WORKER,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedWorker,
    workerWorld,
    type WorkerTestDeps,
    type WorkerWorld,
} from './world.js';

const BUSY: WorkerShare = { profile: 'quiet', why: 'user-active', cores: 8, threads: 2, memoryMb: 4096 };
const CALM: WorkerShare = { profile: 'full', why: 'idle', cores: 4, threads: 3, memoryMb: 8192 };

type Factory<T> = (getDeps: () => WorkerTestDeps) => CallableFunction<unknown, Promise<T>>;

function anonymous<T>(world: WorkerWorld, factory: Factory<T>, data: Readonly<Record<string, unknown>>): Promise<T> {
    const request = { data, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;
    return factory(() => world.deps).run(request);
}

function later(seconds: number): string {
    return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

describe('"Add another computer": the household code', () => {
    it('happyPath_aHouseholdCodeLastsLongerAndIsSpentOnce @S-A143-HAPPY-HEADLESS-PAIR', async () => {
        const world = await workerWorld();
        const answer = await callAs(world, pairCodeFunction, { household: true });

        expect(answer.expiresAt).toBe(later(WORKER_HOUSEHOLD_PAIR_SECONDS));
        world.deps.clock.set(later(WORKER_HOUSEHOLD_PAIR_SECONDS - 60));
        await expect(anonymous(world, pairFunction, { cityId: CITY, code: answer.code })).resolves.toMatchObject({
            pairId: pairIdOf(answer.code),
        });
        await expect(failureOf(anonymous(world, pairFunction, { cityId: CITY, code: answer.code }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.pairCode' },
        });
    });

    it('badPath_anExpiredHouseholdCodeIsRefused @S-A143-BAD-HEADLESS-EXPIRED', async () => {
        const world = await workerWorld();
        const answer = await callAs(world, pairCodeFunction, { household: true });
        world.deps.clock.set(later(WORKER_HOUSEHOLD_PAIR_SECONDS + 1));

        await expect(failureOf(anonymous(world, pairFunction, { cityId: CITY, code: answer.code }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.pairCode' },
        });
    });

    it('badPath_aCodeOfOneCityIsRefusedInAnother @S-A143-BAD-HEADLESS-WRONG-CITY', async () => {
        const world = await workerWorld();
        const answer = await callAs(world, pairCodeFunction, { household: true });

        await expect(failureOf(anonymous(world, pairFunction, { cityId: 'bacau', code: answer.code }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.pairCode' },
        });
        await expect(
            world.deps.documents.get(FIRESTORE_PATHS.pairing(CITY, pairIdOf(answer.code)), workerPairingDocSchema),
        ).resolves.not.toHaveProperty('pairedAt');
    });

    it('happyPath_anOrdinaryCodeStillLastsTenMinutes', async () => {
        const world = await workerWorld();

        await expect(callAs(world, pairCodeFunction, { household: false })).resolves.toMatchObject({ expiresAt: later(600) });
    });
});

describe('each computer says who it is', () => {
    it('happyPath_helloRecordsTheComputersNameAndStarter @S-A143-HAPPY-LIST', async () => {
        const world = await workerWorld();
        await callAs(world, helloFunction, {
            workerId: WORKER,
            version: '1.0.0',
            host: { name: 'nuc', os: 'linux', starter: '0123456789ab' },
        });

        await expect(readWorker(world)).resolves.toMatchObject({ host: 'nuc', os: 'linux', starter: '0123456789ab' });
    });

    it('badPath_aStarterThatSaysNothingLeavesNoName', async () => {
        const world = await workerWorld();
        await callAs(world, helloFunction, { workerId: WORKER, version: '1.0.0', host: {} });

        const worker = await readWorker(world);
        expect(worker).not.toHaveProperty('host');
        expect(worker).not.toHaveProperty('starter');
    });
});

describe('worker.manage', () => {
    it('happyPath_renamesPausesAndResumesAComputer @S-A143-HAPPY-MANAGE', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        await expect(callAs(world, manageFunction, { workerId: WORKER, action: 'rename', name: '  Living room PC ' })).resolves.toEqual({
            changed: true,
        });
        await expect(readWorker(world)).resolves.toMatchObject({ name: 'Living room PC' });
        await callAs(world, manageFunction, { workerId: WORKER, action: 'pause' });
        await expect(readWorker(world)).resolves.toHaveProperty('pausedAt');
        await callAs(world, manageFunction, { workerId: WORKER, action: 'pause' });
        await callAs(world, manageFunction, { workerId: WORKER, action: 'resume' });
        await expect(readWorker(world)).resolves.not.toHaveProperty('pausedAt');
    });

    it('badPath_aRemovedOrUnknownComputerIsLeftAlone @S-A143-BAD-MANAGE-REMOVED', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { revokedAt: minutes(-1) });

        await expect(callAs(world, manageFunction, { workerId: WORKER, action: 'pause' })).resolves.toEqual({ changed: false });
        await expect(callAs(world, manageFunction, { workerId: OTHER_WORKER, action: 'resume' })).resolves.toEqual({ changed: false });
        await expect(readWorker(world)).resolves.not.toHaveProperty('pausedAt');
    });

    it('badPath_anEmptyOrMarkupNameIsRefused', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        for (const name of ['   ', '<b>pc</b>']) {
            await expect(failureOf(callAs(world, manageFunction, { workerId: WORKER, action: 'rename', name }))).resolves.toMatchObject({
                code: 'invalid-argument',
            });
        }
    });
});

describe('the governor across computers', () => {
    async function twoComputers(peer: Parameters<typeof seedWorker>[2]): Promise<WorkerWorld> {
        const world = await workerWorld();
        await seedWorker(world);
        await seedWorker(world, OTHER_WORKER, { share: CALM, ...peer });
        await seedJob(world, 'j-next', localJob({ createdAt: minutes(-10) }));
        return world;
    }

    it('happyPath_aBusyComputerLeavesTheJobToACalmOne @S-A143-HAPPY-GOVERNOR', async () => {
        const world = await twoComputers({});

        await expect(callAs(world, claimFunction, { workerId: WORKER, share: BUSY })).resolves.toEqual({ job: null, yielded: true });
        await expect(readWorker(world)).resolves.toMatchObject({ share: BUSY, state: 'idle' });
        await expect(callAs(world, claimFunction, { workerId: OTHER_WORKER, share: CALM })).resolves.toEqual({ job: { jobId: 'j-next' } });
        await expect(readWorker(world, OTHER_WORKER)).resolves.toMatchObject({ share: CALM, state: 'busy' });
    });

    it.each([
        ['silent', { lastSeenAt: minutes(-10) }],
        ['paused', { pausedAt: minutes(-1) }],
        ['busy', { state: 'busy' as const, jobId: 'j-other' }],
        ['quiet', { share: { ...CALM, profile: 'quiet' as const } }],
        ['removed', { revokedAt: minutes(-1) }],
    ])('badPath_withNoCalmComputer(%s)TheBusyOneStillTakesTheJob @S-A143-BAD-GOVERNOR-ALONE', async (_name, peer) => {
        const world = await twoComputers(peer);

        await expect(callAs(world, claimFunction, { workerId: WORKER, share: BUSY })).resolves.toEqual({ job: { jobId: 'j-next' } });
    });

    it('badPath_aPausedComputerTakesNoJob @S-A143-BAD-PAUSED', async () => {
        const world = await twoComputers({});
        await seedWorker(world, WORKER, { pausedAt: minutes(-1) });

        await expect(callAs(world, claimFunction, { workerId: WORKER, share: CALM })).resolves.toMatchObject({ job: null, paused: true });
    });

    it('happyPath_theOwnersQuietChoiceIsNotPressure', async () => {
        const world = await twoComputers({});

        await expect(callAs(world, claimFunction, { workerId: WORKER, share: { ...BUSY, why: 'owner' } })).resolves.toEqual({
            job: { jobId: 'j-next' },
        });
    });
});

describe('Remove this computer: clean up first, disconnect second', () => {
    const PAIR = 'e'.repeat(40);

    async function removable(): Promise<WorkerWorld> {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { pair: PAIR });
        await world.deps.documents.set(FIRESTORE_PATHS.pairing(CITY, PAIR), workerPairingDocSchema, {
            uid: 'u-admin',
            expiresAt: minutes(-30),
            pairedAt: minutes(-40),
            updatedBy: 'u-admin',
            updatedAt: minutes(-40),
        });
        await seedJob(world, 'j-next', localJob({ createdAt: minutes(-10) }));
        return world;
    }

    it('happyPath_anOnlineComputerCleansUpThenIsDisconnected @S-A143-HAPPY-REMOVE', async () => {
        const world = await removable();
        await callAs(world, manageFunction, { workerId: WORKER, action: 'remove', docker: true, keep: false });

        await expect(callAs(world, claimFunction, { workerId: WORKER })).resolves.toEqual({
            job: null,
            remove: { docker: true, keep: false },
        });
        await expect(callAs(world, claimFunction, { workerId: WORKER, removal: { step: 'accepted' } })).resolves.toEqual({ job: null });
        await expect(readWorker(world)).resolves.toMatchObject({ removal: { step: 'accepted' } });
        await expect(readWorker(world)).resolves.not.toHaveProperty('revokedAt');

        await callAs(world, claimFunction, { workerId: WORKER, removal: { step: 'done', dockerLeft: true } });
        await expect(readWorker(world)).resolves.toMatchObject({ removal: { step: 'done', dockerLeft: true } });
        await expect(readWorker(world)).resolves.toHaveProperty('revokedAt');
        await expect(world.deps.documents.get(FIRESTORE_PATHS.pairing(CITY, PAIR), workerPairingDocSchema)).resolves.toHaveProperty(
            'revokedAt',
        );
        await expect(failureOf(callAs(world, claimFunction, { workerId: WORKER }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
    });

    it('happyPath_anOfflineComputerGetsTheOrderWhenItComesBack @S-A143-HAPPY-REMOVE-OFFLINE', async () => {
        const world = await removable();
        await seedWorker(world, WORKER, { pair: PAIR, lastSeenAt: minutes(-600) });
        await callAs(world, manageFunction, { workerId: WORKER, action: 'remove', docker: false, keep: true });
        await expect(readWorker(world)).resolves.toMatchObject({ removal: { step: 'asked', keep: true } });

        world.deps.clock.set(later(3600));
        await expect(callAs(world, claimFunction, { workerId: WORKER })).resolves.toEqual({
            job: null,
            remove: { docker: false, keep: true },
        });
    });

    it('badPath_aComputerWithoutAHelperSaysItCannotCleanUp @S-A143-BAD-REMOVE-NO-STARTER', async () => {
        const world = await removable();
        await callAs(world, manageFunction, { workerId: WORKER, action: 'remove', docker: false, keep: false });
        await callAs(world, claimFunction, { workerId: WORKER, removal: { step: 'failed', why: 'no-starter' } });

        await expect(readWorker(world)).resolves.toMatchObject({ removal: { step: 'failed', why: 'no-starter' } });
        await expect(readWorker(world)).resolves.not.toHaveProperty('revokedAt');
    });

    it('badPath_disconnectNowAnywayStopsTheOrder @S-A143-BAD-REMOVE-FORCED', async () => {
        const world = await removable();
        await callAs(world, manageFunction, { workerId: WORKER, action: 'remove', docker: false, keep: false });
        await callAs(world, revokeFunction, { workerId: WORKER });

        await expect(failureOf(callAs(world, claimFunction, { workerId: WORKER }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
        await expect(callAs(world, manageFunction, { workerId: WORKER, action: 'resume' })).resolves.toEqual({ changed: false });
    });

    it('happyPath_theComputersOwnStopIsDoneWithoutAnOrder', async () => {
        const world = await removable();
        await callAs(world, claimFunction, { workerId: WORKER, removal: { step: 'done' } });

        await expect(readWorker(world)).resolves.toMatchObject({ removal: { step: 'done', docker: false, keep: false } });
    });
});
