/**
 * The installer's Cloud Build adapter (`docs/research/M6-interfaces.md` §1.7, §1.10): each call builds its clients
 * around the access token it is given (memory only, never kept), as the Setup Assistant's Cloud port does. It reads
 * what is installed (the functions' `HCM_RELEASE`, the jobs' release label, the site's `/release.json`), the target's
 * newest build by tag, and why a build cannot be submitted (the installer's account, the bundle, the repository, the
 * docker builder's digest, a map to show); it submits the build of the admin's own bundle.
 */
import {
    adminSiteId,
    adminSiteUrl,
    CLOUD_RUN_JOBS,
    compareRelease,
    INSTALLER_ACCOUNT,
    parseReleaseTime,
    pipelineImageDigest,
    PIPELINE_REPOSITORY,
    RELEASE_PATTERN,
    releaseOfSlug,
    type InstallManifest,
    type InstallTarget,
    type Logger,
} from '@hcm/shared';
import { GENERIC_INSTALL_PROJECT } from '@hcm/shared';

import { createArtifactRegistryClient } from '../google/artifact-registry.js';
import { cloudBuildConsoleUrl, createCloudBuildClient, type CloudBuild } from '../google/cloud-build.js';
import { createFunctionsClient, deploymentStatus, type DeployedFunction } from '../google/functions.js';
import { createIamClient, serviceAccountEmail } from '../google/iam.js';
import { at, stringAt } from '../google/json.js';
import { createLoggingClient } from '../google/logging.js';
import { createRunJobsClient } from '../google/run-jobs.js';
import { createGoogleTransport, type GoogleTransport } from '../google/transport.js';
import { buildDefinition, targetTag } from './build-spec.js';
import { InstallBundleError, type InstallBundle } from './bundle.js';
import type { InstalledInfo, InstallMessage } from './model.js';
import type { InstallAccess, InstallerPort, ServerProgress, SubmitOptions, TargetObservation } from './ports.js';

export interface CloudBuildInstallerDeps {
    readonly fetch: typeof fetch;
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: Logger;
    readonly projectId: string;
    readonly region: string;
    /** The admin's own bundle (read once it is found; `bundle.ts`). */
    readonly bundle: () => Promise<InstallBundle>;
    /** The admin's own origin: the site's `/release.json` is there. */
    readonly origin: string;
    /** The project's first city has a published manifest: Publish the map has something to show. */
    readonly hasPublishedMap: () => Promise<boolean>;
    /**
     * Finding 29 of 2026-10-31: the admin release Hosting serves now instead of this one (`../app/release-watch.ts`), or
     * null while it serves this one. Read before every submit: a tab left open across a redeploy would send the build
     * to the old release's bundle, which the redeploy removed.
     */
    readonly newerAdmin: () => Promise<string | null>;
    /**
     * §73k: whether step (h)'s legacy import is complete (every old photo imported, none failed). A site build then
     * leaves the originals (`legacy.tgz`) out of the download and the release; a project whose import is not complete,
     * or whose state cannot be read, keeps them.
     */
    readonly legacyImported: () => Promise<boolean>;
    /**
     * §210: the admin's own Hosting site when this page is served from it (so it is the project's), else null; a server
     * build then names it to the functions (`HCM_ADMIN_SITE`), whose links open it directly.
     */
    readonly adminSite?: string | null;
}

/**
 * §210: the admin's own site's address when this tab is still on the public map's `/admin/`, which now answers 301 there
 * (lesson 675): `adminOutdated` then names it, and a reload lands on it. Null on the admin's own site or without a move.
 */
async function movedTo(deps: CloudBuildInstallerDeps): Promise<string | null> {
    const answer = deps.adminSite
        ? null
        : await deps.fetch(new URL('/admin/runtime.json', deps.origin), { redirect: 'manual' }).catch(() => null);
    return answer?.type === 'opaqueredirect' ? adminSiteUrl(adminSiteId(deps.projectId)) : null;
}

/** §210: the admin's own site for a build's parameters, when the admin runs on it. */
function adminSiteParam(adminSite: string | null | undefined): { readonly adminSite?: string } {
    return adminSite === null || adminSite === undefined ? {} : { adminSite };
}

const NOT_INSTALLED: InstalledInfo = { complete: false, release: null, releaseTime: null, partial: false, newest: null, newestTime: null };

/** An installed part's release and its build time (finding 39 of 2026-11-01); a release of null names none. */
interface PartRelease {
    readonly release: string | null;
    readonly releaseTime: number | null;
}

/** A part naming a release, with its build time. */
interface NamedRelease {
    readonly release: string;
    readonly releaseTime: number | null;
}

/** `a` against `b` in the release order that follows the build. */
function compareParts(a: NamedRelease, b: NamedRelease): number {
    return compareRelease(a.release, b.release, { installed: a.releaseTime, bundle: b.releaseTime });
}

function named(parts: readonly PartRelease[]): NamedRelease[] {
    return parts.filter((part): part is NamedRelease => part.release !== null);
}

