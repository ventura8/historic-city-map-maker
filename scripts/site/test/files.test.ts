import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem } from '../src/files.js';
import { cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

describe('nodeFileSystem', () => {
    it('happyPath_writesReadsCopiesAndListsBelowItsRoot', () => {
        const files = nodeFileSystem(temporaryDir());

        files.write('a/b/text.txt', 'text');
        files.write('a/bytes.bin', new Uint8Array([1, 2, 3]));
        files.copy('a/b/text.txt', 'c/d/copy.txt');

        expect(files.readText('c/d/copy.txt')).toBe('text');
        expect([...files.readBytes('a/bytes.bin')]).toEqual([1, 2, 3]);
        expect(files.listFiles('a')).toEqual(['b/text.txt', 'bytes.bin']);
        expect(files.isFile('a/b/text.txt')).toBe(true);
    });

    it('badPath_foldersAndMissingPathsAreNotFiles', () => {
        const files = nodeFileSystem(temporaryDir());
        files.write('a/x.txt', 'x');

        expect(files.isFile('a')).toBe(false);
        expect(files.isFile('nothing/here')).toBe(false);
    });

    it('badPath_removingAMissingFolderIsFine', () => {
        const files = nodeFileSystem(temporaryDir());
        files.write('a/x.txt', 'x');

        files.remove('a');
        files.remove('never-there');

        expect(files.isFile('a/x.txt')).toBe(false);
    });
});
