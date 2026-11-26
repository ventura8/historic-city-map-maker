/**
 * The install bundle of the e2e world's admin (docs/research/M6-interfaces.md §1.3): the release the admin's
 * `runtime.json` names in the install specs and the local stack, and the bundle's `manifest.json` as the site build
 * writes it (its bytes are what the admin hashes). No build runs a step in the e2e world (the fake Cloud Build plays
 * each build), so the files it names are placeholders of the right shape; no image is pulled. The Docker builder is the
 * bundle's own pin (`DOCKER_BUILDER_IMAGE`, §67e).
 */

import { DOCKER_BUILDER_IMAGE, installReleaseSlug } from '@hcm/shared';

/** The admin's release in the install specs and the local stack, and its bundle folder (`installReleaseSlug`). */
export const INSTALL_RELEASE = '1.0.0+e2e0001';
export const INSTALL_SLUG = '1-0-0-e2e0001';
/**
 * Its build time (finding 39 of 2026-11-01: the commit's time, which orders two builds of one version): between the
 * fake server's older build of 1.0.0, deployed before the build times, and its newer one (`NEWER_BUILD_TIME`).
 */
export const INSTALL_RELEASE_TIME = 1_761_955_200;

const NODE_IMAGE = `node:24-bookworm-slim@sha256:${'d6'.repeat(32)}`;

function file(name: string, char: string): Record<string, unknown> {
    return { name, bytes: 1024, sha256: char.repeat(64) };
}

/**
 * `install/<slug>/manifest.json` of `release` for `projectId`; without the Docker builder (`docker` false) the pipeline
 * is off.
 */
export function installManifestText(
    projectId: string,
    docker = true,
    release = INSTALL_RELEASE,
    releaseTime: number | null = INSTALL_RELEASE_TIME,
): string {
    const manifest = {
        format: 1,
        release,
        releaseTime,
        slug: installReleaseSlug(release),
        projectId,
        files: {
            server: file('server.tgz', 'a'),
            pipeline: file('pipeline.tgz', 'b'),
            site: file('hosting.tgz', 'c'),
            // §73k: the old photos' originals, which a site build fetches only while the legacy import is not complete.
            legacy: file('legacy.tgz', 'e'),
        },
        functions: ['admin-session'],
        tools: { firebaseTools: '15.36.0', node: NODE_IMAGE, docker: docker ? DOCKER_BUILDER_IMAGE : null },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
    };
    return `${JSON.stringify(manifest, null, 4)}\n`;
}