/** The oldest of `parts` (a part naming no release makes the whole unknown: an update replaces it). */
function oldestPart(parts: readonly PartRelease[]): PartRelease {
    const [first, ...rest] = named(parts);
    if (first === undefined || rest.length + 1 < parts.length) {
        return { release: null, releaseTime: null };
    }
    return rest.reduce((oldest, part) => (compareParts(part, oldest) < 0 ? part : oldest), first);
}

/** `part` is newer than `than` (any release is newer than none). */
function isNewer(part: NamedRelease, than: PartRelease): boolean {
    return (
        than.release === null || compareRelease(part.release, than.release, { installed: part.releaseTime, bundle: than.releaseTime }) > 0
    );
}

/** The newest release any part names (parts naming none ignored), or a release of null. */
function newestPart(parts: readonly PartRelease[]): PartRelease {
    return named(parts).reduce<PartRelease>((newest, part) => (isNewer(part, newest) ? part : newest), {
        release: null,
        releaseTime: null,
    });
}

/**
 * What is installed of a target made of `parts` (null: a part not there): complete with its oldest release, or partial,
 * and in every case the newest release a part names, so a newer server missing a function is still never replaced.
 */
function installedOf(parts: readonly (PartRelease | null)[], complete: boolean): InstalledInfo {
    const present = parts.filter((part): part is PartRelease => part !== null);
    const newest = newestPart(present);
    const newestFields = { newest: newest.release, newestTime: newest.releaseTime };
    if (complete) {
        const oldest = oldestPart(present);
        return { complete, release: oldest.release, releaseTime: oldest.releaseTime, partial: false, ...newestFields };
    }
    return { complete, release: null, releaseTime: null, partial: present.length > 0, ...newestFields };
}

function serverInstalled(functions: readonly DeployedFunction[]): { installed: InstalledInfo; progress: ServerProgress } {
    const status = deploymentStatus(functions);
    const progress = { ready: status.ready, total: status.total, failed: status.failed };
    return { installed: installedOf(functions, status.state === 'ok'), progress };
}

/**
 * What `/release.json` says of the public site (`{release, releaseTime?, variant}`); a start-up root or no file is not
 * installed.
 */
function siteInstalled(body: unknown): InstalledInfo {
    const release = stringAt(body, 'release');
    if (at(body, 'variant') !== 'public' || release === undefined || !RELEASE_PATTERN.test(release)) {
        return NOT_INSTALLED;
    }
    const releaseTime = parseReleaseTime(at(body, 'releaseTime'));
    return { complete: true, release, releaseTime, partial: false, newest: release, newestTime: releaseTime };
}

class CloudBuildInstaller implements InstallerPort {
    readonly #deps: CloudBuildInstallerDeps;
    /** The installer's account was seen once: it is not looked for again. */
    #accountSeen = false;

    constructor(deps: CloudBuildInstallerDeps) {
        this.#deps = deps;
    }

    async observe(target: InstallTarget, access: InstallAccess): Promise<TargetObservation> {
        const transport = this.#transport(access);
        const [installed, build, blocker] = await Promise.all([
            this.#installed(target, transport),
            this.#newestBuild(target, transport),
            this.#blocker(target, transport),
        ]);
        return { ...installed, build, blocker };
    }

    /** The bundle a build of `target` installs: refused while a newer admin is out, or for a pipeline the bundle has none of. */
    async #bundleFor(target: InstallTarget): Promise<InstallBundle> {
        const newer = (await this.#deps.newerAdmin()) ?? (await movedTo(this.#deps));
        if (newer !== null) {
            throw new InstallBundleError('apiError.install.adminOutdated', { release: newer });
        }
        const bundle = await this.#deps.bundle();
        if (target === 'pipeline' && bundle.manifest.tools.docker === null) {
            throw new InstallBundleError('apiError.install.notAvailable');
        }
        return bundle;
    }

