import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { outputChunks, STEP_NAMES, bundleSteps, stepEntry } from '../src/install/steps-bundle.js';
import { cleanup, ROOT, temporaryDir } from './support.js';

/**
 * The step scripts as the bundle carries them (docs/research/M6-interfaces.md §1.4): bundled by Vite with `@hcm/shared`
 * inlined, one entry per step, and runnable by a plain Node with no `node_modules` (as a Cloud Build step runs them).
 */

afterEach(cleanup);

function node(cwd: string, script: string, args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string }> {
    return new Promise((resolve) => {
        execFile(process.execPath, [script, ...args], { cwd, env: { PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error, stdout) => {
            resolve({ code: error === null ? 0 : Number(error.code ?? 1), stdout });
        });
    });
}

describe('bundleSteps', () => {
    it('happyPath_everyStepRunsFromTheBundleAloneAndRefusesABadArgument', async () => {
        const files = await bundleSteps(ROOT);
        const dir = temporaryDir();
        mkdirSync(join(dir, 'steps'));
        files.forEach((content, path) => {
            writeFileSync(join(dir, path), content);
        });

        expect(STEP_NAMES.every((name) => files.has(`steps/${name}.mjs`))).toBe(true);
        expect(new TextDecoder().decode(files.get('steps/steps.mjs'))).not.toMatch(/from ['"](zod|@hcm\/shared)['"]/);
        const verify = await node(dir, 'steps/verify-server.mjs', ['--project', 'demo-hcm']);
        expect(verify.code).toBe(1);
        expect(verify.stdout).toContain('verify-server: Error: usage: verify-server');
    }, 60_000);

    it('happyPath_anEntryRunsItsStep_badPath_aBuildWithoutChunksHasNone', () => {
        expect(stepEntry('run-jobs')).toContain("runStep('run-jobs', process.argv.slice(2))");
        expect(outputChunks({ output: [{ type: 'asset' }, { type: 'chunk', fileName: 'a.mjs' }] } as never)).toEqual([
            { type: 'chunk', fileName: 'a.mjs' },
        ]);
        expect(outputChunks([{ output: [] }] as never)).toEqual([]);
        expect(outputChunks({ close: () => undefined } as never)).toEqual([]);
    });
});
