/**
 * The `cities.*` callables (fn-cities, `docs/research/M5-interfaces.md` §1.6, §1.8): the integrator's
 * `functions/src/index.ts` exports `cities = citiesFunctions(getDeps)`, which Firebase deploys as `cities-create`,
 * `cities-locate` (New city finds the named city on OpenStreetMap: the M5 UX review), `cities-setLimits` (all three the
 * project owner's) and `cities-setIcon` (the city's tab icon, its editors').
 */
import type { CallableDeps } from '../api/callable.js';
import { createFunction, type CreateDeps } from './create.js';
import { locateFunction, type LocateDeps } from './locate.js';
import { setIconFunction, type SetIconDeps } from './set-icon.js';
import { setLimitsFunction, type SetLimitsDeps } from './set-limits.js';

export type CitiesFamilyDeps = CallableDeps & CreateDeps & LocateDeps & SetLimitsDeps & SetIconDeps;

/** `cities.create`, `cities.locate`, `cities.setLimits`, `cities.setIcon`. */
export function citiesFunctions(getDeps: () => CitiesFamilyDeps) {
    return {
        create: createFunction(getDeps),
        locate: locateFunction(getDeps),
        setLimits: setLimitsFunction(getDeps),
        setIcon: setIconFunction(getDeps),
    };
}
