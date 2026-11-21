/**
 * "Run on my computer"'s funnel (`trackFunnel` of `@hcm/shared/funnels`, `docs/ARCHITECTURE.md` → *Wizard funnels*): once the
 * owner chose this computer (or one was ever seen), the worker connecting, then up to date; a refusal of the card and an
 * outdated worker are errors by their codes; a connected, current worker completes it.
 */
import type { FunnelSnapshot } from '@hcm/shared/funnels';

import type { WorkerViewPort } from './worker-port.js';

const ORDER = ['connect', 'update'] as const;

/** The card's refusal, and an outdated worker. */
function errorsOf(view: WorkerViewPort, outdated: boolean): Record<string, string> {
    return {
        ...(view.refusal === null ? {} : { connect: view.refusal.key }),
        ...(outdated ? { update: 'adminWorker.outdated' } : {}),
    };
}

/** The card is read and this computer is in play: chosen, or a worker was seen. */
function followed(view: WorkerViewPort): boolean {
    return view.status === 'ready' && (view.choice === 'local' || view.worker !== null);
}

/** Where the card stands; null while it is read, or while the owner runs everything in the cloud with no worker seen. */
export function workerFunnel(view: WorkerViewPort): FunnelSnapshot | null {
    if (!followed(view)) {
        return null;
    }
    const outdated = view.worker?.outdated === true;
    const done = ORDER.filter((step) => (step === 'connect' ? view.connected : view.connected && !outdated));
    const errors = errorsOf(view, outdated);
    return {
        wizard: 'worker',
        order: ORDER,
        step: done.includes('connect') ? 'update' : 'connect',
        done,
        errors,
        complete: done.length === ORDER.length,
    };
}
