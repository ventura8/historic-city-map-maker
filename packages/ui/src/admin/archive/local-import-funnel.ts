/**
 * A local archive's import funnel (`trackFunnel` of `@hcm/shared/funnels`, `docs/ARCHITECTURE.md` → *Wizard funnels*): once
 * a folder or a zip is chosen, its upload to this computer's worker, then its scan; a failure is an error by its code; a
 * cancel is a step back to the choice; the scan done completes it.
 */
import type { FunnelSnapshot } from '@hcm/shared/funnels';

import type { LocalImportPort } from './archive-port.js';

const ORDER = ['choose', 'upload', 'scan'] as const;

const STEP_OF: Readonly<Record<Exclude<LocalImportPort['phase'], 'idle'>, (typeof ORDER)[number]>> = {
    cancelled: 'choose',
    upload: 'upload',
    failed: 'upload',
    scan: 'scan',
    done: 'scan',
};

/** Where the import stands; null while nothing is chosen (the card's resting state is no wizard yet). */
export function localImportFunnel(local: LocalImportPort): FunnelSnapshot | null {
    if (local.phase === 'idle') {
        return null;
    }
    const step = STEP_OF[local.phase];
    const done = ORDER.slice(0, ORDER.indexOf(step) + (local.phase === 'done' ? 1 : 0));
    return {
        wizard: 'local_import',
        order: ORDER,
        step,
        done,
        errors: local.phase === 'failed' ? { upload: local.error ?? 'failed' } : {},
        complete: local.phase === 'done',
    };
}
