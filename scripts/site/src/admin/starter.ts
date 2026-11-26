import { createHash } from 'node:crypto';

import { WORKER_STARTER_LIST_FILE, WORKER_STARTER_TEMPLATES, WORKER_STARTER_VERSION } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import type { AdminFile } from './legacy.js';

/**
 * The starter files' version and the release's list of them (`docs/research/M7-local-worker.md`, *The starter updates itself*;
 * lesson of 2026-11-13: both files said `HCM_STARTER=2` for months while their content changed, so no worker ever said its
 * starter was old). The version is content's: the first 12 hex digits of the SHA-256 of the POSIX template and the Windows one
 * (LF line ends), each with its own version line emptied. The same value is written in four places, which a test and this
 * build hold equal: the POSIX line `STARTER_VERSION=`, the Windows line `$StarterVersion = '…'`, `WORKER_STARTER_VERSION` of
 * `@hcm/shared` (the admin) and `STARTER_VERSION` of the pipeline's `worker/ai_state.py` (the worker).
 *
 * `<admin>/starter.json` is the list an installed starter checks a newer file against before it replaces itself: the version and
 * each template's SHA-256 (LF line ends, the marks unfilled), published on Hosting by the same release as the server that serves
 * the files (`worker.starter`).
 */

/** Where the templates are. */
export const STARTER_TEMPLATE_DIR = 'packages/admin/starter';

const POSIX_LINE = /^STARTER_VERSION=.*$/m;
const WINDOWS_LINE = /^\$StarterVersion = '.*'$/m;
const VERSION = /^[0-9a-f]{12}$/;

/** A template as it is hashed: LF line ends. */
function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The version of the two templates' content, whatever their version lines say. */
export function starterVersionOf(posix: string, windows: string): string {
    const blank = `${lf(posix).replace(POSIX_LINE, 'STARTER_VERSION=')}\0${lf(windows).replace(WINDOWS_LINE, "$StarterVersion = ''")}`;
    return sha256(blank).slice(0, 12);
}

/** What each template's own version line says (empty when it has none). */
export function writtenVersions(posix: string, windows: string): { readonly posix: string; readonly windows: string } {
    const posixLine = POSIX_LINE.exec(lf(posix))?.[0] ?? '';
    const windowsLine = WINDOWS_LINE.exec(lf(windows))?.[0] ?? '';
    return { posix: posixLine.slice('STARTER_VERSION='.length), windows: windowsLine.slice("$StarterVersion = '".length, -1) };
}

/** Whether both files and `@hcm/shared` say the content's version. */
function holdsVersion(version: string, written: { readonly posix: string; readonly windows: string }): boolean {
    return VERSION.test(version) && [written.posix, written.windows, WORKER_STARTER_VERSION].every((each) => each === version);
}

/** The list Hosting publishes. */
export interface StarterList {
    readonly version: string;
    readonly sha256: { readonly posix: string; readonly windows: string };
}

/** The list of the templates in `dir`; throws SiteBuildError when a version line, or `@hcm/shared`'s, is not the content's. */
export function starterList(files: SiteFileSystem, dir: string = STARTER_TEMPLATE_DIR): StarterList {
    const posix = files.readText(`${dir}/${WORKER_STARTER_TEMPLATES.posix}`);
    const windows = files.readText(`${dir}/${WORKER_STARTER_TEMPLATES.windows}`);
    const version = starterVersionOf(posix, windows);
    if (!holdsVersion(version, writtenVersions(posix, windows))) {
        throw new SiteBuildError(
            `the starter files changed: their version is now ${version}; write it in ${dir}/${WORKER_STARTER_TEMPLATES.posix} ` +
                `(STARTER_VERSION=), ${dir}/${WORKER_STARTER_TEMPLATES.windows} ($StarterVersion), WORKER_STARTER_VERSION of ` +
                'packages/shared/src/api/worker.ts and STARTER_VERSION of pipeline/src/hcm_pipeline/worker/ai_state.py',
        );
    }
    return { version, sha256: { posix: sha256(lf(posix)), windows: sha256(lf(windows)) } };
}

/** `starter.json` of the admin's Hosting folder. */
export function planStarterList(files: SiteFileSystem, dir?: string): AdminFile {
    return { to: WORKER_STARTER_LIST_FILE, content: `${JSON.stringify(starterList(files, dir), null, 4)}\n` };
}
