import type { JoinReport, JoinSeam } from '@hcm/shared';

import type { Run } from './imagery-run.js';

/**
 * What the stand-in's `merge` reports of a join (`docs/research/M8-join-interfaces.md` §2, §3; the golden shape of
 * `pipeline/tests/contracts/version.join.json`): a measured seam between each two neighbouring frames, closed by the
 * correction, the worst frame's own error, the coverage. The attempt's `join` and `seamsUnmeasured` say what differs.
 */

/** A seam the correction closed, and how far it moved anything. */
const CLOSED_SEAM = { measured: true, applied: true, samples: 24, heldOut: 4, beforeRmseM: 42.6, afterRmseM: 3.1, maxShiftM: 9.4 } as const;

/** A seam with too few samples: nothing moved, and no figure. */
const UNMEASURED_SEAM = { measured: false, applied: false, samples: 2, heldOut: 0, maxShiftM: 0 } as const;

/** The whole city, at least the auto-publish's 90 %. */
const WHOLE_CITY_PCT = 96.4;

function entityIdsOf(run: Run): readonly string[] {
    const source = run.version['source'] as { parts?: readonly { readonly entityId: string }[] } | undefined;
    return (source?.parts ?? []).map((part) => part.entityId);
}

function seamsOf(run: Run): readonly JoinSeam[] {
    const entities = entityIdsOf(run);
    const seam = run.attempt.seamsUnmeasured === true ? UNMEASURED_SEAM : CLOSED_SEAM;
    return entities.slice(1).map((b, index) => ({ a: entities[index] ?? b, b, ...seam }));
}

/** The report the attempt scripted, with `checkpointRmseM` the attempt's own figure. */
export function joinReportOf(run: Run, checkpointRmseM: number): JoinReport {
    return {
        seams: [...seamsOf(run)],
        omitted: [],
        coveragePct: WHOLE_CITY_PCT,
        checkpointRmseM,
        checkpointCount: 3,
        maxShiftM: CLOSED_SEAM.maxShiftM,
        ...run.attempt.join,
    };
}
