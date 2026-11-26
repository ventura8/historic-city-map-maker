/**
 * The in-app installer (M6; `docs/research/M6-interfaces.md` §1): the admin installs the map's server, its imagery
 * pipeline and the public site by submitting Google Cloud Build builds with the owner's consent. The site build makes
 * a versioned **install bundle** from the same commit as the admin, served by Hosting next to it at
 * `/admin/install/<slug>/`: `manifest.json` ({@link installManifestSchema}) and one tarball per target, each checked
 * by SHA-256 before a build uses it. The build's step scripts print `HCM_INSTALL {json}` lines
 * ({@link installLogEventSchema}) the admin reads back from the build's log. What each target's card shows is an
 * {@link InstallState}; after the claim `setup/status.install` keeps it ({@link setupInstallSchema}) so Home can say
 * an update is ready without a Google token.
 */
import { z } from 'zod';

import { compareVersions } from './compat.js';
import { coded } from './primitives.js';

/** The bundle's format; an admin refuses a manifest of another one (`apiError.install.bundleFormat`). */
export const INSTALL_FORMAT = 1;

/** What the installer installs, in the order Update the map runs them (the site after the server). */
export const INSTALL_TARGETS = ['server', 'pipeline', 'site'] as const;

export type InstallTarget = (typeof INSTALL_TARGETS)[number];

/** Each target's tarball in the bundle folder. */
export const INSTALL_BUNDLE_FILES = {
    server: 'server.tgz',
    pipeline: 'pipeline.tgz',
    site: 'hosting.tgz',
} as const satisfies Readonly<Record<InstallTarget, string>>;

/**
 * §73k (the user's decision of 2026-11-01): the old photos' originals (`admin/legacy/<city>/originals/`, about 45 MB),
 * which step (h) imports, travel in a tarball of their own beside `hosting.tgz`. A site build fetches and unpacks it only
 * while the legacy import is not complete, so a publish after the import moves a few MB of Hosting's free transfer.
 */
export const LEGACY_BUNDLE_FILE = 'legacy.tgz';

/** The bundle's own description, next to the tarballs. */
export const INSTALL_MANIFEST_FILE = 'manifest.json';

/** The bundle's folder below the admin's base path (`/admin/install/<slug>/` on Hosting). */
export const INSTALL_FOLDER = 'install';

/**
 * Each target's build steps in order: their `id`s in the build definition and on the card. The server's `packages`
 * installs the functions' locked dependencies into their source folder, which `firebase-tools` loads to discover what to
 * deploy (finding 30 of 2026-10-31).
 */
export const INSTALL_STEPS = {
    server: ['fetch', 'tools', 'packages', 'rules', 'functions', 'verify'],
    pipeline: ['fetch', 'build', 'push', 'jobs'],
    site: ['fetch', 'tools', 'hosting', 'config'],
} as const satisfies Readonly<Record<InstallTarget, readonly string[]>>;

export type InstallStepId = (typeof INSTALL_STEPS)[InstallTarget][number];

/** Every step id of every target, once. */
export const INSTALL_STEP_IDS: readonly InstallStepId[] = [...new Set(INSTALL_TARGETS.flatMap((target) => INSTALL_STEPS[target]))];

/** What a target's card shows (`docs/research/M6-interfaces.md` §1.7). */
export const INSTALL_STATES = [
    'notInstalled',
    'queued',
    'working',
    'retrying',
    'installed',
    'updateAvailable',
    'newerInstalled',
    'failed',
    'unavailable',
] as const;

export type InstallState = (typeof INSTALL_STATES)[number];

/** The states of a build that runs: the card follows it, and a click never submits a second one. */
export const INSTALL_RUNNING_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['queued', 'working', 'retrying']);

/** The installer's service account (`<id>@<project>.iam.gserviceaccount.com`), created by Prepare the project. */
export const INSTALLER_ACCOUNT = 'hcm-installer';

/** The Artifact Registry repository (Docker, `us-central1`) the imagery pipeline's image is pushed to. */
export const PIPELINE_REPOSITORY = 'hcm';

