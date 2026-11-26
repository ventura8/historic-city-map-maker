/**
 * The CLI's own release (its `package.json`), which `--version` prints, its template's engine pins follow, and every
 * command line it prints names exactly, so a printed command never resolves to
 * another release, or to another package should the name change hands (`docs/LESSONS.md` 238).
 */
import { cliPackageSpec } from '@hcm/shared';

import packageJson from '../package.json' with { type: 'json' };

export const CLI_VERSION = packageJson.version;

/** The CLI as a printed command line runs it, pinned to its published tarball or npm version. */
export const NPX_COMMAND = `npx ${cliPackageSpec(CLI_VERSION)}`;
