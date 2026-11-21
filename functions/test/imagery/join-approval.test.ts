/**
 * A join's own approval policy (`functions/src/imagery/approval.ts`, `docs/research/M8-join-interfaces.md` §5): it has no
 * georeference, so its report must show every condition, each required on its own; at live F039's 51.6 m it waits for Approve.
 */
import type { JoinReport } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { F039, F040, joinJob, joinVersion } from './join-world.js';
import { CITY, readVersion, readyWorld, seedCity, seedJob, seedVersion } from './world.js';

const JOIN = 'jn-1';

const SEAM = { a: F039, b: F040, measured: true, applied: true, samples: 24, heldOut: 4, beforeRmseM: 61, afterRmseM: 9, maxShiftM: 12 };
const WITHIN: JoinReport = { seams: [SEAM], omitted: [], coveragePct: 96, checkpointRmseM: 12, checkpointCount: 3, maxShiftM: 12 };

async function policyOn(join: JoinReport) {
    const world = await readyWorld();
    await seedCity(world, { imagery: { autoPublish: true, rmseThresholdM: 15 } });
    await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, join }));
    await seedJob(world, JOIN, joinJob(JOIN, [], { params: {}, status: 'awaiting_approval', waitReason: 'approval' }));
    return { world, auto: await applyApprovalPolicy(world.deps, CITY, JOIN) };
}

describe('the approval policy on a join', () => {
    it('happyPath_aJoinWithinEveryConditionPublishesOnItsOwn_recordingTheWorstFrame @S-A65-HAPPY-AUTO', async () => {
        const { world, auto } = await policyOn(WITHIN);

        expect(auto).toBe(true);
        expect(await readVersion(world, JOIN)).toMatchObject({
            state: 'approved',
            approval: { auto: true, checkpointRmseM: 12, thresholdM: 15, by: 'system:imagery' },
        });
        expect(world.deps.tasks.queued).toHaveLength(1);
    });

    it.each<[string, Partial<JoinReport>]>([
        ['the worst frame over the threshold, as live F039 at 51.6 m', { checkpointRmseM: 51.6 }],
        ['no checkpoint figure', { checkpointRmseM: undefined }],
        ['too few checks', { checkpointCount: 2 }],
        ['a frame moved too far', { maxShiftM: 16 }],
        ['no seam', { seams: [] }],
        ['a seam not measured', { seams: [{ ...SEAM, measured: false }] }],
        ['a seam not applied', { seams: [{ ...SEAM, applied: false }] }],
        ['a seam over 15 m', { seams: [{ ...SEAM, afterRmseM: 15.5 }] }],
        [
            'a seam with no figure',
            { seams: [SEAM, { a: F039, b: 'F', measured: true, applied: true, samples: 6, heldOut: 0, maxShiftM: 1 }] },
        ],
        ['too little of the city', { coveragePct: 89.9 }],
    ])('badPath_%s_waitsForApprove @S-A65-BAD-OVER-THRESHOLD', async (_name, change) => {
        const { world, auto } = await policyOn({ ...WITHIN, ...change });

        expect(auto).toBe(false);
        const version = await readVersion(world, JOIN);
        expect(version?.state).toBe('awaiting_approval');
        expect(version?.estimate).toBeDefined();
    });

    it('badPath_aCityThatDoesNotAutoPublishWaitsForApprove', async () => {
        const world = await readyWorld();
        await seedCity(world, { imagery: { autoPublish: false } });
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, join: WITHIN }));
        await seedJob(world, JOIN, joinJob(JOIN, [], { params: {}, status: 'awaiting_approval', waitReason: 'approval' }));

        await expect(applyApprovalPolicy(world.deps, CITY, JOIN)).resolves.toBe(false);
    });

    it('badPath_noReportAtAllWaitsForApprove', async () => {
        const world = await readyWorld();
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, join: undefined }));
        await seedJob(world, JOIN, joinJob(JOIN, [], { params: {}, status: 'awaiting_approval', waitReason: 'approval' }));

        await expect(applyApprovalPolicy(world.deps, CITY, JOIN)).resolves.toBe(false);
    });
});
