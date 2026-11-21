import '../global-options.js';

import {
    FIRESTORE_PATHS,
    adminDocSchema,
    inviteDocSchema,
    inviteIdFor,
    type AdminDoc,
    type AdminRole,
    type CallableResponse,
    type CityRoles,
    type InviteDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { mergedRoles } from './memberships.js';
import { adminRecord, displayNameOf, isBefore } from './records.js';

export type JoinDeps = Pick<Ports, 'documents' | 'auth' | 'clock' | 'log'>;

interface Joining {
    readonly caller: VerifiedCaller;
    readonly email: string;
    readonly displayName: string | undefined;
    readonly now: Date;
}

/**
 * The joining account's `admins/{uid}`: an owner who also had an invitation stays the owner; M5: the invitation's cities
 * join the account's own (an invitation from before M5 names none, and `admin.session` then gives the account every
 * city, as every admin had before M5).
 */
function joinedAdmin(joining: Joining, invite: InviteDoc, existing: AdminDoc | undefined): AdminDoc {
    const { caller, email, displayName, now } = joining;
    const role = existing?.role ?? invite.role;
    const record = adminRecord({
        uid: caller.uid,
        email,
        displayName,
        now,
        role,
        invitedBy: invite.invitedBy,
        createdAt: existing?.createdAt,
    });
    const cities = joinedCities(invite, existing);
    return cities === undefined ? record : { ...record, cities };
}

function joinedCities(invite: InviteDoc, existing: AdminDoc | undefined): CityRoles | undefined {
    return invite.cities === undefined ? existing?.cities : mergedRoles(existing?.cities, invite.cities);
}

/**
 * In one transaction: the invitation of the caller's address must exist and be unexpired; `admins/{uid}` is written
 * and the invitation deleted, so it can be used once only.
 */
async function acceptInvitation(deps: JoinDeps, joining: Joining): Promise<AdminRole> {
    const invitePath = FIRESTORE_PATHS.invite(await inviteIdFor(joining.email));
    const adminPath = FIRESTORE_PATHS.admin(joining.caller.uid);
    return deps.documents.transaction(async (transaction) => {
        const invite = await transaction.get(invitePath, inviteDocSchema);
        if (invite === undefined) {
            throw new ApiError('apiError.invite.notFound');
        }
        if (!isBefore(joining.now, invite.expiresAt)) {
            throw new ApiError('apiError.invite.expired');
        }
        const record = joinedAdmin(joining, invite, await transaction.get(adminPath, adminDocSchema));
        await transaction.set(adminPath, adminDocSchema, record);
        await transaction.delete(invitePath);
        return record.role;
    });
}

/**
 * `admin.join` (any verified Google account, App Check consumed; S-A02-HAPPY, S-A02-BAD-EXPIRED-INVITE,
 * S-A02-BAD-OTHER-ADDRESS, S-A51-HAPPY): an invited account becomes an admin of the cities its invitation names. The caller's verified address is hashed to find the
 * invitation (missing → `invite.notFound`, expired → `invite.expired`); the claim is set after the transaction and the
 * app refreshes its ID token.
 */
async function adminJoin(deps: JoinDeps, caller: VerifiedCaller): Promise<CallableResponse<'admin.join'>> {
    if (caller.email === undefined) {
        throw new ApiError('apiError.invite.notFound');
    }
    const displayName = await displayNameOf(deps.auth, caller.uid);
    const role = await acceptInvitation(deps, { caller, email: caller.email, displayName, now: deps.clock.now() });
    await deps.auth.setAdminClaim(caller.uid, true);
    deps.log.info('invitation accepted', { uid: caller.uid, role });
    return { role, refreshToken: true };
}

/** The `admin-join` callable. */
export function joinFunction(getDeps: () => JoinDeps & CallableDeps) {
    return defineCallable('admin.join', adminJoin, getDeps);
}
