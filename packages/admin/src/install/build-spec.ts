/**
 * The three install builds as data (`docs/research/M6-interfaces.md` §1.4): what the admin submits to Cloud Build for
 * the server, the imagery pipeline and the public site. Every build runs as `hcm-installer@` (never a key, never the
 * owner's token), logs to Cloud Logging only, carries the tags the cards find it by and the substitutions its `fetch`
 * step checks the bundle with. Every image is named by digest, from the admin's own verified manifest. Nothing here
 * comes from data: the project, region and release are the admin's own, the origin and base path its own address.
 * `build-spec.test.ts` pins each definition against golden JSON.
 */
import { INSTALLER_ACCOUNT, PIPELINE_REPOSITORY, adminSiteId, siteOrigins, type InstallTarget } from '@hcm/shared';

import type { JsonObject } from '../google/json.js';
import { FETCH_BUNDLE_SCRIPT } from './fetch-script.js';

interface BuildImages {
    /** `node:24-bookworm-slim@sha256:…` for every Node step. */
    readonly node: string;
    /** The Docker builder of the pipeline's steps, by digest. */
    readonly docker: string;
}

export interface BuildParams {
    readonly projectId: string;
    readonly region: string;
    /** The admin's own origin (`https://<project>.web.app`). */
    readonly origin: string;
    /** The admin's base path (`/admin/`). */
    readonly basePath: string;
    readonly release: string;
    /** The release's build time (the manifest's, finding 39 of 2026-11-01), or null when the build knows none. */
    readonly releaseTime: number | null;
    readonly slug: string;
    /** SHA-256 of `manifest.json` as the admin read it. */
    readonly manifestSha256: string;
    /** SHA-256 of the target's tarball, as the manifest names it. */
    readonly fileSha256: string;
    readonly images: BuildImages;
    /**
     * §73k: whether a site build fetches and unpacks `legacy.tgz` (the old photos' originals): while the legacy import is
     * not complete and the bundle has them. The other targets ignore it.
     */
    readonly legacy: boolean;
    /**
     * M14 (`docs/research/M14-start-your-map.md` §6): the bundle names no project, so a site build's `fetch` puts this
     * project's id into the tree it unpacks and takes `project.json` from the live site.
     */
    readonly adopt?: boolean;
    /**
     * The owner confirmed "Install this admin's version anyway" over a newer release (the live finding of 2026-11-12):
     * the build carries `OVER_TAG`, so Cloud Build's history keeps the rollback.
     */
    readonly over?: boolean;
    /**
     * §210: the admin's own Hosting site, named only by an admin served from it (the site is then this project's). A server
     * build's `fetch` writes it into the functions' `.env` (`HCM_ADMIN_SITE`), so their links open it directly; the other
     * targets ignore it.
     */
    readonly adminSite?: string;
}

/** Every build's tag, and each target's own (the cards list builds by it). */
const INSTALL_TAG = 'hcm-install';

/** The tag of a build the owner installed over a newer release. */
export const OVER_TAG = 'hcm-over';

export function targetTag(target: InstallTarget): string {
    return `hcm-${target}`;
}

export function releaseTag(slug: string): string {
    return `hcm-r-${slug}`;
}

/** How long each build may run (§1.4) and how long it may wait in the queue. */
const TIMEOUT_SECONDS: Readonly<Record<InstallTarget, number>> = { server: 3600, pipeline: 5400, site: 1800 };
const QUEUE_TTL_SECONDS = 3600;

/** `firebase-tools` as the bundle's `tools/` folder installs it. */
const FIREBASE_BIN = 'tools/node_modules/firebase-tools/lib/bin/firebase.js';

/** Where each target's tarball is unpacked (`/workspace/<dir>`), and the steps' working folder. */
const TARGET_DIRS: Readonly<Record<InstallTarget, string>> = { server: 'server', pipeline: 'pipeline', site: 'site' };

/** The functions' source in the server's tarball (`firebase.json`'s `functions.source`). */
const FUNCTIONS_SOURCE = 'functions/dist';

/** The tarballs each target's `fetch` downloads, its own first. */
const FETCHED: Readonly<Record<InstallTarget, string>> = { server: 'server', pipeline: 'pipeline', site: 'site,server,pipeline' };