/** `<region>-docker.pkg.dev/<project>/hcm/pipeline@sha256:<64 hex>`: the pipeline image by digest, as its jobs run it. */
const PIPELINE_IMAGE_BY_DIGEST = /^[a-z0-9-]{1,40}-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/hcm\/pipeline@(sha256:[0-9a-f]{64})$/;

/**
 * Finding 74 of 2026-11-03: the digest (`sha256:<64 hex>`) of the pipeline image a Cloud Run job of the pipeline runs
 * (`template.template.containers[0].image`), the truth of what is installed; null for any other image name.
 */
export function pipelineImageDigest(image: string): string | null {
    return PIPELINE_IMAGE_BY_DIGEST.exec(image)?.[1] ?? null;
}

/** The `firebase-tools` the server and site builds install from the bundle's lock (the repository's own pin). */
export const FIREBASE_TOOLS_VERSION = '15.36.0';

/**
 * Google's Docker builder of the imagery pipeline's build, as the deps gate tracks it: its version tag and the digest of
 * that tag's manifest list (linux/amd64 and linux/arm64), read from gcr.io on 2026-11-01 (`DECISIONS-for-review.md`
 * §67e, the user's decision). `29` is the builder's current line; the older lines (`20.10.24`, which `latest` still
 * names, and `24.0.9`) carry Google's `no-new-use-public-image` marker. `scripts/ci/check_dependency_updates.py` reads
 * this line and compares the tag with gcr.io's.
 */
export const DOCKER_BUILDER_PIN = 'gcr.io/cloud-builders/docker:29@sha256:6a6635024a23c8ed596c26fefc744bd3c5dbe269e8d8d541f2fda2beb0664ea5';

/** The same builder as the install bundle's `tools.docker` names it: by digest alone (a test keeps the two equal). */
export const DOCKER_BUILDER_IMAGE = 'gcr.io/cloud-builders/docker@sha256:6a6635024a23c8ed596c26fefc744bd3c5dbe269e8d8d541f2fda2beb0664ea5';

/** The prefix of a step script's machine-readable log line (`HCM_INSTALL {"event":"retry",…}`). */
export const HCM_INSTALL_LOG_PREFIX = 'HCM_INSTALL ';

/** Cloud Build's free build minutes a month on `e2-standard-2` (UNVERIFIED until the first install, §1.9). */
export const CLOUD_BUILD_FREE_MINUTES = 2500;

/** What an install of each target costs (UNVERIFIED: the first real install's measured minutes replace them, §1.9). */
export const INSTALL_ESTIMATES: Readonly<Record<InstallTarget, { readonly buildMinutes: number }>> = {
    server: { buildMinutes: 85 },
    pipeline: { buildMinutes: 20 },
    site: { buildMinutes: 5 },
};

/**
 * What one Publish the map moves out of Firebase Hosting, in MB (§1.9; finding 4 of the M6 security review): the site
 * build downloads the bundle's tarballs (`hosting.tgz`, `server.tgz`, `pipeline.tgz`) and its manifest from the admin's
 * own Hosting, whose free tier is 360 MB a day, and while the legacy import is not complete also `legacy.tgz`, the old
 * photos' originals (§73k). Measured on 2026-11-01: about 7 MB without the originals, 52 MB with them; since 2026-11-08 the
 * originals of the old site's 2023 additions add about 7.4 MB (`seed/bucharest-2023/`, `docs/research/M5-interfaces.md`),
 * so 60. UNVERIFIED like the minutes: the bundle budget (`scripts/ci/check_bundle_budget.py`) caps each tarball.
 */
export const SITE_PUBLISH_TRANSFER_MB = 60;
/** The same once the legacy import is complete: the build leaves `legacy.tgz` out (§73k). */
export const SITE_PUBLISH_TRANSFER_TRIMMED_MB = 7;

/**
 * The first-deploy races the server build retries by itself (`deploy-with-retry`, §1.5), recognised in
 * `firebase-tools`' output; any other failure fails the step at once. Each pattern is linear (no nested quantifier).
 */
export const TRANSIENT_DEPLOY_PATTERNS = [
    { id: 'eventarcAgent', pattern: /Permission denied while using the Eventarc Service Agent/i },
    { id: 'quota', pattern: /\b(?:429|RESOURCE_EXHAUSTED)\b|Quota exceeded/i },
    { id: 'operationInProgress', pattern: /\b409\b|operation is already in progress|another operation is in progress/i },
    { id: 'unavailable', pattern: /\b(?:503|UNAVAILABLE)\b|Service Unavailable/i },
] as const;

