import '../global-options.js';

import { PIPELINE_REPOSITORY, type CallableResponse } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { installedImage, type InstalledImageDeps } from './installed-image.js';

export type ImageDeps = Pick<Ports, 'config'> & InstalledImageDeps;

/**
 * `worker.image` (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §1.5; S-A62-HAPPY-STARTER-IMAGE): the
 * installed pipeline image, by digest, that the starter file's supervisor pulls and runs on the owner's computer, with
 * its release. Finding 74 of 2026-11-03 (S-A62-HAPPY-STARTER-IMAGE-UPDATE, S-A62-BAD-STARTER-IMAGE-STALE): the image the
 * job `raster-pipeline` runs, which the pipeline build that just ran set, before the record `setup/status.install.pipeline`
 * (which an admin wrote, and which named the release before's digest beside the new release); a release is never paired
 * with another digest (`installed-image.ts`). No sign-in and no App Check (a shell script asks it); it answers what
 * Provision already makes public (the repository `hcm` is readable by `allUsers`). `apiError.notFound` while neither the
 * job nor the record names an image: the supervisor waits and asks again.
 */
async function workerImage(deps: ImageDeps): Promise<CallableResponse<'worker.image'>> {
    const installed = await installedImage(deps);
    if (installed === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const { digest, release, from } = installed;
    const image = `us-central1-docker.pkg.dev/${deps.config.projectId}/${PIPELINE_REPOSITORY}/pipeline@${digest}`;
    deps.log.info('worker image asked', { release: release ?? null, from });
    return release === undefined ? { image, digest } : { image, digest, release };
}

/** The `worker-image` callable. */
export function imageFunction(getDeps: () => ImageDeps & CallableDeps) {
    return defineCallable('worker.image', (deps) => workerImage(deps), getDeps);
}
