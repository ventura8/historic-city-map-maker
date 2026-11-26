/**
 * The tile-import wizard's funnel (`#/help/<version>/tiles`; `trackFunnel` of `@hcm/shared/funnels`, `docs/ARCHITECTURE.md`
 * → *Wizard funnels*): its own steps in order, the steps before the one on screen done, a refusal on the step on screen,
 * the layout handed to the georeferencer complete.
 */
import type { FunnelSnapshot } from '@hcm/shared/funnels';

import { TILE_STEPS, type TilesViewState } from './tiles-port.js';

/** The step's error: the series not read, else the last refusal. */
function codeOf(view: TilesViewState): string | undefined {
    return view.status === 'error' ? 'tiles.notRead' : view.refusal?.key;
}

/** Where the wizard stands; null while the series is read, missing or waits for nothing. */
export function tilesFunnel(view: TilesViewState): FunnelSnapshot | null {
    if (view.status !== 'ready' && view.status !== 'error') {
        return null;
    }
    const code = codeOf(view);
    return {
        wizard: 'tiles',
        order: TILE_STEPS,
        step: view.step,
        done: view.handedOff ? [...TILE_STEPS] : TILE_STEPS.slice(0, TILE_STEPS.indexOf(view.step)),
        errors: code === undefined ? {} : { [view.step]: code },
        complete: view.handedOff,
    };
}
