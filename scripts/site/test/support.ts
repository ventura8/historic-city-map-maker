import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLogger, type LogRecord, type Logger } from '@hcm/shared';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';

/** The repository root (scripts/site/test → ../../..). */
export const ROOT = resolve(import.meta.dirname, '../../..');

/** A fresh temporary folder; `cleanup()` deletes every folder made so far. */
const made: string[] = [];

export function temporaryDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hcm-site-'));
    made.push(dir);
    return dir;
}

export function cleanup(): void {
    for (const dir of made.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * The repository's files for reading, with `dist/` redirected to a temporary folder: a test builds the committed sites
 * from their real inputs without touching the repository's own build output.
 */
export function repositoryWithTemporaryDist(): { files: SiteFileSystem; dist: SiteFileSystem; distRoot: string } {
    const distRoot = temporaryDir();
    const repository = nodeFileSystem(ROOT);
    const dist = nodeFileSystem(distRoot);
    const pick = (path: string): SiteFileSystem => (path.startsWith('dist/') ? dist : repository);
    const files: SiteFileSystem = {
        readText: (path) => pick(path).readText(path),
        readBytes: (path) => pick(path).readBytes(path),
        isFile: (path) => pick(path).isFile(path),
        listFiles: (dir) => pick(dir).listFiles(dir),
        write: (path, content) => {
            pick(path).write(path, content);
        },
        copy: (from, to) => {
            pick(to).write(to, pick(from).readBytes(from));
        },
        remove: (dir) => {
            pick(dir).remove(dir);
        },
    };
    return { files, dist, distRoot };
}

/** A logger whose records the test reads. */
export function recordingLogger(): { log: Logger; records: LogRecord[] } {
    const records: LogRecord[] = [];
    return {
        log: createLogger('site-test', {
            sink: (record) => {
                records.push(record);
            },
            minLevel: 'debug',
        }),
        records,
    };
}

/** Every html-validate message for `html`, judged by the repository's own `.htmlvalidate.json` (the gate's rules). */
export async function htmlValidateMessages(html: string, path = 'dist/site/bucharest/index.html'): Promise<string[]> {
    const validator = new HtmlValidate(new FileSystemConfigLoader());
    const report = await validator.validateString(html, join(ROOT, path));
    return report.results.flatMap((result) => result.messages.map((message) => `${message.ruleId}: ${message.message}`));
}
