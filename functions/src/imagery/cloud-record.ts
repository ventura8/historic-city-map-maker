/**
 * The cloud estimate recorded on a scene (`cloud-estimate.ts`; the owner's report of 2026-11-13): measured from the browse bytes,
 * stored as `cloudEstimate` with the scene ranked again (a frame probably cloudy over the city loses that share), and the
 * whole-city plan written again when the frame is probably cloudy, so its row warns before anything is imported or bought.
 * Never fails the browse copy it follows: a frame that cannot be measured stays unmeasured, logged by code.
 */
import { CLOUDY_CITY_PERCENT, FIRESTORE_PATHS, cityDocSchema, usgsSceneDocSchema, type UsgsSceneDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { GREY_EDGE, estimateClouds } from './cloud-estimate.js';
import { rewriteDatePlan } from './join-plan.js';
import { IMAGERY_WRITER, stampOf } from './records.js';
import { rankNow } from './scene-rank.js';

export type CloudDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'images'>;

/** Stores the estimate and the new rank, the admin's triage meanwhile kept. */
type Measured = UsgsSceneDoc & Pick<Required<UsgsSceneDoc>, 'cloudEstimate'>;

async function record(deps: CloudDeps, cityId: string, measured: Measured): Promise<void> {
    const rank = await rankNow(deps, cityId, measured);
    const path = FIRESTORE_PATHS.usgsScene(cityId, measured.entityId);
    await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        if (scene !== undefined) {
            const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
            await transaction.set(path, usgsSceneDocSchema, { ...scene, cloudEstimate: measured.cloudEstimate, rank, ...stamp });
        }
    });
}

export interface Measure {
    readonly cityId: string;
    readonly scene: UsgsSceneDoc;
    /** Reads the browse image's bytes. */
    readonly bytes: () => Promise<Uint8Array>;
    /** False when the caller writes the plan itself afterwards (the harvest). */
    readonly rewritePlan: boolean;
}

async function measure(deps: CloudDeps, { cityId, scene, bytes, rewritePlan }: Measure): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    const estimate = city === undefined ? undefined : estimateClouds(await deps.images.grey(await bytes(), GREY_EDGE), scene, city.bounds);
    if (estimate === undefined) {
        deps.log.info('cloud estimate skipped', { cityId, entityId: scene.entityId, code: 'imagery.cloudUnmeasured' });
        return;
    }
    await record(deps, cityId, { ...scene, cloudEstimate: estimate });
    deps.log.info('cloud estimate recorded', { cityId, entityId: scene.entityId, percent: estimate.percent });
    if (rewritePlan && estimate.percent >= CLOUDY_CITY_PERCENT) {
        await rewriteDatePlan(deps, cityId);
    }
}

/** Measures and records the clouds over the city on the scene's browse image (`bytes` reads it); a failure is logged, never thrown. */
export async function measureClouds(deps: CloudDeps, measured: Measure): Promise<void> {
    const { cityId, scene } = measured;
    await measure(deps, measured).catch((error: unknown) => {
        deps.log.warn('cloud estimate failed', {
            cityId,
            entityId: scene.entityId,
            code: 'imagery.cloudEstimateFailed',
            error: String(error),
        });
    });
}
