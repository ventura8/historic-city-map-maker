/**
 * The Setup Assistant's funnel (`trackFunnel` of `@hcm/shared`; `docs/ARCHITECTURE.md` → *Wizard funnels*): one step per
 * card in the page's order (Google Cloud, billing, Mapbox, USGS, the installs, Update the map …), the open card on screen,
 * a card done once its check says `ok`, its error by the message's key, the wizard complete once Setup is.
 */
import type { FunnelSnapshot } from '@hcm/shared/funnels';

import type { SetupStepView, SetupViewState } from './setup-port.js';

/** The code a card's failure shows: its error's key, else its detail's key while it is `invalid`. */
function errorOf(step: SetupStepView): string | null {
    if (step.error !== null) {
        return step.error.key;
    }
    return step.state === 'invalid' ? (step.detail?.key ?? 'invalid') : null;
}

/** Where Setup stands; null while its first checks have not answered. */
export function setupFunnel(view: SetupViewState): FunnelSnapshot | null {
    if (view.loading === true) {
        return null;
    }
    const steps = view.order.map((id) => view.steps[id]);
    const errors: Record<string, string> = {};
    for (const step of steps) {
        const code = errorOf(step);
        if (code !== null) {
            errors[step.id] = code;
        }
    }
    return {
        wizard: 'setup',
        order: view.order,
        step: view.openStep,
        done: steps.filter((step) => step.state === 'ok').map((step) => step.id),
        errors,
        complete: view.ready,
    };
}
