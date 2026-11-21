/**
 * The site build's `config` step (`docs/research/M6-interfaces.md` §1.4.3): keeps the Hosting site's last
 * `--max-versions` releases (Firebase Hosting `sites/<site>/config`, `maxVersions`), so old releases do not pile up in
 * storage. The site is the project's default one (its id is the project's) unless `--site` names another.
 *
 * `node steps/hosting-config.mjs --project <p> --max-versions 10 [--site <site>]`
 */
import { parseArgs } from 'node:util';

import { googleJson, type StepDeps } from './step-io.js';

const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';

interface Options {
    readonly site: string;
    readonly maxVersions: number;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: { project: { type: 'string' }, site: { type: 'string' }, 'max-versions': { type: 'string' } },
        strict: true,
    });
    const site = values.site ?? values.project;
    const maxVersions = Number(values['max-versions']);
    if (site === undefined || !Number.isInteger(maxVersions) || maxVersions < 1) {
        throw new Error('usage: hosting-config --project <p> --max-versions <n> [--site <site>]');
    }
    return { site, maxVersions };
}

/** Sets the site's `maxVersions`; resolves to the step's exit status. */
export async function hostingConfig(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    const url = `${HOSTING}/sites/${encodeURIComponent(opts.site)}/config?updateMask=maxVersions`;
    await googleJson(deps, await deps.token(), url, { method: 'PATCH', body: JSON.stringify({ maxVersions: opts.maxVersions }) });
    deps.log(`config: ${opts.site} keeps its last ${String(opts.maxVersions)} releases`);
    return 0;
}
