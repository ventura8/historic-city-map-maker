/**
 * The budget guard as the Imagery and Jobs areas show it (CR-M3-47; `docs/research/M3-interfaces.md` §10.2): `ops/guard`,
 * live. While it is red the areas say that processing is paused, with the spend the budget alert reported, and offer
 * **Resume processing** (`imagery.resumeGuard`, asked first), which turns it green for the rest of that budget period.
 */
import { FIRESTORE_PATHS, opsGuardDocSchema, type OpsGuardDoc } from '@hcm/shared';

import { LiveDoc, type DocState } from '../content/doc.js';
import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from './api.js';

export interface GuardView {
    /** Red: imports, retries, saves, crops and publishes are paused. */
    readonly paused: boolean;
    /** The month's cost the budget alert reported, and the budget, in `currency`; null when the guard did not record them. */
    readonly costAmount: number | null;
    readonly budgetAmount: number | null;
    readonly currency: string | null;
}

const GREEN: GuardView = { paused: false, costAmount: null, budgetAmount: null, currency: null };

function viewOf(guard: OpsGuardDoc): GuardView {
    const { spend } = guard;
    const paused = guard.state === 'red';
    if (spend === undefined) {
        return { ...GREEN, paused };
    }
    return { paused, costAmount: spend.costAmount, budgetAmount: spend.budgetAmount, currency: spend.currency ?? null };
}

/** The guard as read (null while reading); a missing guard is green. */
export function guardViewOf(state: DocState<OpsGuardDoc>): GuardView | null {
    if (state.status === 'loading') {
        return null;
    }
    const guard = state.doc?.data;
    return guard === undefined ? GREEN : viewOf(guard);
}

/** `ops/guard`, live, for one area. */
export class GuardFeed {
    readonly #doc: LiveDoc<OpsGuardDoc>;

    constructor(services: ContentServices, changed: (guard: GuardView | null) => void) {
        const { store, clock } = services;
        this.#doc = new LiveDoc({
            ...{ store, clock, schema: opsGuardDocSchema },
            denied: () => {
                services.denied();
            },
            changed: (state) => {
                changed(guardViewOf(state));
            },
        });
    }

    start(): void {
        this.#doc.show(FIRESTORE_PATHS.opsGuard);
    }

    retry(): void {
        this.#doc.retry();
    }

    stop(): void {
        this.#doc.stop();
    }
}

/** `imagery.resumeGuard`: says that processing starts again, or why not. True once the guard is green. */
export async function resumeGuard(services: ContentServices): Promise<boolean> {
    try {
        await callImagery(services.callables, 'imagery.resumeGuard', {});
    } catch (error) {
        services.notify(refusalOf(error));
        return false;
    }
    services.notify({ key: 'adminContent.imagery.notice.resumed' });
    return true;
}
