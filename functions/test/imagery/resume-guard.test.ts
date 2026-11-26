/**
 * `imagery.resumeGuard` (`functions/src/imagery/resume-guard.ts`, CR-M3-47): the admin's way out of a budget pause turns
 * `ops/guard` green, records who did it and the budget period whose spend they accepted, and keeps the tick's record.
 */
import { FIRESTORE_PATHS, opsGuardDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { resumeGuardFunction } from '../../src/imagery/resume-guard.js';
import { adminCall } from '../publish/fakes.js';
import { NOW, at, imageryWorld, type ImageryWorld } from './world.js';

function resume(world: ImageryWorld) {
    return resumeGuardFunction(() => world.deps).run(adminCall({}));
}

function guard(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
}

describe('imagery.resumeGuard', () => {
    it('happyPath_theAdminTurnsTheGuardGreenAcceptingThePeriodsSpend @S-A43-HAPPY-RESUME', async () => {
        const world = imageryWorld();
        await world.deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'red',
            reason: 'budget',
            since: at('2026-10-20T10:00:00.000Z'),
            spend: { costAmount: 5.37, budgetAmount: 5, currency: 'USD', interval: '2026-10-01T07:00:00Z' },
            lastTick: { ranAt: at('2026-10-23T07:45:00.000Z'), steps: [] },
            updatedBy: 'system:ops',
            updatedAt: at('2026-10-20T10:00:00.000Z'),
        });

        await expect(resume(world)).resolves.toEqual({ state: 'green' });

        expect(await guard(world)).toEqual({
            state: 'green',
            resumedBy: 'u-admin',
            resumedAt: at(NOW),
            resumedFor: '2026-10-01T07:00:00Z',
            lastTick: { ranAt: at('2026-10-23T07:45:00.000Z'), steps: [] },
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
    });

    it('badPath_aGuardThatIsGreenOrMissingIsLeftAsItIs @S-A43-BAD-NOT-PAUSED', async () => {
        const world = imageryWorld();

        await expect(resume(world)).resolves.toEqual({ state: 'green' });
        expect(await guard(world)).toBeUndefined();

        await world.deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'green',
            updatedBy: 'system:ops',
            updatedAt: at('2026-10-01T00:00:00.000Z'),
        });
        await resume(world);
        expect((await guard(world))?.updatedBy).toBe('system:ops');
    });

    it('happyPath_aManualPauseWithoutSpendIsResumedForNoPeriod', async () => {
        const world = imageryWorld();
        await world.deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'red',
            reason: 'manual',
            resumedFor: '2026-09-01T07:00:00Z',
            updatedBy: 'u-owner',
            updatedAt: at('2026-10-01T00:00:00.000Z'),
        });

        await resume(world);

        const resumed = await guard(world);
        expect(resumed).toMatchObject({ state: 'green', resumedBy: 'u-admin' });
        expect(resumed?.resumedFor).toBeUndefined();
    });

    it('happyPath_consumesAppCheck', () => {
        expect(resumeGuardFunction(() => imageryWorld().deps).__endpoint).toMatchObject({
            serviceAccountEmail: 'fn-admin@demo-hcm.iam.gserviceaccount.com',
        });
    });
});
