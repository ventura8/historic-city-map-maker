/**
 * The install builds' step scripts by name (`docs/research/M6-interfaces.md` §1.4): the bundle builder bundles this
 * module into `steps/steps.mjs` and writes one small entry per step (`steps/<name>.mjs`) that runs it with the real world
 * (`nodeStepDeps`). A step that throws (a bad argument, a refused call) exits 1 with its message.
 */
import { deployHosting } from './deploy-hosting.js';
import { deployWithRetry } from './deploy-with-retry.js';
import { hostingConfig } from './hosting-config.js';
import { runJobs } from './run-jobs.js';
import { nodeStepDeps, type StepDeps } from './step-io.js';
import { verifyServer } from './verify-server.js';

export const STEPS = {
    'deploy-with-retry': deployWithRetry,
    'verify-server': verifyServer,
    'run-jobs': runJobs,
    'hosting-config': hostingConfig,
    'deploy-hosting': deployHosting,
} as const satisfies Readonly<Record<string, (argv: readonly string[], deps: StepDeps) => Promise<number>>>;

export type StepName = keyof typeof STEPS;

/** Runs step `name`; resolves to its exit status (1 with the message for anything it threw). */
export async function runStep(name: StepName, argv: readonly string[], deps: StepDeps = nodeStepDeps()): Promise<number> {
    try {
        return await STEPS[name](argv, deps);
    } catch (error) {
        deps.log(`${name}: ${String(error)}`);
        return 1;
    }
}
