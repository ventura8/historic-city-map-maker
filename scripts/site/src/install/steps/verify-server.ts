/**
 * The server build's `verify` step (`docs/research/M6-interfaces.md` §1.4.1): lists the project's functions (Cloud
 * Functions v2) and requires every name of the bundle's manifest `ACTIVE` with `HCM_RELEASE` equal to the build's
 * release; it prints one `HCM_INSTALL` line per missing or failed name (the admin's card names them) and exits 1 when
 * there is any.
 *
 * `node steps/verify-server.mjs --project <p> --region <r> --release <release> [--manifest /workspace/bundle/manifest.json]`
 */
import { parseArgs } from 'node:util';

import { googleJson, logEvent, type StepDeps } from './step-io.js';

const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2';
const MAX_PAGES = 20;

/** Where the `fetch` step left the checked manifest. */
const MANIFEST_PATH = '/workspace/bundle/manifest.json';

interface Options {
    readonly project: string;
    readonly region: string;
    readonly release: string;
    readonly manifest: string;
}

interface Deployed {
    readonly state: string;
    readonly release: string | null;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            project: { type: 'string' },
            region: { type: 'string' },
            release: { type: 'string' },
            manifest: { type: 'string', default: MANIFEST_PATH },
        },
        strict: true,
    });
    const { project, region, release, manifest } = values;
    if (project === undefined || region === undefined || release === undefined) {
        throw new Error('usage: verify-server --project <p> --region <r> --release <release> [--manifest <path>]');
    }
    return { project, region, release, manifest };
}

/** The manifest's expected function names. */
export function expectedNames(text: string): string[] {
    const functions = (JSON.parse(text) as { functions?: unknown }).functions;
    return Array.isArray(functions) ? functions.filter((name): name is string => typeof name === 'string') : [];
}

interface ListedFunction {
    readonly name?: string;
    readonly state?: string;
    readonly serviceConfig?: { readonly environmentVariables?: Readonly<Record<string, unknown>> };
}

/** A listed function's short name, state and release (`HCM_RELEASE`, null without one). */
/** The `HCM_RELEASE` a listed function runs, or null without one. */
function releaseOf(item: ListedFunction): string | null {
    const release = item.serviceConfig?.environmentVariables?.['HCM_RELEASE'];
    return typeof release === 'string' ? release : null;
}

function deployedOf(item: ListedFunction): [string, Deployed] {
    const name = item.name ?? '';
    return [name.slice(name.lastIndexOf('/') + 1), { state: item.state ?? '', release: releaseOf(item) }];
}

/** Why an expected function is not in place, or null when it is. */
function problemOf(found: Deployed | undefined, release: string): 'missing' | 'failed' | null {
    if (found === undefined) {
        return 'missing';
    }
    return found.state === 'ACTIVE' && found.release === release ? null : 'failed';
}

async function listFunctions(deps: StepDeps, token: string, opts: Options): Promise<Map<string, Deployed>> {
    const found = new Map<string, Deployed>();
    let pageToken = '';
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${FUNCTIONS}/projects/${opts.project}/locations/${opts.region}/functions`);
        url.searchParams.set('pageSize', '200');
        url.searchParams.set('pageToken', pageToken);
        const body = (await googleJson(deps, token, url.toString())) as { functions?: ListedFunction[]; nextPageToken?: string };
        (body.functions ?? []).map(deployedOf).forEach(([name, deployed]) => found.set(name, deployed));
        pageToken = body.nextPageToken ?? '';
        if (pageToken === '') {
            break;
        }
    }
    return found;
}

/** Checks every expected function; resolves to the step's exit status. */
export async function verifyServer(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    const expected = expectedNames(deps.readFile(opts.manifest));
    const deployed = await listFunctions(deps, await deps.token(), opts);
    let problems = 0;
    for (const name of expected) {
        const problem = problemOf(deployed.get(name), opts.release);
        if (problem !== null) {
            logEvent(deps, { event: problem, name });
            problems += 1;
        }
    }
    deps.log(`verify: ${String(expected.length - problems)} of ${String(expected.length)} functions are ACTIVE on ${opts.release}`);
    return problems === 0 && expected.length > 0 ? 0 : 1;
}
