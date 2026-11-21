/**
 * Manifest ↔ engine compatibility (docs/ENGINE_API.md → Versioning). Checked on the raw JSON before
 * the strict schema runs, so a manifest that uses fields of a newer engine gets the clear message
 * "this map needs engine X" instead of "unknown field".
 */
import { MANIFEST_VERSION } from './manifest.js';

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;
/** `major.minor.patch` and, for a pre-release, `-beta.N` or `-rc.N` (`docs/releases/README.md`); nothing else. */
const RELEASE_VERSION = /^(\d{1,4}\.\d{1,4}\.\d{1,6})(?:-(beta|rc)\.(0|[1-9]\d{0,5}))?$/;

/** The pre-release channels a release may carry, in SemVer order: a beta comes before a release candidate. */
export const PRERELEASE_CHANNELS = ['beta', 'rc'] as const;
export type PrereleaseChannel = (typeof PRERELEASE_CHANNELS)[number];

/** A version split into its three numbers and, for a pre-release, its channel and number. */
export interface ReleaseVersionParts {
    readonly core: readonly [number, number, number];
    readonly prerelease: { readonly channel: PrereleaseChannel; readonly number: number } | null;
}

/** The three numbers of `major.minor.patch`, or null for anything else. */
export function parseVersion(version: string): readonly [number, number, number] | null {
    const match = VERSION.exec(version);
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `1.0.0` or `1.0.0-beta.1` / `1.0.0-rc.2` split into its parts, or null for anything else. */
export function parseReleaseVersion(version: string): ReleaseVersionParts | null {
    const match = RELEASE_VERSION.exec(version);
    const core = match === null ? null : parseVersion(String(match[1]));
    if (match === null || core === null) {
        return null;
    }
    const channel = match[2] as PrereleaseChannel | undefined;
    return { core, prerelease: channel === undefined ? null : { channel, number: Number(match[3]) } };
}

/** A pre-release's place after its core: every beta, then every rc, then the release itself. */
function prereleaseRank(parts: ReleaseVersionParts): readonly [number, number] {
    const pre = parts.prerelease;
    return pre === null ? [PRERELEASE_CHANNELS.length, 0] : [PRERELEASE_CHANNELS.indexOf(pre.channel), pre.number];
}

/**
 * Negative when `a` is older than `b`, 0 when equal, positive when newer, in SemVer order (`1.0.0-beta.1` <
 * `1.0.0-rc.1` < `1.0.0`); null if either is not `x.y.z` or `x.y.z-beta.N` / `x.y.z-rc.N`.
 */
export function compareVersions(a: string, b: string): number | null {
    const left = parseReleaseVersion(a);
    const right = parseReleaseVersion(b);
    if (left === null || right === null) {
        return null;
    }
    const l = [...left.core, ...prereleaseRank(left)];
    const r = [...right.core, ...prereleaseRank(right)];
    return l.map((part, index) => part - Number(r[index])).find((difference) => difference !== 0) ?? 0;
}

export type ManifestCompat =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'error.manifest.version' }
    | { readonly ok: false; readonly code: 'error.manifest.engineTooOld'; readonly minVersion: string };

function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, key)
        ? (value as Readonly<Record<string, unknown>>)[key]
        : undefined;
}

/**
 * Whether an engine of `engineVersion` may read `input`: its `version` must be `MANIFEST_VERSION`, and
 * `city.engine.minVersion`, when it is a valid version, must not be newer than the engine. Anything
 * else malformed is left to the schema.
 */
export function checkManifestCompat(input: unknown, engineVersion: string): ManifestCompat {
    if (field(input, 'version') !== MANIFEST_VERSION) {
        return { ok: false, code: 'error.manifest.version' };
    }
    const minVersion = field(field(field(input, 'city'), 'engine'), 'minVersion');
    if (typeof minVersion !== 'string') {
        return { ok: true };
    }
    const order = compareVersions(minVersion, engineVersion);
    return order !== null && order > 0 ? { ok: false, code: 'error.manifest.engineTooOld', minVersion } : { ok: true };
}
