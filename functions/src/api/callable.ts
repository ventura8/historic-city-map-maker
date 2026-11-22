import { CALLABLES, validate, type CallableName, type CallableRequest, type CallableResponse, type Logger } from '@hcm/shared';
import { onCall, type CallableFunction, type CallableOptions } from 'firebase-functions/https';

import { runAs } from '../global-options.js';
import type { AdminDirectory } from '../ports/admin-directory.js';
import { noWorkerClaims, requireAccess, requireCityRole, workerClaims, type Caller, type VerifiedCaller } from './access.js';
import { ApiError, toHttpsError } from './api-error.js';

/** What every callable needs from the composition root, besides the ports its handler picks. */
export interface CallableDeps {
    readonly log: Logger;
    readonly admins: AdminDirectory;
}

/** A pure handler: validated input in, a response that `CALLABLES[name].response` accepts out; failures are `ApiError`s. */
export type CallableHandler<N extends CallableName, D> = (
    deps: D,
    caller: VerifiedCaller,
    data: CallableRequest<N>,
) => Promise<CallableResponse<N>>;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Callables that may run longer than the default 60 s (`docs/research/M3-interfaces.md` §3.5, CR-M3-22): the first
 * harvest searches five datasets, up to five pages each and once more per target year at the cap, and copies the best browse
 * images ahead; it stops asking USGS after `SEARCH_BUDGET_MS` (lesson 646). The admin asks with a timeout just over it (`IMAGERY_SEARCH_TIMEOUT_MS` of `packages/admin/src/imagery/search.ts`).
 */
const CALLABLE_TIMEOUT_SECONDS: Readonly<Partial<Record<CallableName, number>>> = { 'imagery.search': 540 };

/**
 * Callables that take fewer requests at once than Cloud Run's 80 per instance: `imagery.browse` holds a USGS browse image (up to 30 MB)
 * and decodes it, and ran out of its 256 MiB 14 times in a week (admin sweep 2026-11-14, crash group "Memory limit of 256 MiB
 * exceeded"). Two at a time stay within it; the admin asks four at a time, so a second instance takes the rest (still in the free tier).
 */
const CALLABLE_CONCURRENCY: Readonly<Partial<Record<CallableName, number>>> = { 'imagery.browse': 2 };

/**
 * Callables that need more than the default 256 MiB: `imagery.markScene` rewrites the whole-city date plan after each mark and
 * ran out of 256 MiB (259 MiB used; Crashes top group, release `imagery-markscene-00032-wut`, 2026-11-20). 512 MiB matches
 * `imagery.tick` / `publish.buildManifest` (cost-shape table). `imagery.browse` still ran out of 256 MiB at two requests an
 * instance (67 times in 30 days, last on 2026-11-22: `reports/analytics-review-2026-11-22.md`, LESSONS 760): one KH-9 strip's
 * fetched bytes plus its decoded pixels for the shrink pass 256 MiB alone.
 */
const CALLABLE_MEMORY: Readonly<Partial<Record<CallableName, '512MiB'>>> = { 'imagery.markScene': '512MiB', 'imagery.browse': '512MiB' };

/** Timeout, concurrency and memory overrides when `CALLABLE_*` names the callable. */
function callableLimits(name: CallableName): Pick<CallableOptions, 'timeoutSeconds' | 'concurrency' | 'memory'> {
    return {
        ...(CALLABLE_TIMEOUT_SECONDS[name] === undefined ? {} : { timeoutSeconds: CALLABLE_TIMEOUT_SECONDS[name] }),
        ...(CALLABLE_CONCURRENCY[name] === undefined ? {} : { concurrency: CALLABLE_CONCURRENCY[name] }),
        ...(CALLABLE_MEMORY[name] === undefined ? {} : { memory: CALLABLE_MEMORY[name] }),
    };
}

/**
 * The deploy options of a callable: its `maxInstances`, a longer timeout where `CALLABLE_TIMEOUT_SECONDS` names one,
 * its runtime service account (`runAs`: `fn-admin@` for every callable), and App Check from `HCM_APP_CHECK` (security review §1.6: one week of `monitor`, which leaves enforcement
 * off, then `enforce`); `consume` callables then also consume the token (replay protection for ownership and secret
 * pastes). The local worker's callables (`off`, M7: `docs/research/M7-local-worker.md` §2.4) never enforce it: a process on
 * the owner's computer cannot be attested; the city editor's ID token is their credential.
 */
export function callableOptions(name: CallableName, env: Env): CallableOptions {
    const spec = CALLABLES[name];
    const enforce = env['HCM_APP_CHECK'] === 'enforce' && spec.appCheck !== 'off';
    return {
        maxInstances: spec.maxInstances,
        ...callableLimits(name),
        ...runAs(name),
        enforceAppCheck: enforce,
        consumeAppCheckToken: enforce && spec.appCheck === 'consume',
    };
}

/**
 * One callable call without firebase-functions: access rule, request validation (`apiError.invalidRequest` with the
 * field issues), the city role of an M5 city callable, the handler, then the response checked against its schema (a
 * mismatch is a server bug: logged, answered `apiError.internal`, never sent).
 */
export async function runCallable<N extends CallableName, D extends CallableDeps>(
    name: N,
    handler: CallableHandler<N, D>,
    deps: D,
    request: { readonly auth: Caller | undefined; readonly data: unknown },
): Promise<CallableResponse<N>> {
    const spec = CALLABLES[name];
    const caller = await requireAccess(spec.access, request.auth, deps.admins, 'workerToken' in spec ? workerClaims : noWorkerClaims);
    const input = validate<unknown>(spec.request, request.data);
    if (!input.ok) {
        const fields = input.issues.slice(0, 5).map((issue) => `${issue.path || '(request)'}: ${issue.code}`);
        deps.log.warn('callable request refused: invalid fields', {
            callable: name,
            count: input.issues.length,
            fields: fields.join(', '),
        });
        throw new ApiError('apiError.invalidRequest', undefined, input.issues);
    }
    requireCityRole(spec.access, caller, input.value);
    // The registry pairs each name with its schemas; TypeScript cannot narrow `CALLABLES[N]` for a generic N.
    const output = validate<unknown>(spec.response, await handler(deps, caller, input.value as CallableRequest<N>));
    if (!output.ok) {
        deps.log.error('callable response does not match its schema', { callable: name, issues: output.issues.length });
        throw new ApiError('apiError.internal');
    }
    return output.value as CallableResponse<N>;
}

/**
 * The callable `name` of the registry (`@hcm/shared` → `CALLABLES`), deployed as `deployedName(name)` by the export
 * path in `functions/src/index.ts`. Every failure leaves as `HttpsError(status, code, details)` (`toHttpsError`).
 */
export function defineCallable<N extends CallableName, D extends CallableDeps>(
    name: N,
    handler: CallableHandler<N, D>,
    getDeps: () => D,
    env: Env = process.env,
): CallableFunction<unknown, Promise<CallableResponse<N>>> {
    return onCall(callableOptions(name, env), async (request) => {
        const deps = getDeps();
        try {
            return await runCallable(name, handler, deps, { auth: request.auth, data: request.data });
        } catch (error) {
            throw toHttpsError(error, deps.log.child(name));
        }
    });
}