export type TransientDeployReason = (typeof TRANSIENT_DEPLOY_PATTERNS)[number]['id'];

const TRANSIENT_REASONS = TRANSIENT_DEPLOY_PATTERNS.map((entry) => entry.id) as [TransientDeployReason, ...TransientDeployReason[]];

/** The race `output` shows, or null when it shows none (the step then fails at once). */
export function transientDeployReason(output: string): TransientDeployReason | null {
    return TRANSIENT_DEPLOY_PATTERNS.find((entry) => entry.pattern.test(output))?.id ?? null;
}

/**
 * `<major>.<minor>.<patch>`, for a pre-release `-beta.N` or `-rc.N`, and, after `+`, the build's short commit
 * (`1.0.0+abc1234`, `1.0.0-beta.1+abc1234`); a build outside git has none.
 */
export const RELEASE_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-(?:beta|rc)\.(?:0|[1-9]\d{0,5}))?(?:\+[0-9a-z]{1,40})?$/;

/** A Cloud Build tag, a path segment and a Cloud Run label value at once: lowercase letters, digits and hyphens. */
export const INSTALL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,200}(?::[\w.-]{1,128})?@sha256:[0-9a-f]{64}$/;
/** A deployed function's name (`admin-session`, `setup-recordCloud`: the registry's `deployedName`). */
const FUNCTION_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/;
const BUILD_ID_PATTERN = /^[0-9a-f-]{8,64}$/;
export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** The most a bundle file may weigh (the Hosting tree carries the 46 MB of legacy originals, §1.3). */
const MAX_BUNDLE_FILE_BYTES = 200 * 1024 * 1024;
const MAX_FUNCTIONS = 200;

export const releaseSchema = z.string().regex(RELEASE_PATTERN, coded('validation.format'));
export const installSlugSchema = z.string().regex(INSTALL_SLUG_PATTERN, coded('validation.format'));
export const sha256HexSchema = z.string().regex(SHA256_PATTERN, coded('validation.format'));
export const installBuildIdSchema = z.string().regex(BUILD_ID_PATTERN, coded('validation.format'));

/** The most a slug may hold: a Cloud Run label value. */
const MAX_SLUG_LENGTH = 63;

/** `text` without hyphens at either end (a loop: an anchored `-+$` would backtrack over a long run of hyphens). */
function trimHyphens(text: string): string {
    let start = 0;
    let end = text.length;
    while (start < end && text[start] === '-') {
        start += 1;
    }
    while (end > start && text[end - 1] === '-') {
        end -= 1;
    }
    return text.slice(start, end);
}

/** `1.0.0+abc1234` → `1-0-0-abc1234`: safe in a path, a Cloud Build tag and a Cloud Run label. */
export function installReleaseSlug(release: string): string {
    const slug = trimHyphens(trimHyphens(release.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, MAX_SLUG_LENGTH));
    return slug === '' ? 'release' : slug;
}

/** A release slug's parts: the three numbers, a pre-release's channel and number, and the build's commit. */
const SLUG_PATTERN = /^(\d{1,4})-(\d{1,4})-(\d{1,6})(?:-(beta|rc)-(0|[1-9]\d{0,5}))?(?:-([0-9a-z]{1,40}))?$/;

/**
 * A slug of a release back to the release: `1-0-0-abc1234` → `1.0.0+abc1234`, `1-0-0-beta-1-abc1234` →
 * `1.0.0-beta.1+abc1234` (the live finding of 2026-11-12: a pre-release's slug read as none, so its pipeline jobs named no
 * release), `1-0-0-rc-2` → `1.0.0-rc.2`; null for any other slug.
 */
export function releaseOfSlug(slug: string): string | null {
    const match = SLUG_PATTERN.exec(slug);
    if (match === null) {
        return null;
    }
    const [, major, minor, patch, channel, number, build] = match;
    const pre = channel === undefined ? '' : `-${channel}.${String(number)}`;
    const version = `${String(major)}.${String(minor)}.${String(patch)}${pre}`;
    return build === undefined ? version : `${version}+${build}`;
}

