/**
 * The approval policy's two M9 rules (`functions/src/imagery/approval.ts`, `docs/research/M9-calibration.md` §11): a figure counts
 * only from checks held out of the fit, and a USGS frame must cover the city (an upload need not); a missing figure never approves.
 */
import { type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    goldenOutput,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedJob,
    seedVersion,
} from './world.js';

const JOB = 'job-1966-0712';

function awaitingJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        waitReason: 'approval',
        machine: 'std',
        attempt: 1,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** The golden georeference, measured on three checks held out of the fit. */
function checked(): NonNullable<LayerVersionDoc['georef']> {
    return { ...goldenGeoref(), checkpointCount: 3 };
}

/** What the proof left on a frame whose tiles span most of it. */
const PROVED = { how: 'votes', tiles: { agreed: 412, tried: 500 }, crossValidatedM: 11.5, measuredPct: 85 } as const;

function rendered(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({ output: { ...goldenOutput(), areaKm2: 100 }, georef: checked(), calibration: PROVED, ...overrides });
}

describe('the approval policy: M9', () => {
    it('happyPath_aFrameCoveringTheCityOnChecksHeldOutPublishesItself @S-A17-HAPPY-WHOLE-CITY', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered({ output: { ...goldenOutput(), areaKm2: 100, coveragePct: 90 } }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(true);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved', approval: { auto: true, by: 'system:imagery' } });
    });

    it.each([
        ['it holds under the bar', 89.9],
        ['the figure is missing', undefined],
    ])('badPath_aFrameWaitsForApproveWhen_%s @S-A17-BAD-PART-OF-CITY', async (_case, coveragePct) => {
        const world = await readyWorld();
        const output = { ...omit(goldenOutput(), ['coveragePct']), areaKm2: 100, ...(coveragePct === undefined ? {} : { coveragePct }) };
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered({ output }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'awaiting_approval', estimate: { computeUnits: 4 } });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('badPath_pairsCheckedOnlyAgainstEachOtherWait @S-A17-BAD-LEAVE-ONE-OUT', async () => {
        const world = await readyWorld();
        await seedCity(world, { imagery: { autoPublish: true, rmseThresholdM: 200 } });
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(
            world,
            JOB,
            rendered({ georef: { ...checked(), checkpointKind: 'leave-one-out', checkpointRmseM: 12, checkpointCount: 124 } }),
        );

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect((await readVersion(world, JOB))?.state).toBe('awaiting_approval');
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('badPath_anUploadsHandPointsWaitHoweverTheyAreChecked @S-A17-BAD-HAND-POINTS', async () => {
        const upload = { kind: 'upload', uploadPath: 'uploads/plan-1911.tif', bytes: 10 } as const;
        const partial = { ...omit(goldenOutput(), ['coveragePct']), areaKm2: 100 };
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob({ type: 'geotiff-import' }));
        await seedVersion(
            world,
            JOB,
            rendered({
                origin: 'upload',
                source: upload,
                output: partial,
                georef: { ...checked(), method: 'gcps' },
                calibration: undefined,
            }),
        );

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });
});

describe('the approval policy: M9, the proof must hold the fit', () => {
    it('badPath_handPointsDisabledAfterReadingTheirResidualsAreNoIndependentCheck @S-A17-BAD-HAND-POINTS', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(
            world,
            JOB,
            rendered({
                georef: { ...checked(), method: 'gcps', checkpointRmseM: 5 },
                output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 },
            }),
        );

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect((await readVersion(world, JOB))?.state).toBe('awaiting_approval');
    });

    it.each([
        ['the proof refused it', { how: 'none', refusal: 'gross' }],
        ['the proof never named it', { how: 'none' }],
        ['the matcher fitted it after the tiles gave no fit', { ...PROVED, how: 'matcher' }],
        ['a refusal stands on its record', { ...PROVED, refusal: 'cross-validation' }],
    ] as const)('badPath_aFrameTheProofDoesNotHoldWaitsHoweverLowItsFigure_%s @S-A17-BAD-NOT-PROVED', async (_case, calibration) => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered({ calibration, output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 } }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('badPath_aVersionWithNoRecordOfTheProofWaits @S-A17-BAD-NOT-PROVED', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, omit(rendered({ output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 } }), ['calibration']));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });

    it('badPath_aCheckDroppedAsGrossKeepsTheFrameFromPublishingItself @S-A17-BAD-CHECKS-DROPPED', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(
            world,
            JOB,
            rendered({ calibration: { ...PROVED, checksDropped: 1 }, output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 } }),
        );

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });

    it.each([
        ['spans too little of the frame', { ...PROVED, measuredPct: 69.9 }],
        ['does not say', omit(PROVED, ['measuredPct'])],
    ])('badPath_aFrameWhoseTiles_%s_waits @S-A17-BAD-UNMEASURED-AREA', async (_case, calibration) => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered({ calibration, output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 } }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });

    it('happyPath_aFrameRefinedFromAnAdminsPointsIsTheProofsOwnFit @S-A17-HAPPY-WHOLE-CITY', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(
            world,
            JOB,
            rendered({
                calibration: { ...PROVED, how: 'points', seedPoints: 6 },
                output: { ...goldenOutput(), areaKm2: 100, coveragePct: 95 },
            }),
        );

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(true);
    });

    it('badPath_aReGeoreferencedFrameKeepsItsSceneSoTheCoverageRuleStillHolds', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob({ type: 'regeoref' }));
        await seedVersion(world, JOB, rendered({ origin: 'regeoref', output: { ...goldenOutput(), areaKm2: 100, coveragePct: 40 } }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });

    it('badPath_aFigureThatDoesNotSayWhatItsChecksAreWaits', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered({ georef: omit(checked(), ['checkpointKind']) }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
    });
});
