/**
 * New city's funnel (`#/cities/new`; `trackFunnel` of `@hcm/shared`, `docs/ARCHITECTURE.md` → *Wizard funnels*): the names,
 * the area, Create. The step on screen is the first not done; an area the page refuses and a failed Create are errors by
 * their keys; the city made completes it.
 */
import { firstOpenStep, type FunnelSnapshot } from '@hcm/shared/funnels';

import type { NewCityViewState } from './cities-port.js';

const ORDER = ['names', 'area', 'create'] as const;

/** The steps done: names typed (and an address), an area the page takes, the city made. */
function doneSteps(view: NewCityViewState): string[] {
    const done = {
        names: view.nameRo.trim() !== '' && view.cityId !== '',
        area: view.bounds !== null && view.problem === null,
        create: view.created !== null,
    };
    return ORDER.filter((step) => done[step]);
}

function errorsOf(view: NewCityViewState): Record<string, string> {
    return {
        ...(view.problem === null ? {} : { area: view.problem }),
        ...(view.error === null ? {} : { create: view.error.key }),
    };
}

export function newCityFunnel(view: NewCityViewState): FunnelSnapshot {
    const done = doneSteps(view);
    return {
        wizard: 'new_city',
        order: ORDER,
        step: firstOpenStep(ORDER, done),
        done,
        errors: errorsOf(view),
        complete: view.created !== null,
    };
}
