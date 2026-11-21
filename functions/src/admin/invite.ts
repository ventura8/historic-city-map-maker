import '../global-options.js';

import {
    FIRESTORE_PATHS,
    INVITE_TTL_DAYS,
    adminDocSchema,
    cityRoleOf,
    inviteDocSchema,
    inviteIdFor,
    normalizeEmail,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityRoles,
    type InviteDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { callerStamp, isBefore } from './records.js';

export type InviteDeps = Pick<Ports, 'documents' | 'config' | 'clock' | 'log'>;

type InviteRequest = CallableRequest<'admins.invite'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the address already administers the city. An admin's document keeps its verified address normalized
 * (`adminRecord`), so one equality query finds it; an admin of other cities only may be invited to this one.
 */
async function administersCity(deps: InviteDeps, email: string, cityId: string): Promise<boolean> {
    const found = await deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema, { where: [['email', '==', email]], limit: 1 });
    return found.documents.some((admin) => cityRoleOf(admin.data.cities, cityId) !== null);
}

/** The cities the invitation grants: those of a pending one, and this city with this role (the latest role wins). */
function invitedCities(pending: InviteDoc | undefined, now: Date, data: InviteRequest): CityRoles {
    const kept = pending !== undefined && isBefore(now, pending.expiresAt) ? pending.cities : undefined;
    return { ...kept, [data.cityId]: data.role };
}

/**
 * `admins.invite` (a city's owner; S-A02-HAPPY, S-A02-BAD-INVALID-EMAIL, S-A02-BAD-NO-ADDRESS-STORED, S-A51-HAPPY):
 * stores `invites/{sha256 of the normalized address}` with the city and the role, the inviter and the expiry
 * (`INVITE_TTL_DAYS`; inviting again resets it), keeping the other cities a pending invitation of the same address
 * names, and answers the admin's address, which the inviter shares; no mail is sent. The address itself is in no
 * document, response or log line; an address that already administers the city → `invite.alreadyAdmin`. An admin of
 * other cities gets this one at their next `admin.session`, a new account at `admin.join`.
 */
async function adminsInvite(deps: InviteDeps, caller: VerifiedCaller, data: InviteRequest): Promise<CallableResponse<'admins.invite'>> {
    const email = normalizeEmail(data.email);
    if (await administersCity(deps, email, data.cityId)) {
        throw new ApiError('apiError.invite.alreadyAdmin');
    }
    const inviteId = await inviteIdFor(email);
    const path = FIRESTORE_PATHS.invite(inviteId);
    const now = deps.clock.now();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    await deps.documents.transaction(async (transaction) => {
        const pending = await transaction.get(path, inviteDocSchema);
        await transaction.set(path, inviteDocSchema, {
            role: 'admin',
            cities: invitedCities(pending, now, data),
            invitedBy: caller.uid,
            createdAt: timestampFromDate(now),
            expiresAt: timestampFromDate(expiresAt),
            ...callerStamp(caller.uid, now),
        });
    });
    deps.log.info('invitation stored', { by: caller.uid, cityId: data.cityId, role: data.role, expiresAt: expiresAt.toISOString() });
    return { inviteId, expiresAt: expiresAt.toISOString(), signInUrl: deps.config.adminUrl };
}

/** The `admins-invite` callable. */
export function inviteFunction(getDeps: () => InviteDeps & CallableDeps) {
    return defineCallable('admins.invite', adminsInvite, getDeps);
}
