import type { Gcp } from '@hcm/shared';

import type { Run } from './imagery-run.js';

/**
 * M16 (`docs/research/M16-recalibrate.md` §3): `georef` of a recalibration as the stand-in plays it. The version's pairs are the current
 * version's; the new fit holds three of them out as checks, and both fits are recorded on those checks: the current one at the script's
 * `beforeM` (default 28.4 m), the new one at its checkpoint figure. `declined` ends the run with nothing better, as the pipeline does.
 */

const CHECKS = 3;

export async function recalibrated(run: Run, rmse: number): Promise<'next' | 'stop'> {
    const before = run.attempt.beforeM ?? 28.4;
    if (run.attempt.outcome === 'declined') {
        await run.decline('georef', 'apiError.imagery.notImproved', { before: before.toFixed(1), after: rmse.toFixed(1) });
        return 'stop';
    }
    const georef = run.version['georef'] as Record<string, unknown> & { gcps: Gcp[] };
    const gcps = georef.gcps.map((gcp, index) => ({ ...gcp, enabled: index >= CHECKS, origin: 'auto' as const }));
    const recalibration = run.version['recalibration'] as Record<string, unknown>;
    await run.writeVersion({
        georef: {
            method: 'auto',
            transform: 'affine',
            gcps,
            fitRmseM: rmse / 2,
            checkpointRmseM: rmse,
            checkpointCount: CHECKS,
            checkpointKind: 'held-out',
        },
        recalibration: {
            ...recalibration,
            before: { rmseM: before, checks: CHECKS },
            after: { rmseM: rmse, checks: CHECKS },
            tiles: { agreed: 412, tried: 500 },
        },
    });
    await run.stepEnded('georef', 'done');
    return 'next';
}
