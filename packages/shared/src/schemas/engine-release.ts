/**
 * Engine releases on jsDelivr (M5; `docs/research/M5-interfaces.md` §2): a tag `vX.Y.Z` (or a pre-release
 * `vX.Y.Z-beta.N` / `vX.Y.Z-rc.N`) of this repository carries the built engine in `cdn/engine/` (the files of
 * `packages/engine/dist` without source maps), which jsDelivr serves at
 * `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/cdn/engine/<file>`. The same folder holds `release.json`: the
 * version, the base address and the Subresource Integrity (`sha384-…`) of every file, which the GitHub Release
 * attaches and the starter kit's page pins. A page that pins the engine with integrity names an exact version: a
 * range such as `@1` can change under it, so it is offered only without integrity, and never for a pre-release (a
 * range never resolves to one, and a pre-release never moves the major line).
 */
import { z } from 'zod';

import { parseReleaseVersion, type PrereleaseChannel } from './compat.js';
import { coded, httpsUrlSchema, versionSchema } from './primitives.js';

/** The repository whose tags jsDelivr serves the engine from. */
export const ENGINE_REPOSITORY = 'ventura8/historic-city-map-maker';

/** The folder of a tag that holds the released engine (committed by the release, rebuilt identically by CI). */
export const ENGINE_CDN_FOLDER = 'cdn/engine';

/** jsDelivr's GitHub route. */
export const JSDELIVR_GH = 'https://cdn.jsdelivr.net/gh/';

/** The release file inside `ENGINE_CDN_FOLDER`. */
export const ENGINE_RELEASE_FILE = 'release.json';

/** The two files a page loads with integrity: the IIFE build (it carries the lazy chunks inline) and the stylesheet. */
export const ENGINE_PAGE_FILES = { script: 'engine.iife.js', stylesheet: 'engine.css' } as const;

/**
 * `vMAJOR.MINOR.PATCH`, or a pre-release `vMAJOR.MINOR.PATCH-beta.N` / `-rc.N` (N without leading zeros); no other
 * pre-release and no build suffix (`docs/releases/README.md`).
 */
const TAG_NUMBER = String.raw`(0|[1-9]\d*)`;
export const RELEASE_TAG_PATTERN = new RegExp(String.raw`^v${TAG_NUMBER}\.${TAG_NUMBER}\.${TAG_NUMBER}(?:-(beta|rc)\.${TAG_NUMBER})?$`);

/** A SHA-384 Subresource Integrity value: `sha384-` and 64 base64 characters. */
export const SRI_PATTERN = /^sha384-[A-Za-z0-9+/]{64}$/;

/** The npm dist-tag of a release: `latest` for a release, the channel (`beta`, `rc`) for a pre-release, never `latest`. */
export type ReleaseDistTag = 'latest' | PrereleaseChannel;

const REPOSITORY_PATTERN = /^[A-Za-z0-9-]{1,39}\/[\w.-]{1,100}$/;
const RELEASE_PATH_PATTERN = /^[A-Za-z0-9_-][\w.-]*(?:\/[A-Za-z0-9_-][\w.-]*)*$/;

function releaseParts(version: string): NonNullable<ReturnType<typeof parseReleaseVersion>> {
    const parts = parseReleaseVersion(version);
    if (parts === null) {
        throw new RangeError(`not a release version: ${JSON.stringify(version)}`);
    }
    return parts;
}

/** `1.0.0` → `v1.0.0`, `1.0.0-beta.1` → `v1.0.0-beta.1` (throws a `RangeError` for any other form). */
export function releaseTag(version: string): string {
    const parts = releaseParts(version);
    const pre = parts.prerelease === null ? '' : `-${parts.prerelease.channel}.${String(parts.prerelease.number)}`;
    return `v${parts.core.join('.')}${pre}`;
}

/** `v1.0.0` → `1.0.0`, `v1.0.0-rc.2` → `1.0.0-rc.2`, or null for anything that is not a release tag. */
export function versionOfTag(tag: string): string | null {
    return RELEASE_TAG_PATTERN.test(tag) ? tag.slice(1) : null;
}

