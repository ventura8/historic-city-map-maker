import '../global-options.js';

import {
    FIRESTORE_PATHS,
    timestampFromDate,
    usgsSceneDocSchema,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { rewriteDatePlan } from './join-plan.js';
import { stampOf } from './records.js';

/**
 * `imagery.markScene` (the owner's report of 2026-11-13: "This scan is useless, too many clouds", a 1964 frame the whole-city plan
 * kept offering to buy): an editor sets a scene aside as not useful with why (clouds, haze or blur, wrong area, other), or takes it
 * back. Marked, the scene is `rejected` with `unusable` (the plan, which leaves rejected scenes out, and the list's Hide not useful
 * read that); taken back, a `candidate` again. The plan is written again at once, so it says what else would complete that date.
 * An imported scene is refused (`apiError.imagery.alreadyImported`: its layer is the thing to delete or reject). Deploys at 512 MiB
 * (`CALLABLE_MEMORY`: the plan rewrite used 259 MiB on 256 MiB; Crashes 2026-11-20).
 */
export type MarkSceneDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.markScene'>;

/** The scene marked, or with its mark taken back (a scene never marked is just a candidate again). */
function markedScene(scene: UsgsSceneDoc, request: Request, caller: VerifiedCaller, now: Date): UsgsSceneDoc {
    const stamp = stampOf(caller.uid, now);
    if (request.unusable === null) {
        return { ...omit(scene, ['unusable']), status: 'candidate', ...stamp };
    }
    return { ...scene, status: 'rejected', unusable: { reason: request.unusable, at: timestampFromDate(now) }, ...stamp };
}

async function markScene(deps: MarkSceneDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.markScene'>> {
    const path = FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId);
    const marked = await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        if (scene === undefined) {
            throw new ApiError('apiError.notFound');
        }
        if (scene.status === 'imported') {
            throw new ApiError('apiError.imagery.alreadyImported');
        }
        const next = markedScene(scene, request, caller, deps.clock.now());
        await transaction.set(path, usgsSceneDocSchema, next);
        return next;
    });
    deps.log.info('scene marked', { cityId: request.cityId, entityId: request.entityId, unusable: request.unusable ?? 'none' });
    await rewriteDatePlan(deps, request.cityId).catch((error: unknown) => {
        deps.log.warn('date plan not rewritten', { cityId: request.cityId, code: 'imagery.planNotRewritten', error: String(error) });
    });
    return { status: marked.status === 'rejected' ? 'rejected' : 'candidate' };
}

/** The `imagery-markScene` callable. */
export function markSceneFunction(getDeps: () => MarkSceneDeps & CallableDeps) {
    return defineCallable('imagery.markScene', markScene, getDeps);
}
