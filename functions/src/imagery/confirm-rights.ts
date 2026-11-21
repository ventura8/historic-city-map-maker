import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerVersionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type LayerVersionDoc,
    type Rights,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { stampOf } from './records.js';

/**
 * `imagery.confirmRights` (the city's owner; `docs/research/M20-import-local.md` §7; S-A120-*-CONFIRM-*): a version whose
 * rights wait (`needs-confirmation`) becomes clear with licence `permission`, the owner's words and the server's clock.
 * Approve then publishes it; without this call it stays private (`apiError.imagery.rightsUnconfirmed`). Empty words, a
 * version not waiting for approval, or rights that do not wait, are refused.
 */
type Request = CallableRequest<'imagery.confirmRights'>;

type ConfirmDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** Words that name who granted the permission: empty or whitespace alone never confirms. */
function confirmedByOf(request: Request): string {
    const by = request.confirmedBy.trim();
    if (by === '') {
        throw new ApiError('apiError.imagery.rightsUnconfirmed');
    }
    return by;
}

/** Rights waiting for the owner, or `apiError.imagery.rightsUnconfirmed`. */
function waitingRights(version: LayerVersionDoc): Rights {
    const { rights } = version;
    if (rights?.state !== 'needs-confirmation') {
        throw new ApiError('apiError.imagery.rightsUnconfirmed');
    }
    return rights;
}

/** Awaiting approval with rights that wait; every other version state is `apiError.imagery.versionState`. */
async function confirmVersion(deps: ConfirmDeps, caller: VerifiedCaller, request: Request): Promise<Date> {
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const by = confirmedByOf(request);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(path, layerVersionDocSchema);
        if (version === undefined) {
            throw new ApiError('apiError.notFound');
        }
        if (version.state !== 'awaiting_approval') {
            throw new ApiError('apiError.imagery.versionState');
        }
        const rights = waitingRights(version);
        const confirmedAt = timestampFromDate(now);
        const cleared: Rights = { ...rights, licence: 'permission', state: 'clear', confirmedBy: by, confirmedAt };
        await transaction.set(path, layerVersionDocSchema, { ...version, rights: cleared, ...stampOf(caller.uid, now) });
    });
    return now;
}

async function imageryConfirmRights(
    deps: ConfirmDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.confirmRights'>> {
    const confirmedAt = await confirmVersion(deps, caller, request);
    deps.log.info('layer version rights confirmed', {
        uid: caller.uid,
        cityId: request.cityId,
        versionId: request.versionId,
    });
    return { state: 'clear', confirmedAt: confirmedAt.toISOString() };
}

/** The `imagery-confirmRights` callable. */
export function confirmRightsFunction(getDeps: () => ConfirmDeps & CallableDeps) {
    return defineCallable('imagery.confirmRights', imageryConfirmRights, getDeps);
}
