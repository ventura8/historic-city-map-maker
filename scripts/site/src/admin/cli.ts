import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { buildAdminSite, DEFAULT_ADMIN_DIR } from './build.js';
import { DEFAULT_SEED_DIR } from './legacy.js';
import type { BuildEnvironment } from './runtime.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-admin.ts [--out packages/admin/dist] [--seed seed/bucharest]`:
 * after the admin's Vite build, writes its `index.html`, `runtime.json`, `project.json`, the fonts and the legacy import
 * bundle into the Hosting folder (`build.ts`). The root script `build:admin` runs both (Hosting's `predeploy`). The
 * environment names the commit (`HCM_COMMIT`, `GITHUB_SHA`; else the checkout's `HEAD`) and a start-up deploy
 * (`HCM_ADMIN_START_UP=1`, `runtime.ts`).
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export interface AdminCliContext {
    readonly files: SiteFileSystem;
    readonly log: Logger;
    /** The process's environment (`process.env`). */
    readonly env?: BuildEnvironment;
}

interface AdminCliOptions {
    readonly out: string;
    readonly seed: string;
}

function readOptions(argv: readonly string[]): AdminCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: { out: { type: 'string', default: DEFAULT_ADMIN_DIR }, seed: { type: 'string', default: DEFAULT_SEED_DIR } },
        strict: true,
        allowPositionals: false,
    });
    return { out: values.out, seed: values.seed };
}

/** Runs the CLI: an input problem is logged with exit status 1; anything else is a bug and propagates with its stack. */
export function runAdminCli(argv: readonly string[], context: AdminCliContext): number {
    let options: AdminCliOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error('usage: build-admin.ts [--out packages/admin/dist] [--seed seed/bucharest]', { reason: String(error) });
        return EXIT_USAGE;
    }
    try {
        const report = buildAdminSite({ outDir: options.out, seedDir: options.seed, env: context.env ?? {} }, context.files);
        context.log.info('admin site built', { ...report });
        return EXIT_OK;
    } catch (error: unknown) {
        if (error instanceof SiteBuildError) {
            context.log.error(error.message);
            return EXIT_INVALID;
        }
        throw error;
    }
}
