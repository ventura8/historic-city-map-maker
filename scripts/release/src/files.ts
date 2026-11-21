import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nodeFileSystem, type SiteFileSystem } from '../../site/src/files.js';

/**
 * The release scripts' file operations (`docs/research/M5-interfaces.md` §2): the site build's (`SiteFileSystem`, every
 * path relative to the repository) plus the folders of a workspace glob such as `packages/*`, so the logic is tested
 * against a temporary folder and never reaches outside the repository.
 */
export interface ReleaseFiles extends SiteFileSystem {
    /** The immediate subfolders of `dir`, by name, sorted; none when `dir` does not exist. */
    listDirs(dir: string): string[];
}

/** The real file system below `root`. */
export function nodeReleaseFiles(root: string): ReleaseFiles {
    return {
        ...nodeFileSystem(root),
        listDirs: (dir) => {
            const path = join(root, dir);
            if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
                return [];
            }
            return readdirSync(path, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => a.localeCompare(b));
        },
    };
}

/** A problem with the release's inputs (a manifest, the engine build, the release file): exit status 1. */
export class ReleaseError extends Error {
    override readonly name = 'ReleaseError';
}

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON object in `path`; a missing file, invalid JSON or anything but an object is a {@link ReleaseError}. */
export function readJsonObject(files: ReleaseFiles, path: string): JsonObject {
    if (!files.isFile(path)) {
        throw new ReleaseError(`${path} is missing`);
    }
    let value: unknown;
    try {
        value = JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new ReleaseError(`${path} is not valid JSON (${String(error)})`);
    }
    if (!isJsonObject(value)) {
        throw new ReleaseError(`${path} must hold a JSON object`);
    }
    return value;
}

/**
 * The text the repository's JSON files hold: four-space indentation and a final newline, which is what npm writes for
 * the manifests and the lockfile and what Prettier's `json-stringify` parser prints, so a rewrite changes values only.
 */
export function jsonText(value: unknown): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}
