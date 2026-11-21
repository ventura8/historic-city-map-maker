import { execFileSync } from 'node:child_process';

import type { SiteFileSystem } from '../files.js';
import type { AdminFile } from './legacy.js';

/**
 * The admin's `runtime.json` (docs/research/M2b-interfaces.md §1.4 step 2), written by its site build next to
 * `index.html`, so Hosting's `predeploy` produces it and nothing a workflow writes before `firebase deploy` is erased
 * (`DECISIONS-for-review.md` §23b's redesign):
 *
 * - `release`: the repository's version and the short commit the admin was built from (`0.0.0+5d02329`): the boot log
 *   and every crash report name it. A build of a commit that carries the version's tag `v<version>` (CI's tag ref, or
 *   `git tag --points-at`) names the version alone (`1.0.0-beta.1`): the release itself, never a dev build of it (the live
 *   finding of 2026-11-12, `docs/research/M6-interfaces.md` §1.7.1). A build outside a git checkout names the version only;
 * - `channel`: what the release is, read from it (`releaseChannelOf`): `release`, `prerelease` or `dev`;
 * - `releaseTime`: the build time, the commit's time in seconds since 1970 (`SOURCE_DATE_EPOCH`, else
 *   `git show -s --format=%ct <commit>`; absent when neither says): it orders two builds of the same version, whose
 *   semver is the same (live manual test 2026-11-01, finding 39). The functions' `HCM_RELEASE_TIME`, the install
 *   bundle's manifest, the public site's `release.json` and the pipeline jobs' `hcm-release-time` label carry it too;
 * - `startUp: true` when the deploy says the map's server is not installed yet (`HCM_ADMIN_START_UP=1`, the Hosting-only
 *   deploy of a new map's start-up mode): the admin then skips its anonymous probe of `admin-session`, whose missing
 *   function would make the browser log a CORS error, and learns from Google that the server is installed (step d).
 *
 * The App Check site key joins it with the deploy milestone (§23b). The e2e admin server answers its own runtime file.
 */

/** Where the page reads it. */
export const RUNTIME_FILE = 'runtime.json';

/** The environment variable a start-up deploy sets (`HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting`). */
export const START_UP_VARIABLE = 'HCM_ADMIN_START_UP';

/** The environment variables that may name the commit (CI's checkout, or a deploy that passes it in). */
const COMMIT_VARIABLES = ['HCM_COMMIT', 'GITHUB_SHA'] as const;

/** A full commit id, SHA-1 or SHA-256. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How many characters of the commit the release names (git's short form). */
const SHORT_COMMIT = 7;

export type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/** `text` when it is a full commit id, else null. */
function commitOrNull(text: string): string | null {
    return COMMIT.test(text) ? text : null;
}

/** The commit the checkout's `.git` folder names for `ref`: its own file, else its line of `packed-refs`, else null. */
function refCommit(files: SiteFileSystem, ref: string): string | null {
    if (files.isFile(`.git/${ref}`)) {
        return commitOrNull(files.readText(`.git/${ref}`).trim());
    }
    const packed = files.isFile('.git/packed-refs') ? files.readText('.git/packed-refs').split('\n') : [];
    const line = packed.find((entry) => entry.endsWith(` ${ref}`)) ?? '';
    return commitOrNull(line.slice(0, line.indexOf(' ')));
}

/** The commit `HEAD` points at in the checkout's `.git` folder (a branch, a packed branch or a detached head), or null. */
export function headCommit(files: SiteFileSystem): string | null {
    if (!files.isFile('.git/HEAD')) {
        return null;
    }
    const head = files.readText('.git/HEAD').trim();
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    return ref === undefined ? commitOrNull(head) : refCommit(files, ref);
}

/** The commit the build names: an environment variable's, else the checkout's `HEAD`, else null. */
export function buildCommit(files: SiteFileSystem, env: BuildEnvironment): string | null {
    const named = COMMIT_VARIABLES.map((name) => env[name] ?? '').find((value) => COMMIT.test(value));
    return named ?? headCommit(files);
}

