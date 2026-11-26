import { parseArgs } from 'node:util';

import type { EngineRelease, Logger } from '@hcm/shared';

import { RELEASE_JSON, releaseFolderProblems, writeReleaseFolder } from './cdn.js';
import { ReleaseError, type ReleaseFiles } from './files.js';
import { readRelease, sriBlock, withSriBlock } from './notes-sri.js';
import { KIT_TEMPLATE, pinKitPage } from './pin-kit.js';
import { planBump } from './versions.js';

/**
 * The release scripts' command lines (`docs/research/M5-interfaces.md` §2, `.agent/skills/quality/prepare_release_skill.md`),
 * each run as `node --import ./scripts/site/register-ts.mjs scripts/release/<entry>.ts` through its npm script:
 *
 * - `npm run release:bump -- X.Y.Z`: every version of §2.2;
 * - `npm run release:cdn [-- --check] [--summary <file>]`: writes `cdn/engine/` from `packages/engine/dist`, or (the
 *   `release-cdn` gate) checks it byte for byte; `--summary` also writes the pinned addresses' block to `<file>`;
 * - `npm run release:pin-kit`: the starter kit's engine block and CSP pinned to `cdn/engine/release.json`;
 * - `npm run release:notes -- --write docs/releases/vX.Y.Z_github_description.md`: the block between the markers.
 *
 * Exit status: 0 done, 1 an input is missing, invalid or out of date, 2 usage.
 */

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

interface ReleaseContext {
    readonly files: ReleaseFiles;
    readonly log: Logger;
}

type Command = (argv: readonly string[], context: ReleaseContext) => number;

/** Node's `parseArgs` refusing the command line (an unknown option, a missing value, a positional). */
function isUsageError(error: unknown): error is TypeError {
    return error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');
}

/** Runs `command`: a usage problem exits 2, an input problem 1 with its reason; anything else is a bug and propagates. */
function guarded(usage: string, command: Command): Command {
    return (argv, context) => {
        try {
            return command(argv, context);
        } catch (error: unknown) {
            if (error instanceof ReleaseError) {
                context.log.error(error.message);
                return EXIT_INVALID;
            }
            if (isUsageError(error)) {
                context.log.error(`usage: ${usage}`, { reason: error.message });
                return EXIT_USAGE;
            }
            throw error;
        }
    };
}

function bump(argv: readonly string[], context: ReleaseContext): number {
    const { positionals } = parseArgs({ args: [...argv], options: {}, strict: true, allowPositionals: true });
    const [version, ...rest] = positionals;
    if (version === undefined || rest.length > 0) {
        context.log.error('usage: release:bump -- <MAJOR.MINOR.PATCH>');
        return EXIT_USAGE;
    }
    const changes = planBump(context.files, version);
    for (const change of changes) {
        context.files.write(change.path, change.text);
    }
    context.log.info(`every version is ${version}`, { rewritten: changes.map((change) => change.path) });
    context.log.info('next: npm run build --workspace @hcm/engine, then npm run release:cdn (quality/prepare_release_skill.md)');
    return EXIT_OK;
}

/** The `release-cdn` gate's check: the committed release, or null (logged) when it is not a fresh build's. */
function checkFolder(context: ReleaseContext): EngineRelease | null {
    const checked = releaseFolderProblems(context.files);
    if (checked.problems.length > 0) {
        context.log.error(`cdn/engine/ is not the release folder of a fresh build:\n${checked.problems.join('\n')}`);
        context.log.error('rebuild it on the release commit: npm run build --workspace @hcm/engine && npm run release:cdn');
        return null;
    }
    context.log.info(`cdn/engine/ is the release folder of a fresh build of ${checked.release.version}`, {
        files: checked.release.files.length,
    });
    return checked.release;
}

function writeFolder(context: ReleaseContext): EngineRelease {
    const release = writeReleaseFolder(context.files);
    context.log.info(`wrote cdn/engine/ for ${release.version}`, { files: release.files.length, base: release.base });
    return release;
}

function cdn(argv: readonly string[], context: ReleaseContext): number {
    const { values } = parseArgs({
        args: [...argv],
        options: { check: { type: 'boolean', default: false }, summary: { type: 'string' } },
        strict: true,
        allowPositionals: false,
    });
    const release = values.check ? checkFolder(context) : writeFolder(context);
    if (release === null) {
        return EXIT_INVALID;
    }
    if (values.summary !== undefined) {
        context.files.write(values.summary, `${sriBlock(release)}\n`);
    }
    return EXIT_OK;
}

function notes(argv: readonly string[], context: ReleaseContext): number {
    const { values } = parseArgs({ args: [...argv], options: { write: { type: 'string' } }, strict: true, allowPositionals: false });
    if (values.write === undefined) {
        context.log.error('usage: release:notes -- --write docs/releases/vX.Y.Z_github_description.md');
        return EXIT_USAGE;
    }
    if (!context.files.isFile(values.write)) {
        throw new ReleaseError(`${values.write} is missing: write the release notes first (docs/releases/README.md)`);
    }
    const release = readRelease(context.files, RELEASE_JSON);
    context.files.write(values.write, withSriBlock(context.files.readText(values.write), release));
    context.log.info(`wrote the pinned addresses of ${release.version} into ${values.write}`);
    return EXIT_OK;
}

function pinKit(argv: readonly string[], context: ReleaseContext): number {
    parseArgs({ args: [...argv], options: {}, strict: true, allowPositionals: false });
    if (!context.files.isFile(KIT_TEMPLATE)) {
        throw new ReleaseError(`${KIT_TEMPLATE} is missing`);
    }
    const release = readRelease(context.files, RELEASE_JSON);
    context.files.write(KIT_TEMPLATE, pinKitPage(context.files.readText(KIT_TEMPLATE), release));
    context.log.info(`pinned ${KIT_TEMPLATE} to the engine ${release.version}`, { base: release.base });
    return EXIT_OK;
}

export const runBump: Command = guarded('release:bump -- <MAJOR.MINOR.PATCH>', bump);
export const runCdn: Command = guarded('release:cdn [-- --check] [--summary <file>]', cdn);
export const runNotes: Command = guarded('release:notes -- --write <file>', notes);
export const runPinKit: Command = guarded('release:pin-kit', pinKit);
