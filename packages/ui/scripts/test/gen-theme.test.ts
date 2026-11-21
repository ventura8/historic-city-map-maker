/**
 * End-to-end tests of `packages/ui/scripts/gen-theme.mjs`, run as a child process (the `tools` project of
 * vitest.config.ts: the ui project runs in Chromium, which cannot start processes). The colour logic itself is tested
 * in packages/ui/test/dynamic-color.test.ts.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { themeSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(ROOT, 'packages/ui/scripts/gen-theme.mjs');
const TIMEOUT = 30_000;

function run(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('packages/ui/scripts/gen-theme.mjs', () => {
    it(
        'happyPath_printsAManifestThemeForTheSeed',
        () => {
            const result = run('--seed', '#8B5E3C');

            expect(result.status).toBe(0);
            const theme = themeSchema.parse(JSON.parse(result.stdout));
            expect(theme.seedColor).toBe('#8B5E3C');
            expect(Object.keys(theme.tokens.light)).toHaveLength(53);
            expect(theme.tokens.dark['--md-sys-color-primary']).not.toBe(theme.tokens.light['--md-sys-color-primary']);
        },
        TIMEOUT,
    );

    it(
        'happyPath_writesTheThemeToAFile',
        () => {
            const directory = mkdtempSync(join(tmpdir(), 'hcm-theme-'));
            const out = join(directory, 'theme.json');
            try {
                const result = run('--seed', '#6750A4', '--out', out);

                expect(result.status).toBe(0);
                expect(themeSchema.parse(JSON.parse(readFileSync(out, 'utf8'))).seedColor).toBe('#6750A4');
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        },
        TIMEOUT,
    );

    it.each([[[]], [['--seed', 'brown']], [['--seed', '#12345']], [['--colour', '#8B5E3C']]])(
        'badPath_usage_%j',
        (args) => {
            const result = run(...args);

            expect(result.status).toBe(2);
            expect(result.stderr).toContain('usage: gen-theme.mjs');
        },
        TIMEOUT,
    );
});