/** The repository's version (the root `package.json`, which every package's version follows). */
function repositoryVersion(files: SiteFileSystem): string {
    const parsed = JSON.parse(files.readText('package.json')) as { readonly version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
}

/** Reads the tags that point at a commit (`git tag --points-at`), or none when they cannot be read. */
export type CommitTags = (commit: string) => readonly string[];

/** What a release is, as `releaseChannel` of `@hcm/shared` reads it (this file imports Node built-ins only). */
export type BuildChannel = 'release' | 'prerelease' | 'dev';

/** An untagged build names its commit after `+` (`dev`); a tagged one is a pre-release (`-beta.N`, `-rc.N`) or a release. */
export function releaseChannelOf(release: string): BuildChannel {
    if (release.includes('+')) {
        return 'dev';
    }
    return release.includes('-') ? 'prerelease' : 'release';
}

/** The build is the version's tagged release: CI's tag ref is `refs/tags/v<version>`, or the commit carries that tag. */
function taggedBuild(version: string, commit: string, env: BuildEnvironment, tags: CommitTags): boolean {
    const tag = `v${version}`;
    return env['GITHUB_REF'] === `refs/tags/${tag}` || tags(commit).includes(tag);
}

/** Reads a commit's time in seconds since 1970, or null when it cannot be read. */
export type CommitClock = (commit: string) => number | null;

/** Whole seconds since 1970 written as text (at most ten digits, as `releaseTimeSchema` of `@hcm/shared` reads them). */
const SECONDS = /^\d{1,10}$/;

/** git where the quality image, CI's runners and the Linux hosts have it (an absolute path: never whatever PATH names). */
const GIT = '/usr/bin/git';

/**
 * The commit's time from git (`git show -s --format=%ct`), from the working directory's repository: null without git,
 * outside a checkout or for a commit it does not hold. `safe.directory` admits the quality image's other user.
 */
export function gitCommitTime(commit: string): number | null {
    try {
        const text = execFileSync(GIT, ['-c', 'safe.directory=*', 'show', '-s', '--format=%ct', commit], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return SECONDS.test(text) ? Number(text) : null;
    } catch {
        return null;
    }
}

/** The tags at the commit, from the working directory's repository (`git tag --points-at`); none without git. */
export function gitCommitTags(commit: string): readonly string[] {
    try {
        return execFileSync(GIT, ['-c', 'safe.directory=*', 'tag', '--points-at', commit], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .split('\n')
            .map((tag) => tag.trim())
            .filter((tag) => tag !== '');
    } catch {
        return [];
    }
}

/** `<version>+<short commit>`; the version alone for a tagged build (`taggedBuild`) or without a commit. */
export function adminRelease(files: SiteFileSystem, env: BuildEnvironment, tags: CommitTags = gitCommitTags): string {
    const version = repositoryVersion(files);
    const commit = buildCommit(files, env);
    if (commit === null || taggedBuild(version, commit, env, tags)) {
        return version;
    }
    return `${version}+${commit.slice(0, SHORT_COMMIT)}`;
}

/**
 * The build time (finding 39): `SOURCE_DATE_EPOCH` when it is whole seconds, else the build commit's time (`clock`), else
 * null (a build outside a checkout).
 */
export function releaseTime(files: SiteFileSystem, env: BuildEnvironment, clock: CommitClock = gitCommitTime): number | null {
    const epoch = env['SOURCE_DATE_EPOCH'] ?? '';
    if (SECONDS.test(epoch)) {
        return Number(epoch);
    }
    const commit = buildCommit(files, env);
    return commit === null ? null : clock(commit);
}

/** Whether the deploy declares start-up mode (`HCM_ADMIN_START_UP=1` or `true`). */
export function startUpDeploy(env: BuildEnvironment): boolean {
    return ['1', 'true'].includes(env[START_UP_VARIABLE] ?? '');
}

/** The page's `runtime.json`: the release, its channel, its build time when known, and a start-up deploy's `startUp`. */
export function planRuntimeFile(
    files: SiteFileSystem,
    env: BuildEnvironment,
    clock: CommitClock = gitCommitTime,
    tags: CommitTags = gitCommitTags,
): { readonly file: AdminFile; readonly release: string } {
    const release = adminRelease(files, env, tags);
    const time = releaseTime(files, env, clock);
    const channel = releaseChannelOf(release);
    const stamp = time === null ? { release, channel } : { release, channel, releaseTime: time };
    const runtime = startUpDeploy(env) ? { ...stamp, startUp: true } : stamp;
    return { file: { to: RUNTIME_FILE, content: `${JSON.stringify(runtime, null, 4)}\n` }, release };
}