interface ParsedRelease {
    readonly version: string;
    readonly build: string;
}

function parseRelease(release: string): ParsedRelease | null {
    if (!RELEASE_PATTERN.test(release)) {
        return null;
    }
    const plus = release.indexOf('+');
    return plus === -1 ? { version: release, build: '' } : { version: release.slice(0, plus), build: release.slice(plus + 1) };
}

/** The latest a release's build time may be: 2100-01-01, in seconds since 1970. */
const MAX_RELEASE_TIME = 4_102_444_800;

/**
 * A release's build time (live manual test 2026-11-01, finding 39): the time of the commit it was built from, in whole
 * seconds since 1970 (`git log -1 --format=%ct`, or `SOURCE_DATE_EPOCH`). Every release of a version shares its semver
 * (build metadata has no precedence), so the time is what orders two builds of one version.
 */
export const releaseTimeSchema = z.number().int().min(0).max(MAX_RELEASE_TIME);

/** A build time written as text (an environment variable, a Cloud Run label, a substitution), or null when it is none. */
export function parseReleaseTime(value: unknown): number | null {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || !/^\d{1,10}$/.test(text)) {
        return null;
    }
    const parsed = releaseTimeSchema.safeParse(Number(text));
    return parsed.success ? parsed.data : null;
}

/** The build times of the two releases `compareRelease` orders; null when one is not known. */
export interface ReleaseTimes {
    readonly installed: number | null;
    readonly bundle: number | null;
}

const UNKNOWN_TIMES: ReleaseTimes = { installed: null, bundle: null };

/**
 * What a release is (the live finding of 2026-11-12, `docs/research/M6-interfaces.md` §1.7.1): a build of a commit that
 * carries the version's tag `v<version>` names the version alone (`1.0.0`, `1.0.0-beta.1`): a `release` or a
 * `prerelease`; every other build, untagged, names its commit after `+` (`1.0.0+dcfb067`): a `dev` build. A release
 * from before the channels (the live server `1.0.0+dcfb067`, built when no tag existed) reads the same way, so no field
 * has to travel with it: the functions' `HCM_RELEASE`, the jobs' label, the site's `release.json` and the records all
 * carry the channel in the release itself. A build outside a git checkout names the version alone too.
 */
