import {
    ENGINE_CDN_FOLDER,
    ENGINE_PAGE_FILES,
    ENGINE_RELEASE_FILE,
    ENGINE_REPOSITORY,
    engineCdnBase,
    engineReleaseSchema,
    validate,
    type EngineRelease,
} from '@hcm/shared';

import { issuesText } from '../../site/src/errors.js';
import { MAPBOX_GL_SCRIPT, MAPBOX_GL_STYLESHEET, MAPBOX_GL_VERSION } from '../../site/src/page.js';
import { subresourceIntegrity } from '../../site/src/sri.js';
import { ReleaseError, jsonText, readJsonObject, type ReleaseFiles } from './files.js';

/**
 * The engine in the tree (`docs/research/M5-interfaces.md` §2.3): jsDelivr's GitHub route serves only what a tag holds,
 * and `dist/` is ignored, so the release commit carries the built engine in `cdn/engine/`: every file of
 * `packages/engine/dist` but the source maps (the GitHub Release attaches those), each file's last
 * `//# sourceMappingURL=` line removed, lit-html's whitespace class written with escapes and every text file ending in a
 * newline (`.editorconfig`), with `release.json`
 * (`engineReleaseSchema`): the version, the pinned jsDelivr folder, Mapbox GL JS's integrity (from the pinned npm
 * release, as the site build computes it) and the size and SHA-384 integrity of every file. The `release-cdn` gate
 * rebuilds the folder from a fresh build and requires it byte for byte (`npm run release:cdn -- --check`).
 */

const ENGINE_DIST = 'packages/engine/dist';
export const CDN_ENGINE = ENGINE_CDN_FOLDER;
export const RELEASE_JSON = `${ENGINE_CDN_FOLDER}/${ENGINE_RELEASE_FILE}`;
const MAPBOX_GL_DIST = 'node_modules/mapbox-gl/dist';

