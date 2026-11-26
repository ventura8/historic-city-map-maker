/**
 * The `telemetry.*` functions (fn-admin, `docs/research/M2-interfaces.md` §3.4): the public crash endpoint and the
 * Setup Assistant's crash list. The integrator's `functions/src/index.ts` exports
 * `telemetry = telemetryFunctions(getDeps)`, which deploys `telemetry-reportError` and `telemetry-listGroups`.
 */
import type { CallableDeps } from '../api/callable.js';
import { listGroupsFunction, type ListGroupsDeps } from './list-groups.js';
import { reportErrorFunction, type ReportErrorDeps } from './report-error.js';

export type TelemetryFamilyDeps = CallableDeps & ReportErrorDeps & ListGroupsDeps;

export function telemetryFunctions(getDeps: () => TelemetryFamilyDeps) {
    return { reportError: reportErrorFunction(getDeps), listGroups: listGroupsFunction(getDeps) };
}