/** The Hosting site keeps this many releases (`hosting-config`, §1.4.3). */
const HOSTING_MAX_VERSIONS = 10;

/** The pipeline's image, tagged with the release's slug (the jobs run it by digest). */
function pipelineImage(region: string): string {
    return `${region}-docker.pkg.dev/$PROJECT_ID/${PIPELINE_REPOSITORY}/pipeline:\${_SLUG}`;
}

/** The site build's extra env: the bundle kept in the release, and the legacy originals while they are needed (§73k). */
function siteEnv(target: InstallTarget, params: BuildParams): readonly string[] {
    if (target !== 'site') {
        return [];
    }
    const keep = 'HCM_KEEP_BUNDLE=public${_BASE}install/${_SLUG}';
    const adopt = params.adopt === true ? ['HCM_ADOPT_PROJECT=$PROJECT_ID', 'HCM_ADOPT_FROM=${_ORIGIN}${_BASE}project.json'] : [];
    return [...(params.legacy ? [keep, 'HCM_UNPACK=legacy'] : [keep]), ...adopt];
}

/** The server build's extra env: the admin's own site for the functions' `.env` (§210), when the admin named one. */
function serverEnv(target: InstallTarget, params: BuildParams): readonly string[] {
    return target === 'server' && params.adminSite !== undefined ? [`HCM_ADMIN_SITE=${params.adminSite}`] : [];
}

/** The tarballs `fetch` downloads (`FETCHED`), with `legacy.tgz` for a site build that needs it. */
function fetched(target: InstallTarget, params: BuildParams): string {
    return target === 'site' && params.legacy ? `${FETCHED.site},legacy` : FETCHED[target];
}

