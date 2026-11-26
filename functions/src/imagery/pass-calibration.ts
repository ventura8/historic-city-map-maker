/**
 * M9 (`docs/research/M9-calibration.md` §2): frames of one mission, camera and date share their error, so a `locate` that ended
 * proved leaves its measured model at `cities/{city}/imageryPasses/{key}` and the pass's next frame looks there first
 * (`pipeline/src/hcm_pipeline/steps/locate.py` reads it; a wrong one only falls through to the full search). A place to look, never
 * evidence: it has no client rule, nothing else reads it.
 */
import {
    FIRESTORE_PATHS,
    imageryPassDocSchema,
    isId,
    layerVersionDocSchema,
    passKeyOf,
    timestampFromDate,
    type Calibration,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, versionIdOf } from './records.js';

export type PassDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

function locateDone(job: JobDoc | undefined): boolean {
    return job?.steps?.['locate']?.status === 'done';
}

/** This write of a job is the one that ended its `locate`. */
export function locateEnded(before: JobDoc | undefined, after: JobDoc): boolean {
    return locateDone(after) && !locateDone(before);
}

/** The measured model of a frame the proof accepted (a refused frame has a refusal and `how: 'none'`). */
function provedModel(calibration: Calibration | undefined): Calibration['model'] {
    const proved = calibration !== undefined && calibration.how !== 'none' && calibration.refusal === undefined;
    return proved ? calibration.model : undefined;
}

interface Frame {
    readonly key: string;
    readonly entityId: string;
    readonly date: string;
}

/** A USGS frame with its pass's key, when its entity id reads as one and makes a document id. */
function frameOf(source: LayerVersionDoc['source']): Frame | undefined {
    if (source?.kind !== 'usgs') {
        return undefined;
    }
    const key = passKeyOf(source.entityId, source.acquisitionDate);
    return key !== undefined && isId(key) ? { key, entityId: source.entityId, date: source.acquisitionDate } : undefined;
}

/** Writes the pass's last proved model when this job's frame was proved; a frame nothing proved leaves the pass as it was. */
export async function recordProvedPass(deps: PassDeps, cityId: string, jobId: string, job: JobDoc): Promise<boolean> {
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job)), layerVersionDocSchema);
    const model = provedModel(version?.calibration);
    const frame = frameOf(version?.source);
    if (model === undefined || frame === undefined) {
        return false;
    }
    await deps.documents.set(FIRESTORE_PATHS.imageryPass(cityId, frame.key), imageryPassDocSchema, {
        model,
        entityId: frame.entityId,
        date: frame.date,
        updatedBy: IMAGERY_WRITER,
        updatedAt: timestampFromDate(deps.clock.now()),
    });
    deps.log.info('pass recorded', { cityId, jobId, key: frame.key });
    return true;
}
