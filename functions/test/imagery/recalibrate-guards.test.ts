/**
 * M16's guards (`functions/src/imagery/{recalibrate-replace,approve,regeoref,recalibrate}.ts`, `docs/research/M16-recalibrate.md` §4 to §6;
 * findings of 2026-11-08): a recalibration's figures count only against the layer's published version; a rendered version replaces only its
 * own waiting base on its layer; two starts on one waiting version are refused in the transaction; a join says honestly that it cannot be
 * calibrated again yet.
 */
import { JOBS_PER_DAY, translateApiError, type Recalibration } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { CURRENT, LAYER, WAITING, approve, codeOf, job, recalibrate, rendered, required, world } from './recalibrate-world.js';
import {
    NOW,
    at,
    readJob,
    readLayer,
    readVersion,
    renderedVersion,
    seedGuard,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const SAVED = 'rg-saved-points';
const BETTER: Pick<Recalibration, 'before' | 'after'> = { before: { rmseM: 15, checks: 6 }, after: { rmseM: 12, checks: 6 } };

/** A published layer and, on it, a Save of the georeferencer (`manual`, unmeasured) waiting for approval and holding the layer. */
async function savedOnPublished(): Promise<ImageryWorld> {
    const found = await world();
    await seedVersion(
        found,
        SAVED,
        renderedVersion({
            jobId: SAVED,
            layerId: LAYER,
            state: 'awaiting_approval',
            origin: 'regeoref',
            basedOn: CURRENT,
            recalibration: { route: 'manual' },
        }),
    );
    await seedJob(found, SAVED, job({ type: 'regeoref', params: { basedOn: CURRENT }, versionId: SAVED, ...WAITING }));
    await seedLayer(found, LAYER, { currentVersion: CURRENT, pendingVersion: SAVED });
    return found;
}

describe("a recalibration's figures and the layer's published version", () => {
    it('badPath_aRefineOfAWaitingSaveLaundersNothing @S-A89-BAD-WORSE-NEEDS-CHOICE', async () => {
        const found = await savedOnPublished();
        const { jobId } = await recalibrate(found, { versionId: SAVED });
        await rendered(found, jobId, { route: 'auto', replaces: SAVED, ...BETTER });

        await applyApprovalPolicy(found.deps, 'bucharest', jobId);

        expect((await readVersion(found, SAVED))?.state).toBe('cancelled');
        expect((await readVersion(found, jobId))?.recalibration).toEqual({ route: 'auto', replaces: SAVED });
        expect(await codeOf(approve(found, jobId))).toBe('apiError.imagery.notBetter');
        await expect(approve(found, jobId, true)).resolves.toMatchObject({ state: 'approved' });
    });

    it('badPath_figuresAgainstAnotherVersionThanThePublishedOneAreNoProofAtApprove @S-A89-BAD-WORSE-NEEDS-CHOICE', async () => {
        const found = await world();
        const id = 'rg-elsewhere';
        await seedVersion(
            found,
            id,
            renderedVersion({
                jobId: id,
                layerId: LAYER,
                origin: 'regeoref',
                basedOn: 'rg-gone',
                recalibration: { route: 'auto', ...BETTER },
            }),
        );

        expect(await codeOf(approve(found, id))).toBe('apiError.imagery.notBetter');
    });

    it('happyPath_aRefineOfThePublishedVersionKeepsItsFigures @S-A89-HAPPY-APPROVE-BETTER', async () => {
        const found = await world();
        const { jobId } = await recalibrate(found, {});
        await rendered(found, jobId, { route: 'auto', ...BETTER });

        await applyApprovalPolicy(found.deps, 'bucharest', jobId);

        expect((await readVersion(found, jobId))?.recalibration).toEqual({ route: 'auto', ...BETTER });
        await expect(approve(found, jobId)).resolves.toMatchObject({ state: 'approved' });
    });
});

describe('the version a rendered recalibration replaces', () => {
    it.each([
        ['on another layer', 'other-layer'],
        ['on the same layer, not its base', LAYER],
    ])('badPath_onlyItsOwnBaseIsReplaced_%s @S-A89-BAD-DECLINE-KEEPS-WAITING', async (_case, layerId) => {
        const found = await world();
        const other = 'rg-other';
        const { jobId } = await recalibrate(found, {});
        await seedVersion(found, other, renderedVersion({ jobId: other, layerId, state: 'awaiting_approval' }));
        await seedJob(found, other, job({ layerId, versionId: other, ...WAITING }));
        await rendered(found, jobId, { route: 'manual', replaces: other, ...BETTER });

        await applyApprovalPolicy(found.deps, 'bucharest', jobId);

        expect((await readVersion(found, other))?.state).toBe('awaiting_approval');
        expect((await readJob(found, other))?.status).toBe('awaiting_approval');
    });

    it('badPath_aBaseOnAnotherLayerIsNotReplaced @S-A89-BAD-DECLINE-KEEPS-WAITING', async () => {
        const found = await world('awaiting_approval');
        const { jobId } = await recalibrate(found, {});
        await seedVersion(found, CURRENT, { ...(await required(readVersion(found, CURRENT))), layerId: 'other-layer' });
        await rendered(found, jobId, { route: 'auto', replaces: CURRENT, ...BETTER });

        await applyApprovalPolicy(found.deps, 'bucharest', jobId);

        expect((await readVersion(found, CURRENT))?.state).toBe('awaiting_approval');
    });
});

/** The deps of a second click whose query ran before the first start committed, a second later (its own job id). */
function racing(found: ImageryWorld): ImageryWorld['deps'] {
    const later = new Date(Date.parse(NOW) + 1000);
    return {
        ...found.deps,
        clock: { ...found.deps.clock, now: () => later },
        documents: { ...found.deps.documents, query: () => Promise.resolve({ documents: [], invalid: [] }) },
    };
}

describe('two starts on one version waiting for approval', () => {
    it('badPath_aSecondRefineInARaceIsRefusedInTheTransaction @S-A89-BAD-BUSY', async () => {
        const found = await world('awaiting_approval');
        const { jobId } = await recalibrate(found, {});

        expect(await codeOf(recalibrate(found, {}, racing(found)))).toBe('apiError.layers.busy');
        expect((await readVersion(found, CURRENT))?.refining).toBe(jobId);
        expect((await readLayer(found, LAYER))?.pendingVersion).toBe(CURRENT);
    });

    it('happyPath_aRefineThatEndedHoldsNothing @S-A89-HAPPY-REPLACES-WAITING', async () => {
        const found = await world('awaiting_approval');
        const first = await recalibrate(found, {});
        await seedJob(found, first.jobId, { ...(await required(readJob(found, first.jobId))), status: 'cancelled', finishedAt: at(NOW) });

        const second = await recalibrate(found, {}, racing(found));

        expect((await readVersion(found, CURRENT))?.refining).toBe(second.jobId);
    });
});

describe('another frame of the same date waiting on the layer (admin sweep 2026-11-14, bug 1)', () => {
    it('happyPath_aRefineStartsWhileAnotherFrameWaitsForApproval @S-A89-HAPPY-OTHER-FRAME-WAITING', async () => {
        const found = await world('awaiting_approval');
        await seedJob(found, 'im-other-frame', job({ layerId: LAYER, versionId: 'im-other-frame', ...WAITING }));

        const { jobId } = await recalibrate(found, {});

        expect((await readVersion(found, CURRENT))?.refining).toBe(jobId);
    });

    it('badPath_aFrameStillProcessingOnTheLayerRefusesTheRefine @S-A89-BAD-OTHER-FRAME-PROCESSING', async () => {
        const found = await world('awaiting_approval');
        await seedJob(found, 'im-other-frame', job({ layerId: LAYER, versionId: 'im-other-frame', status: 'running' }));

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.layers.busy');
    });
});

describe('a joined layer', () => {
    it.each(['en', 'ro'] as const)('badPath_itsRefusalPromisesNoRouteThatIsNotBuilt_%s @S-A89-BAD-JOIN', async (locale) => {
        const found = await world('published', { origin: 'join' });

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.imagery.joinRecalibrate');
        expect(translateApiError(locale, 'apiError.imagery.joinRecalibrate')).not.toMatch(/cadru|frame/i);
    });

    it('badPath_aFrameOfAPublishedJoinIsNotCalibratedAgain @S-A89-BAD-JOIN', async () => {
        const found = await world('published', { state: 'joined' });

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.imagery.versionState');
    });
});

// The merge of M16 with M18 item 3: a recalibration renders a scan already here (a `regeoref`), so it is a re-run: never the day's
// import limit, and stopped only while the budget guard is red.
describe("a recalibration and the day's limit", () => {
    it('happyPath_aRefineStartsAfterTheDaysImportsAreUsedUp @S-A89-HAPPY-FREE-OF-DAY-LIMIT', async () => {
        const found = await world();
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            const id = `today-${String(index)}`;
            await seedJob(found, id, job({ layerId: `other-${String(index)}`, versionId: id }));
        }

        const { jobId } = await recalibrate(found, {});

        expect(await readJob(found, jobId)).toMatchObject({ type: 'regeoref', status: 'queued' });
    });

    it('badPath_aRefineWhileTheBudgetGuardIsRedIsRefusedAndNothingIsWritten @S-A89-BAD-GUARD-RED', async () => {
        const found = await world();
        await seedGuard(found, 'red');

        expect(await codeOf(recalibrate(found, {}))).toBe('apiError.guardPaused');
        expect((await readLayer(found, LAYER))?.pendingVersion).toBeUndefined();
    });
});
