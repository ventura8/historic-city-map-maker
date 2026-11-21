import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { splitPath, tarArchive, tgz, type TarEntry } from '../src/install/tar.js';
import { cleanup, temporaryDir } from './support.js';

/** The install bundle's tarballs (docs/research/M6-interfaces.md §1.3): ustar, sorted, dated once, the same bytes twice. */

/** The image's own `tar`. */
const TAR = '/usr/bin/tar';
const encoder = new TextEncoder();

function entry(path: string, text: string, executable = false): TarEntry {
    return { path, content: encoder.encode(text), executable };
}

afterEach(cleanup);

describe('tgz', () => {
    it('happyPath_tarReadsTheArchiveSortedWithItsContentModeAndTime', () => {
        const dir = temporaryDir();
        const file = join(dir, 'bundle.tgz');
        writeFileSync(file, tgz([entry('steps/run.mjs', 'run', true), entry('a.txt', 'alpha'), entry('steps/b.txt', '')], 1_700_000_000));

        const listing = execFileSync(TAR, ['-tzvf', file], { encoding: 'utf8' }).trim().split('\n');
        execFileSync(TAR, ['-xzf', file, '-C', dir]);

        expect(listing.map((line) => line.split(/\s+/).at(-1))).toEqual(['a.txt', 'steps/b.txt', 'steps/run.mjs']);
        expect(listing[2]).toMatch(/^-rwxr-xr-x 0\/0/);
        expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('alpha');
        expect(statSync(join(dir, 'a.txt')).mtimeMs).toBe(1_700_000_000_000);
    });

    it('happyPath_theSameEntriesInAnyOrderGiveTheSameBytes', () => {
        const entries = [entry('b', 'two'), entry('a', 'one')];

        expect(tgz(entries, 0)).toEqual(tgz([...entries].reverse(), 0));
        expect(tarArchive(entries, 0).length % 10_240).toBe(0);
    });

    it('happyPath_aLongPathIsSplitIntoPrefixAndName', () => {
        const long = `${'folder/'.repeat(20)}file.txt`;
        const dir = temporaryDir();
        const file = join(dir, 'long.tgz');
        writeFileSync(file, tgz([entry(long, 'deep')], 0));

        expect(splitPath(long).prefix.length).toBeLessThanOrEqual(155);
        expect(execFileSync(TAR, ['-tzf', file], { encoding: 'utf8' }).trim()).toBe(long);
    });

    it.each([
        ['an absolute path', '/etc/passwd'],
        ['a path climbing out', 'a/../../b'],
        ['an empty path', ''],
        ['a name too long for one entry', 'x'.repeat(120)],
        ['a prefix too long', `${'y'.repeat(200)}/file`],
    ])('badPath_%s is refused', (_name, path) => {
        expect(() => splitPath(path)).toThrow(RangeError);
    });

    it('badPath_theSamePathTwiceIsRefused', () => {
        expect(() => tgz([entry('a', '1'), entry('a', '2')], 0)).toThrow('the same path twice: a');
    });
});