export const RELEASE_CHANNELS = ['release', 'prerelease', 'dev'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
export const releaseChannelSchema = z.enum(RELEASE_CHANNELS);

/** The channel `release` names (`RELEASE_CHANNELS`), or null for a release that does not parse. */
export function releaseChannel(release: string): ReleaseChannel | null {
    const parsed = parseRelease(release);
    if (parsed === null) {
        return null;
    }
    if (parsed.build !== '') {
        return 'dev';
    }
    return parsed.version.includes('-') ? 'prerelease' : 'release';
}

/** `1.0.0-beta.1` → `1.0.0`: the version's three numbers alone. */
function coreOf(version: string): string {
    const dash = version.indexOf('-');
    return dash === -1 ? version : version.slice(0, dash);
}

/** The SemVer order of two versions (`1.0.0-beta.1` < `1.0.0`) as -1, 0 or 1. */
function versionOrder(installed: string, bundle: string): number {
    return Math.sign(compareVersions(installed, bundle) ?? 0);
}

/**
 * Two builds of one core, at least one of them a dev build, placed by their build times: the later is the newer (equal
 * times of two builds count as older). A dev build installed without a time (deployed before the times existed)
 * counts as older, so the admin's bundle replaces it. Otherwise, with a time missing, SemVer decides, and a tie keeps
 * what is installed: it is never replaced by a build that cannot be placed.
 */
function compareByTime(installed: ParsedRelease, bundle: ParsedRelease, times: ReleaseTimes): number {
    if (times.installed !== null && times.bundle !== null) {
        return times.installed > times.bundle ? 1 : -1;
    }
    return compareUntimed(installed, bundle, times.installed === null);
}

/** `compareByTime` with a time missing: an untimed dev build installed is behind; else SemVer, a tie keeping it. */
function compareUntimed(installed: ParsedRelease, bundle: ParsedRelease, installedUntimed: boolean): number {
    if (installedUntimed && installed.build !== '') {
        return -1;
    }
    const order = versionOrder(installed.version, bundle.version);
    return order === 0 ? 1 : order;
}

/**
 * Two parsed releases of one core: the same release is equal; two tagged releases follow SemVer (a tagged `1.0.0` is
 * newer than a tagged `1.0.0-beta.1`: the downgrade guard); a dev build against anything is placed by the build times,
 * so the untagged `1.0.0+dcfb067` is older than a `1.0.0-beta.1` made after it (the live finding of 2026-11-12).
 */
function compareSameCore(installed: ParsedRelease, bundle: ParsedRelease, times: ReleaseTimes): number {
    if (installed.version === bundle.version && installed.build === bundle.build) {
        return 0;
    }
    if (installed.build === '' && bundle.build === '') {
        return versionOrder(installed.version, bundle.version);
    }
    return compareByTime(installed, bundle, times);
}

/** Two parsed releases: the core (`major.minor.patch`) first, then `compareSameCore`. */
function compareParsed(installed: ParsedRelease, bundle: ParsedRelease, times: ReleaseTimes): number {
    const core = versionOrder(coreOf(installed.version), coreOf(bundle.version));
    return core === 0 ? compareSameCore(installed, bundle, times) : core;
}

/**
 * `installed` against `bundle` (the admin's own): negative when the installed release is older, 0 when it is the same,
 * positive when it is newer. A total order that follows the build (finding 39 of 2026-11-01, the live finding of
 * 2026-11-12): the core decides first; within one core two tagged releases follow SemVer, and a dev build is placed by
 * the build times (`compareByTime`). An installed release that does not parse is older than any bundle, and a bundle
 * that does not parse never replaces anything.
 */
export function compareRelease(installed: string, bundle: string, times: ReleaseTimes = UNKNOWN_TIMES): number {
    const left = parseRelease(installed);
    const right = parseRelease(bundle);
    if (left === null || right === null) {
        return left === null ? -1 : 1;
    }
    return compareParsed(left, right, times);
}

/** One tarball of the bundle: its name (`INSTALL_BUNDLE_FILES`), its size and its SHA-256. */
function bundleFileSchema<Name extends string>(name: Name) {
    return z.strictObject({ name: z.literal(name), bytes: z.number().int().min(1).max(MAX_BUNDLE_FILE_BYTES), sha256: sha256HexSchema });
}

export interface InstallBundleFile {
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
}

const imageDigestSchema = z.string().regex(IMAGE_DIGEST_PATTERN, coded('validation.format'));

/** `manifest.json` of the bundle (§1.3). */
export const installManifestSchema = z
    .strictObject({
        format: z.literal(INSTALL_FORMAT),
        /** The admin's `runtime.json` release of the same build. */
        release: releaseSchema,
        /** The admin's `runtime.json` build time (finding 39), or null for a build that knows none. */
        releaseTime: releaseTimeSchema.nullable(),
        /** What the release is (`releaseChannel`): written by the bundle's build; absent from a bundle made before it. */
        channel: releaseChannelSchema.optional(),
        slug: installSlugSchema,
        /** `infra/project.json`'s project. */
        projectId: z.string().regex(PROJECT_ID_PATTERN, coded('validation.format')),
        files: z.strictObject({
            server: bundleFileSchema(INSTALL_BUNDLE_FILES.server),
            pipeline: bundleFileSchema(INSTALL_BUNDLE_FILES.pipeline),
            site: bundleFileSchema(INSTALL_BUNDLE_FILES.site),
            /** The legacy originals (§73k); absent from a bundle that has none. */
            legacy: bundleFileSchema(LEGACY_BUNDLE_FILE).optional(),
        }),
        /** The registry's deployed names, sorted: the server's expected set. */
        functions: z
            .array(z.string().regex(FUNCTION_NAME_PATTERN, coded('validation.format')))
            .min(1)
            .max(MAX_FUNCTIONS),
        tools: z.strictObject({
            firebaseTools: z.literal(FIREBASE_TOOLS_VERSION),
            /** The Node image of every Node step, by digest. */
            node: imageDigestSchema,
            /** The Docker builder of the pipeline's steps, by digest; null until it is pinned (§67e). */
            docker: imageDigestSchema.nullable(),
        }),
        estimates: z.strictObject({
            server: z.strictObject({ buildMinutes: z.number().int().min(1).max(1000) }),
            pipeline: z.strictObject({ buildMinutes: z.number().int().min(1).max(1000) }),
            site: z.strictObject({ buildMinutes: z.number().int().min(1).max(1000) }),
        }),
    })
    .refine((manifest) => manifest.slug === installReleaseSlug(manifest.release), coded('validation.value', ['slug']))
    .refine(
        (manifest) => manifest.channel === undefined || manifest.channel === releaseChannel(manifest.release),
        coded('validation.value', ['channel']),
    );

export type InstallManifest = z.infer<typeof installManifestSchema>;

/** One `HCM_INSTALL` line of a build's log, as a step script prints it. */
export const installLogEventSchema = z.discriminatedUnion('event', [
    /** A known first-deploy race: the step waits and tries again (§1.5). */
    z.strictObject({
        event: z.literal('retry'),
        attempt: z.number().int().min(1).max(10),
        waitSeconds: z.number().int().min(0).max(3600),
        reason: z.enum(TRANSIENT_REASONS),
    }),
    /** `verify`: a function of the manifest is not deployed. */
    z.strictObject({ event: z.literal('missing'), name: z.string().regex(FUNCTION_NAME_PATTERN) }),
    /** `verify`: a function is deployed but not `ACTIVE`, or runs another release. */
    z.strictObject({ event: z.literal('failed'), name: z.string().regex(FUNCTION_NAME_PATTERN) }),
    /** `push`: the pipeline image's digest. */
    z.strictObject({ event: z.literal('image'), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }),
    /** `jobs` (finding 47 of 2026-11-01): Google refused for a quota, which waiting does not lift; the card names it. */
    z.strictObject({
        event: z.literal('quota'),
        service: z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/),
        metric: z.string().max(200),
        limit: z.string().max(200),
    }),
]);