const SOURCE_MAP = '.map';
const TEXT_SUFFIXES = ['.js', '.mjs', '.css', '.txt', '.md', '.json'];
/** The last line of a built file that names its source map: `//# sourceMappingURL=…` or `/*# sourceMappingURL=… *\/`. */
const SOURCE_MAP_LINE = /\n(?:\/\/# sourceMappingURL=[^\n]*|\/\*# sourceMappingURL=[^\n]*\*\/)\n?$/;
/**
 * lit-html's whitespace class `[ \t\n\f\r]` as the minifier writes it: an untagged template literal holding a real tab
 * and a real line break, so the line ends in a space and a tab (trailing whitespace for `.editorconfig`). Written back
 * with escapes, the literal's value is the same string, byte for byte (`docs/research/DECISIONS-for-review.md` §160).
 */
const LIT_WHITESPACE_RAW = '`[ \t\n\\f\\r]`';
const LIT_WHITESPACE_ESCAPED = '`[ \\t\\n\\f\\r]`';
const SCRIPT_SUFFIXES = ['.js', '.mjs'];
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

/** A file of the release folder, as its path below `cdn/engine/` and its bytes. */
export interface ReleasedFile {
    readonly path: string;
    readonly content: Uint8Array;
}

/** Code-point order, so `release.json` lists the files the same way on every machine (no locale involved). */
function byPath(a: ReleasedFile, b: ReleasedFile): number {
    return a.path < b.path ? -1 : Number(a.path > b.path);
}

function isText(path: string): boolean {
    return TEXT_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** A built file as the release carries it: the source-map line gone and a final newline; binary files unchanged. */
export function releasedBytes(path: string, content: Uint8Array): Uint8Array {
    if (!isText(path)) {
        return content;
    }
    const decoded = decoder.decode(content).replace(SOURCE_MAP_LINE, '\n');
    const script = SCRIPT_SUFFIXES.some((suffix) => path.endsWith(suffix));
    const text = script ? decoded.replaceAll(LIT_WHITESPACE_RAW, LIT_WHITESPACE_ESCAPED) : decoded;
    return encoder.encode(text === '' || text.endsWith('\n') ? text : `${text}\n`);
}

/** Every file of the engine build but the source maps, transformed; the build must have run. */
export function releasedFiles(files: ReleaseFiles): ReleasedFile[] {
    if (!files.isFile(`${ENGINE_DIST}/${ENGINE_PAGE_FILES.script}`)) {
        throw new ReleaseError(
            `${ENGINE_DIST} has no ${ENGINE_PAGE_FILES.script}: build the engine first (npm run build --workspace @hcm/engine)`,
        );
    }
    return files
        .listFiles(ENGINE_DIST)
        .filter((path) => !path.endsWith(SOURCE_MAP))
        .map((path) => ({ path, content: releasedBytes(path, files.readBytes(`${ENGINE_DIST}/${path}`)) }))
        .sort(byPath);
}

/** Mapbox GL JS on api.mapbox.com with the integrity of the pinned npm release the repository installs. */
export function mapboxGlRelease(files: ReleaseFiles): EngineRelease['mapboxGl'] {
    const installed = readJsonObject(files, 'node_modules/mapbox-gl/package.json')['version'];
    if (installed !== MAPBOX_GL_VERSION) {
        throw new ReleaseError(
            `node_modules/mapbox-gl is ${String(installed)}, the engine is written against ${MAPBOX_GL_VERSION}: run npm ci`,
        );
    }
    const integrity = (file: string): string => subresourceIntegrity(files.readBytes(`${MAPBOX_GL_DIST}/${file}`));
    return {
        version: MAPBOX_GL_VERSION,
        script: { url: MAPBOX_GL_SCRIPT, integrity: integrity('mapbox-gl.js') },
        stylesheet: { url: MAPBOX_GL_STYLESHEET, integrity: integrity('mapbox-gl.css') },
    };
}

/** `release.json` for `released` at `version`, validated by `engineReleaseSchema`. */
export function engineReleaseOf(version: string, released: readonly ReleasedFile[], mapboxGl: EngineRelease['mapboxGl']): EngineRelease {
    const release: EngineRelease = {
        version,
        repository: ENGINE_REPOSITORY,
        base: engineCdnBase(version),
        mapboxGl,
        files: released.map((file) => ({ path: file.path, bytes: file.content.byteLength, integrity: subresourceIntegrity(file.content) })),
    };
    const result = validate(engineReleaseSchema, release);
    if (!result.ok) {
        throw new ReleaseError(`the release file would be invalid:\n${issuesText(result.issues)}`);
    }
    return release;
}

/** The version every package of the repository carries (the bump writes it first). */
export function repositoryVersion(files: ReleaseFiles): string {
    const version = readJsonObject(files, 'package.json')['version'];
    if (typeof version !== 'string') {
        throw new ReleaseError('package.json has no version');
    }
    return version;
}

/** The whole release folder for the repository's version: the built files, then `release.json`. */
export function releaseFolder(files: ReleaseFiles): { readonly release: EngineRelease; readonly files: ReleasedFile[] } {
    const released = releasedFiles(files);
    const release = engineReleaseOf(repositoryVersion(files), released, mapboxGlRelease(files));
    return { release, files: [...released, { path: ENGINE_RELEASE_FILE, content: encoder.encode(jsonText(release)) }] };
}

/** Replaces `cdn/engine/` with the release folder (never adds to it: the tree holds one release at a time). */
export function writeReleaseFolder(files: ReleaseFiles): EngineRelease {
    const folder = releaseFolder(files);
    files.remove(CDN_ENGINE);
    for (const file of folder.files) {
        files.write(`${CDN_ENGINE}/${file.path}`, file.content);
    }
    return folder.release;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

function differences(files: ReleaseFiles, expected: readonly ReleasedFile[]): string[] {
    const committed = new Set(files.listFiles(CDN_ENGINE));
    const wanted = new Set(expected.map((file) => file.path));
    const extra = [...committed].filter((path) => !wanted.has(path)).map((path) => `${CDN_ENGINE}/${path}: not part of the build`);
    const changed = expected.flatMap((file) => {
        const path = `${CDN_ENGINE}/${file.path}`;
        if (!committed.has(file.path)) {
            return [`${path}: missing`];
        }
        const bytes = files.readBytes(path);
        return sameBytes(bytes, file.content)
            ? []
            : [`${path}: differs from a fresh build (${String(bytes.byteLength)} bytes, expected ${String(file.content.byteLength)})`];
    });
    return [...changed, ...extra];
}

/** What keeps the committed `cdn/engine/` from being exactly the release folder of a fresh build (empty when it is). */
export function releaseFolderProblems(files: ReleaseFiles): { readonly release: EngineRelease; readonly problems: string[] } {
    const folder = releaseFolder(files);
    if (!files.isFile(RELEASE_JSON)) {
        return { release: folder.release, problems: [`${RELEASE_JSON} is missing: run npm run release:cdn on the release commit`] };
    }
    return { release: folder.release, problems: differences(files, folder.files) };
}
