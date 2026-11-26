import { timestampFromDate, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { recordFailedAttempt } from './attempts.js';
import { SECRET_FAILURES, upstream } from './failures.js';
import { commitStatus, defined, nextSecretsRev, stampOf, withoutReason } from './records.js';
import { checkUsgs, usgsRecord } from './usgs-check.js';
import { toSetupStatusView } from './view.js';

export type SaveUsgsDeps = Pick<Ports, 'documents' | 'secrets' | 'usgs' | 'clock' | 'log'>;

type Request = CallableRequest<'setup.saveUsgs'>;
type Response = CallableResponse<'setup.saveUsgs'>;

/** The expiry the admin chose in ERS (a date) as the first instant of that day, UTC. */
function expiryOf(expiresOn: string | undefined): ReturnType<typeof timestampFromDate> | undefined {
    return expiresOn === undefined ? undefined : timestampFromDate(new Date(`${expiresOn}T00:00:00.000Z`));
}

async function store(deps: SaveUsgsDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const outcome = await checkUsgs(deps.usgs, request.username, request.applicationToken);
    await upstream(deps.secrets.write('usgs-username', request.username), SECRET_FAILURES);
    await upstream(deps.secrets.write('usgs-app-token', request.applicationToken), SECRET_FAILURES);
    const now = deps.clock.now();
    const tokenExpiresAt = expiryOf(request.expiresOn);
    const status = await commitStatus(deps.documents, stampOf(caller.uid, deps), (current) => ({
        ...current,
        // M6 setup-ux: a new token keeps the date the approval has been awaited since (S-A59-HAPPY-APPROVAL-PENDING).
        usgs: usgsRecord(outcome, now, {
            ...defined('tokenExpiresAt', tokenExpiresAt),
            ...defined('pendingSince', current.usgs?.pendingSince),
        }),
        secretsRev: nextSecretsRev(current),
    }));
    deps.log.info('usgs credentials saved', { uid: caller.uid, state: outcome.state });
    return { usgs: toSetupStatusView(status, now).usgs };
}

/**
 * `setup.saveUsgs` (admin, App Check consumed; M2-interfaces §3.3, onboarding review §2C, scenario A07): checks the
 * ERS username and application token with USGS M2M, then stores both in Secret Manager only and the health record in
 * `setup/status` (`ok` with the download role; `pending` while USGS has not granted M2M access, checked again every
 * six hours by `ops.tick`; `unavailable` during maintenance, kept and checked later), with the token's expiry for the
 * reminder. A refused username or token stores nothing (`apiError.usgs.credentials`).
 */
export async function saveUsgs(deps: SaveUsgsDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    try {
        return await store(deps, caller, request);
    } catch (error) {
        await recordFailedAttempt(deps, caller, error, {
            area: 'usgs',
            apply: (current, failed) => ({
                ...current,
                usgs: current.usgs === undefined ? failed : { ...withoutReason(current.usgs), ...failed },
            }),
        });
        throw error;
    }
}
