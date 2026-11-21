import { FIRESTORE_PATHS, layerDocSchema, restitchable, type HelpItem, type JobDoc, type LayerVersionDoc } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { refuseBusyLayer, refuseWhileGuardRed } from './limits.js';
import { pickDefined, stampOf } from './records.js';
import type { RegeorefDeps } from './regeoref.js';
import { createWork, jobIdFor, type NewWork } from './versions.js';

/**
 * M20 (`docs/research/M20-import-local.md` §15, DECISIONS-for-review.md §216; S-A122-HAPPY-RESTITCH): a published archive series stitched
 * on its overview with pieces left out of that mosaic is laid on its overview again in a **new version of the same layer**, the owner's
 * pairs kept when it was placed from them (one placed on its own is placed again by its class's placer). **Locate again** asks it
 * (the published version stays on the map until the new one is approved). The pairs hold because the mosaic's frame is the overview's: the scan's pixels name the same overview pixels before and
 * after (`placing/restitch.py`). The new job runs where the archive's files are (`runOn: 'local'`, as the import's); a series stitched any
 * other way, or with nothing left out, is not offered it.
 */

/** A published archive series with pieces left out of its overview mosaic (`restitchable` of `@hcm/shared`), and its own job. */
export function restitchableWith(version: LayerVersionDoc, job: JobDoc): boolean {
    return job.type === 'archive-series' && restitchable(version);
}

/** What the new version starts with: the base's label, year, source, rights, scan, pairs and help (the pipeline maps them on the new mosaic). */
function fieldsOf(base: LayerVersionDoc, help: HelpItem): Parameters<typeof createWork>[2] {
    return {
        origin: 'archive',
        basedOn: base.jobId,
        label: base.label,
        year: base.year,
        ...pickDefined(base, ['source', 'date', 'scan', 'reference', 'rights', 'georef']),
        help: omit(help, ['layoutAnswer']),
    };
}

async function restitchIn(transaction: DocumentTransaction, base: LayerVersionDoc, help: HelpItem, work: NewWork): Promise<void> {
    const layer = await transaction.get(FIRESTORE_PATHS.layer(work.cityId, base.layerId), layerDocSchema);
    if (layer?.pendingVersion !== undefined) {
        throw new ApiError('apiError.layers.busy');
    }
    await createWork(transaction, work, fieldsOf(base, help));
    if (layer !== undefined) {
        await transaction.set(FIRESTORE_PATHS.layer(work.cityId, base.layerId), layerDocSchema, {
            ...layer,
            pendingVersion: work.jobId,
            ...stampOf(work.createdBy, work.now),
        });
    }
}

/** The new version to start: the city, the placed base and its job, and who asks. */
export interface Restitch {
    readonly cityId: string;
    readonly base: LayerVersionDoc;
    readonly job: JobDoc;
    /** The base's `help`, which `restitchable` found (its overview mosaic). */
    readonly help: HelpItem;
    readonly uid: string;
}

/** Starts the series' new version (its job id is its version id); the busy layer and the budget guard refuse as for any re-run. */
export async function startRestitch(deps: RegeorefDeps, ask: Restitch): Promise<string> {
    const { cityId, base, job, uid } = ask;
    await refuseWhileGuardRed(deps.documents);
    await refuseBusyLayer(deps.documents, cityId, base.layerId, base.jobId);
    const now = deps.clock.now();
    const work: NewWork = {
        cityId,
        jobId: jobIdFor('ar', now, base.layerId),
        type: 'archive-series',
        params: { ...job.params, restitch: true },
        layerId: base.layerId,
        createdBy: uid,
        now,
        runOn: 'local',
        localOnly: true,
        waitReason: 'worker',
    };
    await deps.documents.transaction((transaction) => restitchIn(transaction, base, ask.help, work));
    deps.log.info('archive series stitched again', { uid, cityId, layerId: base.layerId, jobId: work.jobId, basedOn: base.jobId });
    return work.jobId;
}