/** Whether `version` is a pre-release (`-beta.N`, `-rc.N`); throws a `RangeError` for anything that is no release. */
export function isPrerelease(version: string): boolean {
    return releaseParts(version).prerelease !== null;
}

/** The npm dist-tag `version` is published under: `latest` for a release, `beta` or `rc` for a pre-release. */
export function releaseDistTag(version: string): ReleaseDistTag {
    return releaseParts(version).prerelease?.channel ?? 'latest';
}

/** The pinned folder of a release: `https://cdn.jsdelivr.net/gh/<repo>@v<version>/cdn/engine/` (the full version). */
export function engineCdnBase(version: string, repository: string = ENGINE_REPOSITORY): string {
    return `${JSDELIVR_GH}${repository}@${releaseTag(version)}/${ENGINE_CDN_FOLDER}/`;
}

/** The pinned address of one released file (`fonts/roboto-flex-latin-wght.woff2`); never `..`, never absolute. */
export function engineCdnUrl(version: string, file: string, repository: string = ENGINE_REPOSITORY): string {
    if (!RELEASE_PATH_PATTERN.test(file)) {
        throw new RangeError(`not a release file: ${JSON.stringify(file)}`);
    }
    return `${engineCdnBase(version, repository)}${file}`;
}

/**
 * The floating folder of a major line (`@1`): follows every 1.x release, so it is offered only without integrity. A
 * pre-release has none (a range never resolves to it, and it never moves the line): a `RangeError`.
 */
export function engineMajorBase(version: string, repository: string = ENGINE_REPOSITORY): string {
    const parts = releaseParts(version);
    if (parts.prerelease !== null) {
        throw new RangeError(`a pre-release has no major line: ${JSON.stringify(version)}`);
    }
    return `${JSDELIVR_GH}${repository}@${String(parts.core[0])}/${ENGINE_CDN_FOLDER}/`;
}

/** A release's version: `MAJOR.MINOR.PATCH` or a pre-release `-beta.N` / `-rc.N` of it. */
export const releaseVersionSchema = z.string().refine((value) => parseReleaseVersion(value) !== null, coded('validation.format'));

const subresourceSchema = z.strictObject({ url: httpsUrlSchema, integrity: z.string().regex(SRI_PATTERN) });

const releaseFileSchema = z.strictObject({
    path: z.string().max(200).regex(RELEASE_PATH_PATTERN),
    bytes: z.number().int().min(1),
    integrity: z.string().regex(SRI_PATTERN),
});

/**
 * `cdn/engine/release.json`, written by the release step from the built files and checked by the gates: `base` is the
 * pinned folder of `version`, every path is listed once (`release.json` itself never), and the page files are there.
 * `mapboxGl` names the Mapbox GL JS release the engine is written against and the integrity of its script and
 * stylesheet on api.mapbox.com, so a page can pin both from this one file.
 */
export const engineReleaseSchema = z
    .strictObject({
        version: releaseVersionSchema,
        repository: z.string().regex(REPOSITORY_PATTERN),
        base: httpsUrlSchema,
        mapboxGl: z.strictObject({ version: versionSchema, script: subresourceSchema, stylesheet: subresourceSchema }),
        files: z.array(releaseFileSchema).min(2).max(100),
    })
    .refine(
        (release) => parseReleaseVersion(release.version) !== null && release.base === engineCdnBase(release.version, release.repository),
        coded('validation.value', ['base']),
    )
    .refine(
        (release) => new Set(release.files.map((file) => file.path)).size === release.files.length,
        coded('validation.duplicateId', ['files']),
    )
    .refine(
        (release) => Object.values(ENGINE_PAGE_FILES).every((path) => release.files.some((file) => file.path === path)),
        coded('validation.required', ['files']),
    )
    .refine((release) => release.files.every((file) => file.path !== ENGINE_RELEASE_FILE), coded('validation.value', ['files']));

export type EngineRelease = z.infer<typeof engineReleaseSchema>;

/** The integrity `release` publishes for `path`, or undefined when it does not list the file. */
export function releaseIntegrity(release: Pick<EngineRelease, 'files'>, path: string): string | undefined {
    return release.files.find((file) => file.path === path)?.integrity;
}