function fetchStep(target: InstallTarget, params: BuildParams): JsonObject {
    return {
        id: 'fetch',
        name: params.images.node,
        entrypoint: 'node',
        args: ['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT],
        env: [
            'HCM_BUNDLE_URL=${_ORIGIN}${_BASE}install/${_SLUG}/',
            'HCM_MANIFEST_SHA256=${_MANIFEST_SHA256}',
            'HCM_FILE_SHA256=${_FILE_SHA256}',
            'HCM_RELEASE=${_RELEASE}',
            'HCM_RELEASE_TIME=${_RELEASE_TIME}',
            `HCM_FILES=${fetched(target, params)}`,
            `HCM_OUT=/workspace/${TARGET_DIRS[target]}`,
            // §210: the one redirect the download may follow, to the project's admin site (lesson 675).
            `HCM_REDIRECT_ORIGIN=${siteOrigins(adminSiteId(params.projectId))[0]}`,
            ...siteEnv(target, params),
            ...serverEnv(target, params),
        ],
    };
}

function toolsStep(target: InstallTarget, params: BuildParams): JsonObject {
    return {
        id: 'tools',
        name: params.images.node,
        entrypoint: 'npm',
        dir: `${TARGET_DIRS[target]}/tools`,
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    };
}

/**
 * `packages` (finding 30 of 2026-10-31): the functions' locked runtime dependencies (`functions/dist/package-lock.json`,
 * `functions/deploy-lock/`) installed into their source folder. Before it deploys, `firebase-tools` resolves
 * `firebase-functions` from that folder and loads `index.js` to discover the functions, which imports `firebase-admin`
 * and the rest; on a laptop Node finds them in the repository's `node_modules` above `functions/dist`, in the build
 * nothing does. No install script runs: none of the tree's is needed to load it (sharp's native code comes as the
 * prebuilt `@img/sharp-linux-x64` packages the lock names for linux x64 glibc). `node_modules` is in `functions.ignore`,
 * so it is never uploaded; Google's own build of each function installs the same lock again.
 */
function packagesStep(params: BuildParams): JsonObject {
    return {
        id: 'packages',
        name: params.images.node,
        entrypoint: 'npm',
        dir: `${TARGET_DIRS.server}/${FUNCTIONS_SOURCE}`,
        args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    };
}

function nodeStep(id: string, target: InstallTarget, params: BuildParams, args: readonly string[]): JsonObject {
    return { id, name: params.images.node, entrypoint: 'node', dir: TARGET_DIRS[target], args };
}

function serverSteps(params: BuildParams): readonly JsonObject[] {
    const project = ['--project', '$PROJECT_ID'];
    return [
        fetchStep('server', params),
        toolsStep('server', params),
        packagesStep(params),
        nodeStep('rules', 'server', params, [FIREBASE_BIN, 'deploy', '--only', 'firestore,storage', ...project, '--non-interactive']),
        nodeStep('functions', 'server', params, ['steps/deploy-with-retry.mjs', ...project, '--force']),
        nodeStep('verify', 'server', params, [
            'steps/verify-server.mjs',
            ...project,
            '--region',
            params.region,
            '--release',
            '${_RELEASE}',
        ]),
    ];
}

function pipelineSteps(params: BuildParams): readonly JsonObject[] {
    const image = pipelineImage(params.region);
    return [
        fetchStep('pipeline', params),
        {
            id: 'build',
            name: params.images.docker,
            dir: 'pipeline',
            env: ['DOCKER_BUILDKIT=1'],
            // The release stamps the image (`HCM_RELEASE`): the worker reports it to `worker.hello`, the computer cards show it.
            args: ['build', '-f', 'Dockerfile', '--target', 'runtime', '--build-arg', 'HCM_RELEASE=${_RELEASE}', '-t', image, '.'],
        },
        {
            id: 'push',
            name: params.images.docker,
            entrypoint: 'bash',
            dir: 'pipeline',
            args: ['-c', `docker push ${image} && docker inspect --format='{{index .RepoDigests 0}}' ${image} > /workspace/digest`],
        },
        nodeStep('jobs', 'pipeline', params, [
            'steps/run-jobs.mjs',
            ...['--project', '$PROJECT_ID', '--region', params.region, '--image-file', '/workspace/digest', '--slug', '${_SLUG}'],
            ...['--release-time', '${_RELEASE_TIME}'],
        ]),
    ];
}

function siteSteps(params: BuildParams): readonly JsonObject[] {
    const project = ['--project', '$PROJECT_ID'];
    return [
        fetchStep('site', params),
        toolsStep('site', params),
        // §210: deploys the admin's own site beside the public map's when the project has it (`steps/deploy-hosting.mjs`).
        nodeStep('hosting', 'site', params, ['steps/deploy-hosting.mjs', ...project, '--max-versions', String(HOSTING_MAX_VERSIONS)]),
        nodeStep('config', 'site', params, ['steps/hosting-config.mjs', ...project, '--max-versions', String(HOSTING_MAX_VERSIONS)]),
    ];
}

const STEPS: Readonly<Record<InstallTarget, (params: BuildParams) => readonly JsonObject[]>> = {
    server: serverSteps,
    pipeline: pipelineSteps,
    site: siteSteps,
};

/** `hcm-installer@<project>.iam.gserviceaccount.com` as a build's `serviceAccount` names it. */
export function installerServiceAccount(projectId: string): string {
    return `projects/${projectId}/serviceAccounts/${INSTALLER_ACCOUNT}@${projectId}.iam.gserviceaccount.com`;
}

/** The build the admin submits for `target` (§1.4). */
export function buildDefinition(target: InstallTarget, params: BuildParams): JsonObject {
    return {
        serviceAccount: installerServiceAccount(params.projectId),
        options: { logging: 'CLOUD_LOGGING_ONLY' },
        timeout: `${String(TIMEOUT_SECONDS[target])}s`,
        queueTtl: `${String(QUEUE_TTL_SECONDS)}s`,
        tags: [INSTALL_TAG, targetTag(target), releaseTag(params.slug), ...(params.over === true ? [OVER_TAG] : [])],
        substitutions: {
            _ORIGIN: params.origin,
            _BASE: params.basePath,
            _SLUG: params.slug,
            _RELEASE: params.release,
            // Every substitution is used by a step (Cloud Build refuses an unused one): `fetch` checks it against the manifest.
            _RELEASE_TIME: params.releaseTime === null ? '' : String(params.releaseTime),
            _MANIFEST_SHA256: params.manifestSha256,
            _FILE_SHA256: params.fileSha256,
        },
        steps: STEPS[target](params),
    };
}
