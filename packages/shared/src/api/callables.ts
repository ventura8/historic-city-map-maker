/**
 * Every callable of the backend in one table: the admin's (`ADMIN_CALLABLES`, registry.ts) and the local worker's
 * (`WORKER_CALLABLES`, worker-calls.ts, M7). The functions validate every request and response against it, the
 * integrator's `functions/src/index.ts` exports exactly these names, and the e2e mock server answers from the same
 * schemas. The admin reads `ADMIN_CALLABLES` instead, so the worker's schemas stay out of its bundle.
 */
import type { z } from 'zod';

import { ADMIN_CALLABLES, type CallableSpec } from './registry.js';
import { WORKER_CALLABLES } from './worker-calls.js';

export const CALLABLES = { ...ADMIN_CALLABLES, ...WORKER_CALLABLES } as const satisfies Readonly<Record<string, CallableSpec>>;

export type CallableName = keyof typeof CALLABLES;
export type CallableRequest<N extends CallableName> = z.infer<(typeof CALLABLES)[N]['request']>;
export type CallableResponse<N extends CallableName> = z.infer<(typeof CALLABLES)[N]['response']>;
