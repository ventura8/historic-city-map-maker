// The starter files' version (`scripts/site/src/admin/starter.ts`; lesson of 2026-11-13: both files said HCM_STARTER=2 while
// their content changed for a week, so no worker ever said its starter was old). The guard: the content's version is written in
// both templates, in @hcm/shared and in the pipeline, and the admin's build lists each template's SHA-256 for the self-update.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WORKER_STARTER_VERSION } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { planStarterList, STARTER_TEMPLATE_DIR, starterList, starterVersionOf, writtenVersions } from '../src/admin/starter.js';
import { SiteBuildError } from '../src/errors.js';
import { nodeFileSystem } from '../src/files.js';
import { ROOT, cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

const files = nodeFileSystem(ROOT);
const POSIX = files.readText(`${STARTER_TEMPLATE_DIR}/hcm-worker.sh`);
const WINDOWS = files.readText(`${STARTER_TEMPLATE_DIR}/hcm-worker.bat`);

/** A folder holding the two templates as given. */
function templatesIn(posix: string, windows: string): string {
    const folder = temporaryDir();
    const temporary = nodeFileSystem(folder);
    temporary.write('hcm-worker.sh', posix);
    temporary.write('hcm-worker.bat', windows);
    return folder;
}

describe('the starter files version', () => {
    it('happyPath_theContentsVersionIsWrittenInBothFilesTheAdminAndThePipeline @S-A142-HAPPY-VERSIONS', () => {
        const version = starterVersionOf(POSIX, WINDOWS);
        // When this fails, the starter files changed without their version: write the version named here in both templates,
        // WORKER_STARTER_VERSION (packages/shared/src/api/worker.ts) and STARTER_VERSION (pipeline/src/hcm_pipeline/worker/ai_state.py).
        expect({ version, ...writtenVersions(POSIX, WINDOWS) }).toEqual({ version, posix: version, windows: version });
        expect({ version, shared: WORKER_STARTER_VERSION }).toEqual({ version, shared: version });
        const pipeline = readFileSync(join(ROOT, 'pipeline/src/hcm_pipeline/worker/ai_state.py'), 'utf8');
        expect(pipeline).toContain(`STARTER_VERSION: Final = "${version}"`);
    });

    it('happyPath_theListNamesTheVersionAndEachTemplatesSha256 @S-A142-HAPPY-VERSIONS', () => {
        const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

        expect(starterList(files)).toEqual({ version: WORKER_STARTER_VERSION, sha256: { posix: sha(POSIX), windows: sha(WINDOWS) } });
        const planned = planStarterList(files);
        expect(planned.to).toBe('starter.json');
        expect('content' in planned ? JSON.parse(planned.content) : null).toEqual(starterList(files));
    });

    it('happyPath_theVersionIgnoresItsOwnLinesAndTheLineEnds', () => {
        const version = starterVersionOf(POSIX, WINDOWS);

        expect(starterVersionOf(POSIX.replace(/^STARTER_VERSION=.*$/m, 'STARTER_VERSION=000000000000'), WINDOWS)).toBe(version);
        expect(starterVersionOf(POSIX, WINDOWS.replace(/\n/g, '\r\n'))).toBe(version);
        expect(starterVersionOf(POSIX, WINDOWS.replace(/^\$StarterVersion = '.*'$/m, "$StarterVersion = 'x'"))).toBe(version);
    });

    it('badPath_aChangedTemplateWithItsOldVersionStopsTheBuild @S-A142-BAD-OLD-STARTER', () => {
        const changed = templatesIn(`${POSIX}# one more line\n`, WINDOWS);

        expect(starterVersionOf(`${POSIX}# one more line\n`, WINDOWS)).not.toBe(WORKER_STARTER_VERSION);
        expect(() => starterList(nodeFileSystem(changed), '.')).toThrow(SiteBuildError);
        expect(() => starterList(nodeFileSystem(changed), '.')).toThrow(/the starter files changed: their version is now [0-9a-f]{12}/);
        const windowsChanged = templatesIn(POSIX, WINDOWS.replace('$StarterVersion', '$Other'));
        expect(() => starterList(nodeFileSystem(windowsChanged), '.')).toThrow(SiteBuildError);
    });

    it('badPath_templatesWithNoVersionLineSayNone', () => {
        expect(writtenVersions('#!/bin/sh\n', '@echo off\n')).toEqual({ posix: '', windows: '' });
    });
});
