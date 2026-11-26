/**
 * Pairing (finding 67 of 2026-11-02; `functions/src/worker/{pairing,pair-code,pair,revoke}.ts`, `docs/research/M7-local-worker.md`
 * §2.6, §10): the admin mints a one-time code for the worker's command, the worker exchanges it once (no sign-in) for a
 * custom token of the owner with the `worker`, `city` and `pair` claims, signs in with it, and every worker callable then
 * admits that token for that city while the pairing stands; Disconnect this computer revokes it. The installed pipeline
 * image is compared with the pairing's: an outdated worker takes no job.
 */
import {
    FIRESTORE_PATHS,
    WORKER_PAIR_ATTEMPTS,
    WORKER_PAIR_CODE_PATTERN,
    WORKER_PAIR_SECONDS,
    workerPairingDocSchema,
    type WorkerPairingDoc,
} from '@hcm/shared';
import type { CallableFunction, CallableRequest } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import type { CallerToken } from '../../src/api/access.js';
import { claimFunction } from '../../src/worker/claim.js';
import { endFunction } from '../../src/worker/end.js';
import { helloFunction } from '../../src/worker/hello.js';
import { imageFunction } from '../../src/worker/image.js';
import { pairCodeFunction } from '../../src/worker/pair-code.js';
import { pairFunction } from '../../src/worker/pair.js';
import { newPairCode, pairIdOf } from '../../src/worker/pairing.js';
import { revokeFunction } from '../../src/worker/revoke.js';
import { failureOf } from '../admin/world.js';
import { readJob, seedJob, seedSetup } from '../imagery/world.js';
import {
    CITY,
    JOB,
    NOW,
    OTHER,
    WORKER,
    at,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedWorker,
    workerWorld,
    type WorkerTestDeps,
    type WorkerWorld,
} from './world.js';

const OWNER = 'u-admin';
const IMAGE = `sha256:${'e7'.repeat(32)}`;
const NEWER = `sha256:${'a1'.repeat(32)}`;
const CODE = 'abcdefghijklmnopqrstuvwxyz';
const PAIR = pairIdOf(CODE);

type Factory<T> = (getDeps: () => WorkerTestDeps) => CallableFunction<unknown, Promise<T>>;

/** A call with no sign-in at all (`worker.pair`). */
function anonymous<T>(world: WorkerWorld, factory: Factory<T>, data: Readonly<Record<string, unknown>>): Promise<T> {
    const request = { data: { cityId: CITY, ...data }, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;
    return factory(() => world.deps).run(request);
}

/** A call signed in with a paired worker's custom token (`pair` for `city`), as the worker makes them. */
function asPaired<T>(
    world: WorkerWorld,
    factory: Factory<T>,
    data: Readonly<Record<string, unknown>>,
    claims: Partial<CallerToken> = {},
): Promise<T> {
    const token: CallerToken = { admin: true, worker: true, city: CITY, pair: PAIR, firebase: { sign_in_provider: 'custom' }, ...claims };
    const auth = { uid: OWNER, token, rawToken: 'test-custom-id-token' };
    const request = {
        data: { cityId: CITY, ...data },
        auth,
        rawRequest: {},
        acceptsStreaming: false,
    } as unknown as CallableRequest<unknown>;
    return factory(() => world.deps).run(request);
}

function pairing(overrides: Partial<WorkerPairingDoc> = {}): WorkerPairingDoc {
    return { uid: OWNER, image: IMAGE, expiresAt: minutes(5), updatedBy: OWNER, updatedAt: minutes(-5), ...overrides };
}

async function seedPairing(world: WorkerWorld, overrides: Partial<WorkerPairingDoc> = {}, pairId = PAIR): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.pairing(CITY, pairId), workerPairingDocSchema, pairing(overrides));
}

function readPairing(world: WorkerWorld, pairId = PAIR): Promise<WorkerPairingDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.pairing(CITY, pairId), workerPairingDocSchema);
}

/** The pipeline installed with `image` (`setup/status.install.pipeline.image`). */
async function installed(world: WorkerWorld, image = IMAGE): Promise<void> {
    await seedSetup(world, { install: { pipeline: { state: 'installed', release: '1.0.0', checkedAt: NOW, image } } });
}

