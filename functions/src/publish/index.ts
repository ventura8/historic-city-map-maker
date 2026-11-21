import { buildManifestFunction, type BuildDeps } from './build-manifest.js';
import { onWriteFunctions } from './on-write.js';
import { rebuildManifestFunction, type RebuildDeps } from './rebuild-manifest.js';

export type PublishDeps = BuildDeps & RebuildDeps;

/**
 * The `publish.*` functions under their registry names (`docs/research/M2-interfaces.md` §3.5): the five diff-gated
 * Firestore triggers, the admin's `rebuildManifest` and the serialized `buildManifest` task queue. The integrator
 * exports them as the `publish` group (`export const publish = publishFunctions(getDeps)` deploys `publish-onPhotoWrite`,
 * ...), building nothing until a function first runs.
 */
export function publishFunctions(getDeps: () => PublishDeps) {
    return {
        ...onWriteFunctions(getDeps),
        rebuildManifest: rebuildManifestFunction(getDeps),
        buildManifest: buildManifestFunction(getDeps),
    };
}
