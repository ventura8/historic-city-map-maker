import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import type { BuildEnvironment } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { buildInstallBundle, type StepFiles } from './bundle.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-install.ts [--public-tree dist/hosting-public]
 * [--out dist/hosting]… [--functions functions/dist]` (`npm run build:install`, after `build:hosting` and the
 * functions' build: CR-M6-5; `docs/research/M6-interfaces.md` §1.3): writes the install bundle of this checkout's
 * release into each `--out` tree at `admin/install/<slug>/` (`bundle.ts`). The environment names the commit
 * (`HCM_COMMIT`, `GITHUB_SHA`; else the checkout's `HEAD`) and the entries' time (`SOURCE_DATE_EPOCH`).
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

const USAGE = 'usage: build-install.ts [--public-tree dist/hosting-public] [--out dist/hosting]… [--functions functions/dist]';

export interface InstallCliContext {
    readonly files: SiteFileSystem;
    readonly log: Logger;
    readonly env: BuildEnvironment;
    /** The bundled step scripts (`bundleSteps` of `steps-bundle.ts`, which runs Vite). */
    readonly steps: () => Promise<StepFiles>;
}

interface InstallCliOptions {
    readonly publicTree: string;
    readonly out: readonly string[];
    readonly functionsDir: string;
}

function readOptions(argv: readonly string[]): InstallCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            'public-tree': { type: 'string', default: 'dist/hosting-public' },
            out: { type: 'string', multiple: true, default: ['dist/hosting'] },
            functions: { type: 'string', default: 'functions/dist' },
        },
        strict: true,
        allowPositionals: false,
    });
    return { publicTree: values['public-tree'], out: values.out, functionsDir: values.functions };
}

/** Runs the CLI: an input problem is logged with exit status 1; anything else is a bug and propagates. */
export async function runInstallCli(argv: readonly string[], context: InstallCliContext): Promise<number> {
    let options: InstallCliOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error(USAGE, { reason: String(error) });
        return EXIT_USAGE;
    }
    try {
        const report = buildInstallBundle({ ...options, env: context.env }, context.files, await context.steps());
        context.log.info('install bundle built', { release: report.release, slug: report.slug, ...report.bytes });
        return EXIT_OK;
    } catch (error: unknown) {
        if (error instanceof SiteBuildError) {
            context.log.error(error.message);
            return EXIT_INVALID;
        }
        throw error;
    }
}
