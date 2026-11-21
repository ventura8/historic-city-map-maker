import '../global-options.js';

import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityRoleOf,
    roleRequestDocSchema,
    strongerRole,
    timestampFromDate,
    type AdminDoc,
    type CallableRequest,
    type CallableResponse,
    type RoleRequestDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact, omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { adminRecord, callerStamp } from './records.js';

export type RoleDecideDeps = Pick<Ports, 'documents' | 'auth' | 'clock' | 'log'>;

type Request = CallableRequest<'contribute.decide'>;

interface Decision {
    readonly data: Request;
    readonly by: string;
    readonly now: Date;
}

/** The applicant's document with the role: a new admin gets a plain admin record, the stronger role wins for one who is. */
function adminWithRole(existing: AdminDoc | undefined, request: RoleRequestDoc, decision: Decision): AdminDoc {
    const { data, by, now } = decision;
    const base =
        existing ??
        adminRecord({
            uid: by,
            email: request.email ?? '',
            role: 'admin',
            displayName: request.displayName,
            invitedBy: by,
            createdAt: undefined,
            now,
        });
    const role = strongerRole(cityRoleOf(existing?.cities, data.cityId), request.role);
    return { ...base, cities: { ...existing?.cities, [data.cityId]: role }, ...callerStamp(by, now) };
}

function decided(request: RoleRequestDoc, { data, by, now }: Decision): RoleRequestDoc {
    const at = timestampFromDate(now);
    return {
        ...omit(request, ['note']),
        ...compact<Pick<RoleRequestDoc, 'note'>>({ note: data.note }),
        status: data.decision === 'approve' ? 'approved' : 'refused',
        decidedBy: by,
        decidedAt: at,
        updatedBy: by,
        updatedAt: at,
    };
}

/** The request read and answered, and on approval the role written, in one transaction: an answer is given once. */
async function decide(transaction: DocumentTransaction, decision: Decision): Promise<void> {
    const { data } = decision;
    const path = FIRESTORE_PATHS.roleRequest(data.cityId, data.uid);
    const request = await transaction.get(path, roleRequestDocSchema);
    if (request === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (request.status !== 'pending') {
        throw new ApiError('apiError.contribute.alreadyDecided');
    }
    const adminPath = FIRESTORE_PATHS.admin(data.uid);
    const existing = await transaction.get(adminPath, adminDocSchema);
    if (data.decision === 'approve') {
        await transaction.set(adminPath, adminDocSchema, adminWithRole(existing, request, decision));
    }
    await transaction.set(path, roleRequestDocSchema, decided(request, decision));
}

/**
 * `contribute.decide` (a city's owner; `docs/research/M13-roles.md` §3; S-A92-HAPPY-APPROVE, S-A92-BAD-REFUSED-TOLD,
 * S-A92-BAD-DECIDED-TWICE): approving makes the account a member of this city with the role it asked for (the stronger one if it
 * has one already) and sets the `admin` claim; refusing records the note the applicant reads on the Contribute page.
 */
async function decideRoleRequest(
    deps: RoleDecideDeps,
    caller: VerifiedCaller,
    data: Request,
): Promise<CallableResponse<'contribute.decide'>> {
    await deps.documents.transaction((transaction) => decide(transaction, { data, by: caller.uid, now: deps.clock.now() }));
    if (data.decision === 'approve') {
        await deps.auth.setAdminClaim(data.uid, true);
    }
    deps.log.info('role request decided', { by: caller.uid, cityId: data.cityId, uid: data.uid, decision: data.decision });
    return { status: data.decision === 'approve' ? 'approved' : 'refused' };
}

/** The `contribute-decide` callable. */
export function roleDecideFunction(getDeps: () => RoleDecideDeps & CallableDeps) {
    return defineCallable('contribute.decide', decideRoleRequest, getDeps);
}