    async submit(target: InstallTarget, access: InstallAccess, options: SubmitOptions = {}): Promise<CloudBuild> {
        const bundle = await this.#bundleFor(target);
        const { manifest } = bundle;
        const definition = buildDefinition(target, {
            projectId: this.#deps.projectId,
            region: this.#deps.region,
            origin: bundle.origin,
            basePath: bundle.basePath,
            release: manifest.release,
            releaseTime: manifest.releaseTime,
            slug: manifest.slug,
            manifestSha256: bundle.sha256,
            fileSha256: manifest.files[target].sha256,
            images: { node: manifest.tools.node, docker: manifest.tools.docker ?? '' },
            legacy: await this.#needsLegacy(target, manifest),
            ...(manifest.projectId === GENERIC_INSTALL_PROJECT ? { adopt: true } : {}),
            ...(options.over === true ? { over: true } : {}),
            ...adminSiteParam(this.#deps.adminSite),
        });
        this.#deps.log.info('install build submitted', { target, release: manifest.release, over: options.over === true });
        return createCloudBuildClient(this.#transport(access)).create(this.#deps.projectId, this.#deps.region, definition);
    }

    /** A site build fetches the legacy originals while the bundle has them and the import is not complete (§73k). */
    async #needsLegacy(target: InstallTarget, manifest: InstallManifest): Promise<boolean> {
        if (target !== 'site' || manifest.files.legacy === undefined) {
            return false;
        }
        return !(await this.#deps.legacyImported());
    }

    buildLog(buildId: string, access: InstallAccess): ReturnType<InstallerPort['buildLog']> {
        return createLoggingClient(this.#transport(access)).buildLines(this.#deps.projectId, buildId);
    }

    consoleUrl(buildId: string): string {
        return cloudBuildConsoleUrl(this.#deps.projectId, this.#deps.region, buildId);
    }

    #transport(access: InstallAccess): GoogleTransport {
        return createGoogleTransport({ fetch: this.#deps.fetch, token: () => access.token, sleep: this.#deps.sleep, log: this.#deps.log });
    }

    async #installed(target: InstallTarget, transport: GoogleTransport): Promise<Pick<TargetObservation, 'installed' | 'progress'>> {
        const { projectId, region } = this.#deps;
        if (target === 'server') {
            return serverInstalled(await createFunctionsClient(transport).list(projectId, region));
        }
        if (target === 'pipeline') {
            const jobs = createRunJobsClient(transport);
            const found = await Promise.all(Object.values(CLOUD_RUN_JOBS).map((job) => jobs.get(projectId, region, job)));
            const parts = found.map((job) =>
                job === undefined ? null : { release: releaseOfSlug(job.releaseSlug), releaseTime: parseReleaseTime(job.releaseTime) },
            );
            // Finding 74: the image the job `raster-pipeline` runs is the installed one.
            const image = pipelineImageDigest(found.find((job) => job?.name === CLOUD_RUN_JOBS.std)?.image ?? '');
            return {
                installed: {
                    ...installedOf(
                        parts,
                        parts.every((part) => part !== null),
                    ),
                    image,
                },
                progress: null,
            };
        }
        return { installed: siteInstalled(await this.#releaseFile()), progress: null };
    }

    /** The site's `/release.json` (no token: the admin's own origin), or undefined without one. */
    async #releaseFile(): Promise<unknown> {
        try {
            const response = await this.#deps.fetch(new URL('/release.json', this.#deps.origin), { cache: 'no-store' });
            return response.ok ? ((await response.json()) as unknown) : undefined;
        } catch {
            return undefined;
        }
    }

    async #newestBuild(target: InstallTarget, transport: GoogleTransport): Promise<CloudBuild | null> {
        const [newest] = await createCloudBuildClient(transport).listByTag(this.#deps.projectId, this.#deps.region, targetTag(target), 1);
        return newest ?? null;
    }

    async #blocker(target: InstallTarget, transport: GoogleTransport): Promise<InstallMessage | null> {
        if (!(await this.#accountExists(transport))) {
            return {
                key: 'apiError.install.notProvisioned',
                params: { account: serviceAccountEmail(INSTALLER_ACCOUNT, this.#deps.projectId) },
            };
        }
        let bundle: InstallBundle;
        try {
            bundle = await this.#deps.bundle();
        } catch (error) {
            return { key: error instanceof InstallBundleError ? error.code : 'apiError.unavailable' };
        }
        return this.#targetBlocker(target, transport, bundle);
    }

    async #targetBlocker(target: InstallTarget, transport: GoogleTransport, bundle: InstallBundle): Promise<InstallMessage | null> {
        if (target === 'pipeline') {
            return this.#pipelineBlocker(transport, bundle);
        }
        return this.localBlocker(target);
    }

    async localBlocker(target: InstallTarget): Promise<InstallMessage | null> {
        if (target === 'pipeline') {
            return this.#bundleCannotInstallPipeline();
        }
        return target === 'site' && !(await this.#deps.hasPublishedMap()) ? { key: 'apiError.install.nothingToShow' } : null;
    }

    /** The pipeline's `notAvailable` when the bundle names no Docker builder; null when it does or cannot be read yet. */
    async #bundleCannotInstallPipeline(): Promise<InstallMessage | null> {
        try {
            return (await this.#deps.bundle()).manifest.tools.docker === null ? { key: 'apiError.install.notAvailable' } : null;
        } catch {
            return null;
        }
    }

    async #pipelineBlocker(transport: GoogleTransport, bundle: InstallBundle): Promise<InstallMessage | null> {
        if (bundle.manifest.tools.docker === null) {
            return { key: 'apiError.install.notAvailable' };
        }
        const repository = await createArtifactRegistryClient(transport).get(this.#deps.projectId, this.#deps.region, PIPELINE_REPOSITORY);
        return repository === undefined ? { key: 'apiError.install.noRepository', params: { repository: PIPELINE_REPOSITORY } } : null;
    }

    async #accountExists(transport: GoogleTransport): Promise<boolean> {
        if (!this.#accountSeen) {
            this.#accountSeen = (await createIamClient(transport).listServiceAccounts(this.#deps.projectId)).includes(INSTALLER_ACCOUNT);
        }
        return this.#accountSeen;
    }
}

/** The installer over Google's REST APIs. */
export function createCloudBuildInstaller(deps: CloudBuildInstallerDeps): InstallerPort {
    return new CloudBuildInstaller(deps);
}
