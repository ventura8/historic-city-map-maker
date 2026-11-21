import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * The file operations the site build needs, with every path relative to one root (the repository), so the build
 * logic can be tested against a temporary folder and never reaches outside it by accident.
 */
export interface SiteFileSystem {
    readText(path: string): string;
    readBytes(path: string): Uint8Array;
    isFile(path: string): boolean;
    /** Every file below `dir`, recursively, as `/`-separated paths relative to `dir`, sorted. */
    listFiles(dir: string): string[];
    /** Writes a file, creating its folders. */
    write(path: string, content: string | Uint8Array): void;
    /** Copies a file, creating the target's folders. */
    copy(from: string, to: string): void;
    /** Deletes a folder and everything in it; a missing folder is fine. */
    remove(dir: string): void;
}

function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

/** The real file system below `root`. */
export function nodeFileSystem(root: string): SiteFileSystem {
    const at = (path: string): string => join(root, path);
    return {
        readText: (path) => readFileSync(at(path), 'utf8'),
        readBytes: (path) => readFileSync(at(path)),
        isFile: (path) => statSync(at(path), { throwIfNoEntry: false })?.isFile() === true,
        listFiles: (dir) =>
            walk(at(dir))
                .map((path) => relative(at(dir), path).split('\\').join('/'))
                .sort((a, b) => a.localeCompare(b)),
        write: (path, content) => {
            mkdirSync(dirname(at(path)), { recursive: true });
            writeFileSync(at(path), content);
        },
        copy: (from, to) => {
            mkdirSync(dirname(at(to)), { recursive: true });
            copyFileSync(at(from), at(to));
        },
        remove: (dir) => {
            rmSync(at(dir), { recursive: true, force: true });
        },
    };
}
