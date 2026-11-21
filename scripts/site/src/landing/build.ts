import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { LANDING_FILES, LANDING_STYLESHEET, LANDING_STYLESHEET_FILE, renderLandingPage } from './page.js';
import { LANDING_CATALOGUES, LANDING_LANGUAGES, landingCatalogues, type LandingLanguage } from './texts.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-landing.ts [--out sites/landing] [--check]`
 * (`npm run build:landing`): writes the project's landing page for GitHub Pages (`docs/research/DECISIONS-for-review.md`
 * §162) into `sites/landing/`, which is committed and which `.github/workflows/pages.yml` publishes as it is. `--check`
 * (the `landing` gate) writes nothing and fails when the committed folder is not exactly what the build writes, so a new
 * release (the CLI's pinned version) or a changed word is never deployed stale.
 *
 * Exit status: 0 built or up to date, 1 the words are incomplete or the folder is stale, 2 usage.
 */
export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export const LANDING_DIR = 'sites/landing';
const USAGE = 'usage: build-landing.ts [--out sites/landing] [--check]';

export interface LandingCliContext {
    readonly files: SiteFileSystem;
    readonly log: Logger;
}

/** A file of the landing folder: its name and its text. */
export interface LandingFile {
    readonly path: string;
    readonly text: string;
}

function repositoryVersion(files: SiteFileSystem): string {
    const version = (JSON.parse(files.readText('package.json')) as { readonly version?: unknown }).version;
    if (typeof version !== 'string' || version === '') {
        throw new SiteBuildError('package.json has no version for the landing page’s terminal road');
    }
    return version;
}

/** Every file of the landing folder, from the catalogues and the repository's version. */
export function landingFiles(
    files: SiteFileSystem,
    catalogues: Parameters<typeof landingCatalogues>[0] = LANDING_CATALOGUES,
): LandingFile[] {
    const words = landingCatalogues(catalogues);
    const inputs = { version: repositoryVersion(files) };
    const pages = LANDING_LANGUAGES.map((lang: LandingLanguage) => ({
        path: LANDING_FILES[lang],
        text: renderLandingPage(lang, words[lang], inputs),
    }));
    return [...pages, { path: LANDING_STYLESHEET_FILE, text: LANDING_STYLESHEET }].sort((a, b) => a.path.localeCompare(b.path));
}

/** What keeps `dir` from being exactly `expected` (empty when it is). */
function landingProblems(files: SiteFileSystem, dir: string, expected: readonly LandingFile[]): string[] {
    const present = files.isFile(`${dir}/${LANDING_FILES.en}`) ? files.listFiles(dir) : [];
    const wanted = new Set(expected.map((file) => file.path));
    const extra = present.filter((path) => !wanted.has(path)).map((path) => `${dir}/${path}: not written by the build`);
    const stale = expected
        .filter((file) => !present.includes(file.path) || files.readText(`${dir}/${file.path}`) !== file.text)
        .map((file) => `${dir}/${file.path}: missing or not what the build writes`);
    return [...stale, ...extra];
}

function readOptions(argv: readonly string[]): { readonly out: string; readonly check: boolean } {
    const { values } = parseArgs({
        args: [...argv],
        options: { out: { type: 'string', default: LANDING_DIR }, check: { type: 'boolean', default: false } },
        strict: true,
        allowPositionals: false,
    });
    return { out: values.out, check: values.check };
}

function run(
    options: { readonly out: string; readonly check: boolean },
    context: LandingCliContext,
    catalogues: Parameters<typeof landingFiles>[1],
): number {
    const expected = landingFiles(context.files, catalogues);
    if (options.check) {
        const problems = landingProblems(context.files, options.out, expected);
        if (problems.length > 0) {
            context.log.error(`[landing] ${options.out} is stale: run npm run build:landing`, { problems });
            return EXIT_INVALID;
        }
        context.log.info(`[landing] OK: ${options.out} is what the build writes`, { files: expected.length });
        return EXIT_OK;
    }
    context.files.remove(options.out);
    for (const file of expected) {
        context.files.write(`${options.out}/${file.path}`, file.text);
    }
    context.log.info(`[landing] wrote ${options.out}`, { files: expected.length });
    return EXIT_OK;
}

export function runLandingCli(
    argv: readonly string[],
    context: LandingCliContext,
    catalogues: Parameters<typeof landingFiles>[1] = LANDING_CATALOGUES,
): number {
    let options: { readonly out: string; readonly check: boolean };
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error(USAGE, { reason: String(error) });
        return EXIT_USAGE;
    }
    try {
        return run(options, context, catalogues);
    } catch (error: unknown) {
        if (!(error instanceof SiteBuildError)) {
            throw error;
        }
        context.log.error(error.message);
        return EXIT_INVALID;
    }
}