function pair(world: WorkerWorld, data: Readonly<Record<string, unknown>> = { code: CODE }) {
    return anonymous(world, pairFunction, data);
}

describe('pairing codes', () => {
    it('happyPath_aCodeIs26Base32CharactersAndItsIdAShaPrefix', () => {
        const code = newPairCode();

        expect(code).toMatch(WORKER_PAIR_CODE_PATTERN);
        expect(newPairCode(() => new Uint8Array(26).fill(31))).toBe('7'.repeat(26));
        expect(pairIdOf(CODE)).toMatch(/^[0-9a-f]{40}$/);
        expect(pairIdOf(CODE)).not.toBe(pairIdOf(code));
    });
});

describe('worker.pairCode', () => {
    it('happyPath_mintsACodeForTheCommandWithTheInstalledImage @S-A62-HAPPY-PAIR', async () => {
        const world = await workerWorld();
        await installed(world);

        const answer = await callAs(world, pairCodeFunction, {});

        expect(answer.code).toMatch(WORKER_PAIR_CODE_PATTERN);
        expect(answer.expiresAt).toBe(new Date(Date.parse(NOW) + WORKER_PAIR_SECONDS * 1000).toISOString());
        await expect(readPairing(world, pairIdOf(answer.code))).resolves.toEqual({
            uid: OWNER,
            image: IMAGE,
            expiresAt: at(answer.expiresAt),
            updatedBy: OWNER,
            updatedAt: at(NOW),
        });
    });

    it('happyPath_theCallersExpiredUnusedCodesAreSweptOthersKept', async () => {
        const world = await workerWorld();
        await seedPairing(world, { expiresAt: minutes(-1) }, 'a'.repeat(40));
        await seedPairing(world, { expiresAt: minutes(-1), pairedAt: minutes(-2) }, 'b'.repeat(40));
        await seedPairing(world, { expiresAt: minutes(-1), uid: OTHER }, 'c'.repeat(40));

        const answer = await callAs(world, pairCodeFunction, {});

        await expect(readPairing(world, 'a'.repeat(40))).resolves.toBeUndefined();
        await expect(readPairing(world, 'b'.repeat(40))).resolves.toBeDefined();
        await expect(readPairing(world, 'c'.repeat(40))).resolves.toBeDefined();
        await expect(readPairing(world, pairIdOf(answer.code))).resolves.not.toHaveProperty('image');
    });
});

