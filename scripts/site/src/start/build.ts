import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import type { BuildEnvironment } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { buildInstallBundle, type StepFiles } from '../install/bundle.js';
import { servingConfigOf } from './hosting-config.js';
import { siteVerificationOf, writeLegalFiles } from './legal.js';
import { startTreeFiles, writeStartSite, type StartTreeFile, type StartTreeInputs } from './tree.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-start.ts [--public-tree dist/hosting-public]
 * [--app dist/start-app] [--out dist/start] [--functions functions/dist]` (`npm run build:start`, after `build:hosting` and
 * the functions' build, `npm run build --workspace @hcm/admin` having built the page; `docs/research/M14-start-your-map.md` §5, §6). Assembles the start site: the page, and a release
 * whose tree holds the start-up variant with a generic install bundle made from the public variant. `HCM_START_OAUTH_CLIENT_ID`
 * (a public id, never a secret) opens the page; without it the page says it is not open yet and shows the terminal road.
 * `HCM_START_SITE_VERIFICATION` (`google<hex>.html`, Search Console's HTML file) writes that file at the root; another value is refused.
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */
export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

const USAGE =
    'usage: build-start.ts [--public-tree dist/hosting-public] [--app dist/start-app] [--out dist/start] [--functions functions/dist]';
/** Where the public variant of the tree is written for `hosting.tgz`, then removed. */
const GENERIC_PUBLIC = 'dist/start-generic-public';

export interface StartCliContext {
    readonly files: SiteFileSystem;
    readonly log: Logger;
    readonly env: BuildEnvironment;
    readonly steps: () => Promise<StepFiles>;
}

export interface StartBuildOptions {
    readonly publicTree: string;
    readonly appDir: string;
    readonly outDir: string;
    readonly functionsDir: string;
    /** The project and bucket the public tree names; default `infra/project.json`'s. */
    readonly project?: { readonly projectId: string; readonly publicBucket: string };
}

function projectOf(files: SiteFileSystem): { projectId: string; publicBucket: string } {
    const { projectId } = JSON.parse(files.readText('infra/project.json')) as { readonly projectId: string };
    return { projectId, publicBucket: `${projectId}-public` };
}

/** The start site from the built inputs. */
export function buildStartSite(
    options: StartBuildOptions,
    context: Omit<StartCliContext, 'log' | 'steps'>,
    steps: StepFiles,
): { release: string; files: number } {
    const { files, env } = context;
    const verification = siteVerificationOf(env);
    const project = options.project ?? projectOf(files);
    const hosting = (JSON.parse(files.readText('firebase.json')) as { readonly hosting?: unknown }).hosting;
    const inputs: StartTreeInputs = {
        publicTree: options.publicTree,
        appDir: options.appDir,
        outDir: options.outDir,
        projectId: project.projectId,
        publicBucket: project.publicBucket,
        hosting: servingConfigOf(hosting, project.projectId),
        env,
    };
    const startUp = startTreeFiles(inputs, 'start-up', files);
    files.remove(options.outDir);
    files.remove(GENERIC_PUBLIC);
    const publicTree = startTreeFiles(inputs, 'public', files);
    for (const file of publicTree) {
        files.write(`${GENERIC_PUBLIC}/${file.path}`, file.bytes);
    }
    const bundleDir = `${GENERIC_PUBLIC}-bundle`;
    files.remove(bundleDir);
    const bundle = buildInstallBundle(
        {
            publicTree: GENERIC_PUBLIC,
            out: [bundleDir],
            functionsDir: options.functionsDir,
            env,
            generic: true,
            templates: publicTree.filter((file) => file.template).map((file) => file.path),
        },
        files,
        steps,
    );
    const installFolder = `${bundleDir}/admin/install/${bundle.slug}`;
    const install: StartTreeFile[] = files.listFiles(installFolder).map((name) => ({
        path: `admin/install/${bundle.slug}/${name}`,
        bytes: files.readBytes(`${installFolder}/${name}`),
        template: false,
    }));
    const clientId = env['HCM_START_OAUTH_CLIENT_ID'];
    const manifest = writeStartSite(inputs, [...startUp, ...install], clientId === '' ? undefined : clientId, files);
    writeLegalFiles(options.outDir, verification, files);
    files.remove(GENERIC_PUBLIC);
    files.remove(bundleDir);
    return { release: manifest.release, files: manifest.files.length };
}

function readOptions(argv: readonly string[]): StartBuildOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            'public-tree': { type: 'string', default: 'dist/hosting-public' },
            app: { type: 'string', default: 'dist/start-app' },
            out: { type: 'string', default: 'dist/start' },
            functions: { type: 'string', default: 'functions/dist' },
        },
        strict: true,
        allowPositionals: false,
    });
    return { publicTree: values['public-tree'], appDir: values.app, outDir: values.out, functionsDir: values.functions };
}

export async function runStartCli(argv: readonly string[], context: StartCliContext): Promise<number> {
    let options: StartBuildOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error(USAGE, { reason: String(error) });
        return EXIT_USAGE;
    }
    try {
        siteVerificationOf(context.env);
        context.log.info('start site built', buildStartSite(options, context, await context.steps()));
        return EXIT_OK;
    } catch (error: unknown) {
        if (!(error instanceof SiteBuildError)) {
            throw error;
        }
        context.log.error(error.message);
        return EXIT_INVALID;
    }
}