export type InstallLogEvent = z.infer<typeof installLogEventSchema>;

/** The `HCM_INSTALL` line of `event` (what a step script prints). */
export function installLogLine(event: InstallLogEvent): string {
    return `${HCM_INSTALL_LOG_PREFIX}${JSON.stringify(event)}`;
}

/** The event a log line carries, or null for any other line (shown as text, never parsed further). */
export function parseInstallLogLine(line: string): InstallLogEvent | null {
    const start = line.indexOf(HCM_INSTALL_LOG_PREFIX);
    if (start === -1) {
        return null;
    }
    try {
        const parsed = installLogEventSchema.safeParse(JSON.parse(line.slice(start + HCM_INSTALL_LOG_PREFIX.length)));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

const ISO_TIME = z.iso.datetime();
const MESSAGE_CODE = /^apiError\.[a-zA-Z.]{1,80}$/;
const PARAM_NAME = /^[a-zA-Z]{1,30}$/;

/** One target's last known state, as Setup recorded it (no token, address, secret or log line). */
export const installRecordSchema = z.strictObject({
    state: z.enum(INSTALL_STATES),
    release: releaseSchema.optional(),
    /** The installed release's build time, when the installed parts name one (finding 39). */
    releaseTime: releaseTimeSchema.optional(),
    buildId: installBuildIdSchema.optional(),
    /**
     * M7 (`docs/research/M7-local-worker.md` §1.1): the pipeline's image digest its build pushed (the log's `image` event),
     * which the local worker's command names.
     */
    image: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional(),
    checkedAt: ISO_TIME,
    /** Why, as an `apiError.install.*` (or other API) code. */
    detail: z.string().regex(MESSAGE_CODE).optional(),
    params: z
        .record(z.string().regex(PARAM_NAME), z.string().max(200))
        .refine((params) => Object.keys(params).length <= 5, coded('validation.tooBig'))
        .optional(),
});

export type InstallRecord = z.infer<typeof installRecordSchema>;

/** `setup/status.install` (and the bootstrap record's `install`): each target's last known state. */
export const setupInstallSchema = z.strictObject({
    server: installRecordSchema.optional(),
    pipeline: installRecordSchema.optional(),
    site: installRecordSchema.optional(),
});

export type SetupInstall = z.infer<typeof setupInstallSchema>;