describe('worker.pair', () => {
    it('happyPath_aCodeIsExchangedOnceForTheOwnersWorkerToken @S-A62-HAPPY-PAIR', async () => {
        const world = await workerWorld();
        await seedPairing(world);

        const answer = await pair(world);

        expect(answer).toEqual({ token: `custom.${OWNER}.${JSON.stringify({ worker: true, city: CITY, pair: PAIR })}`, pairId: PAIR });
        await expect(readPairing(world)).resolves.toMatchObject({ pairedAt: at(NOW) });
    });

    it.each([
        ['used', { pairedAt: minutes(-1) }],
        ['expired', { expiresAt: minutes(-1) }],
        ['revoked', { revokedAt: minutes(-1) }],
    ])('badPath_a%sCodeIsRefused @S-A62-BAD-PAIR-EXPIRED', async (_name, overrides) => {
        const world = await workerWorld();
        await seedPairing(world, overrides);

        await expect(failureOf(pair(world))).resolves.toMatchObject({ details: { code: 'apiError.worker.pairCode' } });
        expect(world.deps.authAdmin.recorder.calls).toEqual([]);
    });

    it('badPath_aCodeExchangedTwiceIsRefusedTheSecondTime @S-A62-BAD-PAIR-REUSED', async () => {
        const world = await workerWorld();
        await seedPairing(world);
        await pair(world);

        await expect(failureOf(pair(world))).resolves.toMatchObject({ details: { code: 'apiError.worker.pairCode' } });
    });

    it('badPath_anUnknownCodeAndAnOwnerNoLongerInTheCityAreRefused', async () => {
        const world = await workerWorld();
        await seedPairing(world, { uid: 'u-gone' });

        await expect(failureOf(pair(world, { code: 'zzzzzzzzzzzzzzzzzzzzzzzzzz' }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.pairCode' },
        });
        await expect(failureOf(pair(world))).resolves.toMatchObject({ details: { code: 'apiError.worker.pairCode' } });
    });

    it('badPath_attemptsPastTheLimitAreRefusedUntilTheWindowEnds', async () => {
        const world = await workerWorld();
        for (let attempt = 0; attempt < WORKER_PAIR_ATTEMPTS; attempt += 1) {
            await failureOf(pair(world, { code: 'zzzzzzzzzzzzzzzzzzzzzzzzzz' }));
        }
        await seedPairing(world);

        await expect(failureOf(pair(world))).resolves.toMatchObject({ details: { code: 'apiError.rateLimited' } });
        world.deps.clock.set(new Date(Date.parse(NOW) + 11 * 60_000).toISOString());
        await seedPairing(world, { expiresAt: minutes(30) });
        await expect(pair(world)).resolves.toMatchObject({ pairId: PAIR });
    });

    it('happyPath_aNewCommandOnTheSameComputerRevokesThePairingItReplaces', async () => {
        const world = await workerWorld();
        const old = 'd'.repeat(40);
        await seedPairing(world, { pairedAt: minutes(-60) }, old);
        await seedPairing(world, { pairedAt: minutes(-60), uid: OTHER }, 'e'.repeat(40));
        await seedPairing(world);

        await pair(world, { code: CODE, replaces: old });
        await pair(world, { code: newCodeFor(world), replaces: 'e'.repeat(40) });

        await expect(readPairing(world, old)).resolves.toMatchObject({ revokedAt: at(NOW) });
        await expect(readPairing(world, 'e'.repeat(40))).resolves.not.toHaveProperty('revokedAt');
    });
});

/** A second open code for the owner (seeded), returned for a second exchange. */
function newCodeFor(world: WorkerWorld): string {
    const code = 'bcdefghijklmnopqrstuvwxyza';
    world.deps.documents.seed(FIRESTORE_PATHS.pairing(CITY, pairIdOf(code)), pairing());
    return code;
}

describe('a paired worker', () => {
    it('happyPath_itsTokenWorksForItsCityAndItsDocumentNamesThePairing @S-A62-HAPPY-PAIR', async () => {
        const world = await workerWorld();
        await installed(world);
        await seedPairing(world, { pairedAt: minutes(-1) });

        await expect(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0' })).resolves.toMatchObject({
            image: IMAGE,
            outdated: false,
        });
        await expect(readWorker(world)).resolves.toMatchObject({ uid: OWNER, pair: PAIR, image: IMAGE, outdated: false });
        await seedJob(world, JOB, localJob());
        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('happyPath_aWorkerTheImageCheckLetsThroughIsNoLongerSaidOutdated @S-A62-HAPPY-OUTDATED-CLEARED', async () => {
        // Lesson 708: a hello against a minute-old installed image left `outdated: true` on a worker that runs the installed one.
        const world = await workerWorld();
        await installed(world);
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedWorker(world, WORKER, { pair: PAIR, image: IMAGE, outdated: true });
        await seedJob(world, JOB, localJob());

        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: { jobId: JOB } });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'busy', jobId: JOB, outdated: false });
    });

    it('badPath_aWorkerOnAnotherImageStaysOutdatedAndTakesNothing @S-A62-BAD-OUTDATED-KEPT', async () => {
        const world = await workerWorld();
        await installed(world, NEWER);
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedWorker(world, WORKER, { pair: PAIR, image: IMAGE, outdated: false });
        await seedJob(world, JOB, localJob());

        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: null, outdated: true });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'idle', outdated: true });
        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued' });
    });

    it('badPath_anOutdatedWorkerTakesNoJobUntilItRunsTheNewCommand', async () => {
        const world = await workerWorld();
        await installed(world, NEWER);
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedWorker(world);
        await seedJob(world, JOB, localJob());

        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: null, outdated: true });
        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued' });
        await expect(readWorker(world)).resolves.toMatchObject({ outdated: true });
    });

    it.each([
        ['for another city', { city: 'bacau' }, 'apiError.city.notMember'],
        ['without the worker claim', { worker: undefined }, 'apiError.accountNotAllowed'],
        ['with a malformed pairing', { pair: 'not-a-pair' }, 'apiError.accountNotAllowed'],
    ])('badPath_aToken%sIsRefused', async (_name, claims, code) => {
        const world = await workerWorld();
        await seedPairing(world, { pairedAt: minutes(-1) });

        await expect(failureOf(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0' }, claims))).resolves.toMatchObject({
            details: { code },
        });
    });

    it('badPath_aPairedTokenCannotCallTheAdminsCallables', async () => {
        const world = await workerWorld();
        await seedPairing(world, { pairedAt: minutes(-1) });

        await expect(failureOf(asPaired(world, pairCodeFunction, {}))).resolves.toMatchObject({
            details: { code: 'apiError.accountNotAllowed' },
        });
    });

    it.each([
        ['revoked', { pairedAt: minutes(-1), revokedAt: minutes(-1) }],
        ['never exchanged', {}],
        ['of another owner', { pairedAt: minutes(-1), uid: OTHER }],
    ])('badPath_aPairing%sRefusesEveryCall @S-A62-HAPPY-DISCONNECT', async (_name, overrides) => {
        const world = await workerWorld();
        await seedPairing(world, overrides);
        await seedWorker(world);

        await expect(failureOf(asPaired(world, claimFunction, { workerId: WORKER }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
        await expect(failureOf(asPaired(world, endFunction, { workerId: WORKER, jobId: JOB, outcome: 'done' }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
    });
});

describe('worker.revoke', () => {
    it('happyPath_disconnectRevokesTheWorkerAndItsPairing @S-A62-HAPPY-DISCONNECT', async () => {
        const world = await workerWorld();
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedWorker(world, WORKER, { pair: PAIR });

        await expect(callAs(world, revokeFunction, { workerId: WORKER })).resolves.toEqual({ revoked: true });

        await expect(readWorker(world)).resolves.toMatchObject({ revokedAt: at(NOW) });
        await expect(readPairing(world)).resolves.toMatchObject({ revokedAt: at(NOW) });
        await expect(
            failureOf(asPaired(world, helloFunction, { workerId: 'w-1111111111111111', version: '1.0.0' })),
        ).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
    });

    it('happyPath_aWorkerSignedInWithGoogleIsRefusedOnceDisconnected', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        await callAs(world, revokeFunction, { workerId: WORKER });
        await callAs(world, revokeFunction, { workerId: WORKER });

        await expect(readWorker(world)).resolves.toMatchObject({ revokedAt: at(NOW) });
        await expect(failureOf(callAs(world, claimFunction, { workerId: WORKER }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.revoked' },
        });
    });

    it('badPath_anUnknownWorkerIsNotRevoked', async () => {
        const world = await workerWorld();

        await expect(callAs(world, revokeFunction, { workerId: WORKER })).resolves.toEqual({ revoked: false });
    });
});

describe('the starter file (finding 72)', () => {
    it('happyPath_theSupervisorAsksForTheInstalledImageWithoutASignIn @S-A62-HAPPY-STARTER-IMAGE', async () => {
        const world = await workerWorld();
        await installed(world, NEWER);

        const request = { data: {}, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;
        await expect(imageFunction(() => world.deps).run(request)).resolves.toEqual({
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            digest: NEWER,
            release: '1.0.0',
        });
    });

    it('badPath_withoutAnInstalledImageTheSupervisorIsToldNotFound @S-A62-BAD-STARTER-NO-IMAGE', async () => {
        const world = await workerWorld();
        const request = { data: {}, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;

        await expect(failureOf(imageFunction(() => world.deps).run(request))).resolves.toMatchObject({
            details: { code: 'apiError.notFound' },
        });
        // A pipeline recorded before its image was (an install from before M7): the same answer.
        await seedSetup(world, { install: { pipeline: { state: 'installed', release: '1.0.0', checkedAt: NOW } } });
        await expect(failureOf(imageFunction(() => world.deps).run(request))).resolves.toMatchObject({
            details: { code: 'apiError.notFound' },
        });
    });

    it('happyPath_anImageRecordedWithoutItsReleaseIsAnsweredWithoutOne', async () => {
        const world = await workerWorld();
        await seedSetup(world, { install: { pipeline: { state: 'installed', checkedAt: NOW, image: NEWER } } });
        const request = { data: {}, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;

        await expect(imageFunction(() => world.deps).run(request)).resolves.toEqual({
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            digest: NEWER,
        });
    });

    it('happyPath_theImageTheSupervisorRunsIsTheOneCompared @S-A62-HAPPY-STARTER-UPDATE', async () => {
        // The kept pairing was made under the older image; the supervisor pulled the installed one and says so.
        const world = await workerWorld();
        await installed(world, NEWER);
        await seedPairing(world, { pairedAt: minutes(-1) });

        await expect(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0', image: NEWER })).resolves.toMatchObject({
            image: NEWER,
            outdated: false,
        });
        await expect(readWorker(world)).resolves.toMatchObject({ image: NEWER, outdated: false });
        await seedJob(world, JOB, localJob());
        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('happyPath_afterAnUpdateTheSupervisorIsGivenTheImageTheJobRuns @S-A62-HAPPY-STARTER-IMAGE-UPDATE', async () => {
        // Finding 74: Update the map rebuilt the image and the jobs run it; the record still names the release before's digest.
        const world = await workerWorld();
        await seedSetup(world, { install: { pipeline: { state: 'installed', release: '1.0.0+bf74d17', checkedAt: NOW, image: IMAGE } } });
        world.jobs.descriptions.set('raster-pipeline', {
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            labels: { 'hcm-release': '1-0-0-bf74d17' },
        });
        const request = { data: {}, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;

        await expect(imageFunction(() => world.deps).run(request)).resolves.toEqual({
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            digest: NEWER,
            release: '1.0.0+bf74d17',
        });
        // The worker the supervisor then starts on that image is not outdated, and takes the local job.
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedJob(world, JOB, localJob());
        await expect(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0', image: NEWER })).resolves.toMatchObject({
            image: NEWER,
            outdated: false,
        });
        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('badPath_aStaleRecordNeverPairsTheNewReleaseWithTheOldDigest @S-A62-BAD-STARTER-IMAGE-STALE', async () => {
        // The job names no release: the record's release belongs to another digest, so none is answered.
        const world = await workerWorld();
        await seedSetup(world, { install: { pipeline: { state: 'installed', release: '1.0.0+bf74d17', checkedAt: NOW, image: IMAGE } } });
        world.jobs.descriptions.set('raster-pipeline', {
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            labels: {},
        });
        const request = { data: {}, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;

        await expect(imageFunction(() => world.deps).run(request)).resolves.toEqual({
            image: `us-central1-docker.pkg.dev/${world.deps.config.projectId}/hcm/pipeline@${NEWER}`,
            digest: NEWER,
        });
        // A worker still on the record's (older) image is outdated against the job's.
        await seedPairing(world, { pairedAt: minutes(-1) });
        await expect(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0', image: IMAGE })).resolves.toMatchObject({
            image: NEWER,
            outdated: true,
        });
    });

    it('badPath_aSupervisorStillOnTheOlderImageIsToldItIsOutdated @S-A62-BAD-STARTER-OUTDATED', async () => {
        const world = await workerWorld();
        await installed(world, NEWER);
        await seedPairing(world, { pairedAt: minutes(-1) });
        await seedJob(world, JOB, localJob());

        await expect(asPaired(world, helloFunction, { workerId: WORKER, version: '1.0.0', image: IMAGE })).resolves.toMatchObject({
            outdated: true,
        });
        await expect(asPaired(world, claimFunction, { workerId: WORKER })).resolves.toEqual({ job: null, outdated: true });
    });
});
