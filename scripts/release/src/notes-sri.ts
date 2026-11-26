import {
    ENGINE_PAGE_FILES,
    ENGINE_RELEASE_FILE,
    engineCdnUrl,
    engineMajorBase,
    engineReleaseSchema,
    isPrerelease,
    releaseIntegrity,
    validate,
    type EngineRelease,
} from '@hcm/shared';

import { issuesText } from '../../site/src/errors.js';
import { ReleaseError, readJsonObject, type ReleaseFiles } from './files.js';

/**
 * The pinned addresses of a release and their integrity, for city owners (`docs/research/M5-interfaces.md` §2.5): a
 * table and the four tags to paste, written between `<!-- hcm:sri -->` and `<!-- /hcm:sri -->` of
 * `docs/releases/vX.Y.Z_github_description.md` (`npm run release:notes -- --write <file>`), and into the release
 * workflow's job summary by the `release-cdn` gate. `scripts/ci/check_release.py` requires the description's values to
 * be exactly `release.json`'s.
 */

export const SRI_BLOCK_START = '<!-- hcm:sri -->';
export const SRI_BLOCK_END = '<!-- /hcm:sri -->';

/** One subresource a pinned page loads with integrity. */
export interface PinnedSubresource {
    readonly label: string;
    readonly kind: 'script' | 'stylesheet';
    readonly url: string;
    readonly integrity: string;
}

function engineFile(release: EngineRelease, label: string, kind: PinnedSubresource['kind'], path: string): PinnedSubresource {
    const integrity = releaseIntegrity(release, path);
    if (integrity === undefined) {
        throw new ReleaseError(`the release file does not list ${path}`);
    }
    return { label, kind, url: engineCdnUrl(release.version, path, release.repository), integrity };
}

/** What a pinned page loads, in page order: Mapbox GL JS's stylesheet and script, then the engine's. */
export function pinnedSubresources(release: EngineRelease): PinnedSubresource[] {
    return [
        { label: 'Mapbox GL JS stylesheet', kind: 'stylesheet', ...release.mapboxGl.stylesheet },
        { label: 'Mapbox GL JS script', kind: 'script', ...release.mapboxGl.script },
        engineFile(release, 'Engine stylesheet', 'stylesheet', ENGINE_PAGE_FILES.stylesheet),
        engineFile(release, 'Engine script', 'script', ENGINE_PAGE_FILES.script),
    ];
}

function tag(resource: PinnedSubresource): string {
    const pin = `integrity="${resource.integrity}" crossorigin="anonymous"`;
    return resource.kind === 'script'
        ? `<script src="${resource.url}" ${pin} defer></script>`
        : `<link rel="stylesheet" href="${resource.url}" ${pin} />`;
}

/**
 * The major line a page may follow without integrity (`@1`), or for a pre-release the sentence that it has none: a
 * range never resolves to a pre-release, and a pre-release never moves the line.
 */
function majorLine(release: EngineRelease): string {
    if (isPrerelease(release.version)) {
        return 'A pre-release is served only at its exact version: no major line (such as `@1`) resolves to it.';
    }
    return `The ${String(release.version.split('.')[0])}.x line without integrity, for a page that follows every compatible release: \`${engineMajorBase(release.version, release.repository)}\`.`;
}

/** The Markdown block between the markers (markers included): the table, the floating folder, the tags to paste. */
export function sriBlock(release: EngineRelease): string {
    const resources = pinnedSubresources(release);
    return [
        SRI_BLOCK_START,
        '',
        '| File | Address | Integrity |',
        '| --- | --- | --- |',
        ...resources.map((resource) => `| ${resource.label} | \`${resource.url}\` | \`${resource.integrity}\` |`),
        '',
        `Every file of the release with its size and integrity: \`${engineCdnUrl(release.version, ENGINE_RELEASE_FILE, release.repository)}\`.`,
        majorLine(release),
        '',
        '```html',
        ...resources.map(tag),
        '```',
        '',
        SRI_BLOCK_END,
    ].join('\n');
}

function markerIndex(markdown: string, marker: string): number {
    const first = markdown.indexOf(marker);
    if (first === -1 || markdown.includes(marker, first + marker.length)) {
        throw new ReleaseError(`the notes must hold the line ${marker} exactly once`);
    }
    return first;
}

/** `markdown` with the block between the markers replaced by {@link sriBlock}; the markers must appear once, in order. */
export function withSriBlock(markdown: string, release: EngineRelease): string {
    const start = markerIndex(markdown, SRI_BLOCK_START);
    const end = markerIndex(markdown, SRI_BLOCK_END);
    if (end < start) {
        throw new ReleaseError(`${SRI_BLOCK_END} comes before ${SRI_BLOCK_START}`);
    }
    return `${markdown.slice(0, start)}${sriBlock(release)}${markdown.slice(end + SRI_BLOCK_END.length)}`;
}

/** The committed `release.json`, validated. */
export function readRelease(files: ReleaseFiles, path: string): EngineRelease {
    const result = validate(engineReleaseSchema, readJsonObject(files, path));
    if (!result.ok) {
        throw new ReleaseError(`${path} is not a valid release file:\n${issuesText(result.issues)}`);
    }
    return result.value;
}
