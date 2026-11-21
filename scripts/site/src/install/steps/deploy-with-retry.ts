/**
 * The server build's `functions` step (`docs/research/M6-interfaces.md` §1.4.1, §1.5):
 * `firebase deploy --only functions --force --project <p> --non-interactive` with the bundle's locked `firebase-tools`,
 * retrying only the known first-deploy races (`TRANSIENT_DEPLOY_PATTERNS`: Eventarc's service agent still propagating,
 * finding 12 of 2026-10-25; a 429 on the mutation quota; an operation already in progress; a 503). At most four
 * attempts, waiting 60, 120 and 240 s; a retry deploys only the functions `firebase-tools` named as failed, else the
 * whole target; each wait prints an `HCM_INSTALL` retry line the admin's card shows. Any other failure fails the step at
 * once. `--force` (finding 9): `firebase-tools` refuses, without it, a function with a failure policy.
 *
 * `node steps/deploy-with-retry.mjs --project <project> [--force]`
 */
import { parseArgs } from 'node:util';

import { transientDeployReason } from '@hcm/shared';

import { logEvent, type StepDeps } from './step-io.js';

/** `firebase-tools` as the bundle's `tools/` folder installs it. */
export const FIREBASE_BIN = 'tools/node_modules/firebase-tools/lib/bin/firebase.js';

/** The waits before the second, third and fourth attempts. */
const RETRY_WAITS_SECONDS = [60, 120, 240] as const;

/** firebase-tools' line before the failed functions ("Functions deploy had errors with the following functions:"). */
const FAILED_HEADING = /following functions/i;
/** One failed function's line: `\tops-tick(us-central1)`. */
const FAILED_LINE = /^\s*([a-z][\w-]{0,62})\([a-z0-9-]{1,30}\)\s*$/;

/**
 * The functions firebase-tools named as failed, as `--only` targets (`admin-session` → `functions:admin.session`: the
 * export's group and name; UNVERIFIED against a live deploy, which the first in-app install proves), or [] for none.
 */
export function failedTargets(output: string): string[] {
    const lines = output.split('\n');
    const heading = lines.findIndex((line) => FAILED_HEADING.test(line));
    const names: string[] = [];
    for (const line of heading === -1 ? [] : lines.slice(heading + 1)) {
        const name = FAILED_LINE.exec(line)?.[1];
        if (name === undefined) {
            break;
        }
        names.push(`functions:${name.replace('-', '.')}`);
    }
    return names;
}

interface Options {
    readonly project: string;
    readonly force: boolean;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: { project: { type: 'string' }, force: { type: 'boolean', default: false } },
        strict: true,
    });
    if (values.project === undefined) {
        throw new Error('usage: deploy-with-retry --project <project> [--force]');
    }
    return { project: values.project, force: values.force };
}

function deployArgs(opts: Options, only: string): string[] {
    return [FIREBASE_BIN, 'deploy', '--only', only, '--project', opts.project, '--non-interactive', ...(opts.force ? ['--force'] : [])];
}

/** The next attempt's `--only`: the failed functions, else the whole target. */
function nextOnly(output: string): string {
    const targets = failedTargets(output);
    return targets.length === 0 ? 'functions' : targets.join(',');
}

/** Deploys the functions; resolves to the step's exit status. */
export async function deployWithRetry(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    let only = 'functions';
    for (let attempt = 1; ; attempt += 1) {
        const { code, output } = await deps.run('node', deployArgs(opts, only));
        const reason = code === 0 ? null : transientDeployReason(output);
        const wait = RETRY_WAITS_SECONDS[attempt - 1];
        if (reason === null || wait === undefined) {
            return code;
        }
        logEvent(deps, { event: 'retry', attempt, waitSeconds: wait, reason });
        await deps.sleep(wait * 1000);
        only = nextOnly(output);
    }
}
