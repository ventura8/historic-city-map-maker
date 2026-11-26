import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityRoleOf,
    inboxItemDocSchema,
    inviteDocSchema,
    pushDeviceDocSchema,
    type CallableRequest,
    type CallableResponse,
    type Schema,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { changeCityRole, withoutCity } from './memberships.js';
import { callerStamp } from './records.js';

export type RevokeDeps = Pick<Ports, 'documents' | 'auth' | 'clock' | 'log'>;

type RevokeRequest = CallableRequest<'admins.revoke'>;

/** An account deleted from Firebase Auth has no claim and no session left: revoking it is done once its document goes. */
function ignoreMissingAccount(error: unknown): undefined {
    if (error instanceof UpstreamError && error.failure === 'notFound') {
        return undefined;
    }
    throw error;
}

/**
 * The city leaves the invitation (S-A51-HAPPY): an invitation that names no other city is deleted, one to other cities
 * keeps them. An invitation that does not name the city → `apiError.notFound` (another city's is not this owner's).
 */
async function revokeInvite(deps: RevokeDeps, caller: VerifiedCaller, cityId: string, inviteId: string): Promise<void> {
    const path = FIRESTORE_PATHS.invite(inviteId);
    await deps.documents.transaction(async (transaction) => {
        const invite = await transaction.get(path, inviteDocSchema);
        if (invite === undefined || cityRoleOf(invite.cities, cityId) === null) {
            throw new ApiError('apiError.notFound');
        }
        const cities = withoutCity(invite.cities, cityId);
        if (Object.keys(cities).length === 0) {
            await transaction.delete(path);
            return;
        }
        await transaction.set(path, inviteDocSchema, { ...invite, cities, ...callerStamp(caller.uid, deps.clock.now()) });
    });
}

/** How many documents one page of a removed admin's collection deletes. */
const FORGET_BATCH = 100;

/** Deletes every document of one of the removed admin's collections (the invalid ones too), a page at a time. */
async function deleteCollection<T>(deps: RevokeDeps, collection: string, schema: Schema<T>): Promise<void> {
    let deleted: number;
    do {
        const page = await deps.documents.query(collection, schema, { limit: FORGET_BATCH });
        const paths = [...page.documents, ...page.invalid].map((document) => document.path);
        for (const path of paths) {
            await deps.documents.delete(path);
        }
        deleted = paths.length;
    } while (deleted === FORGET_BATCH);
}

/**
 * M4: the removed admin's push devices, inbox and notification settings go with them, so their browsers get no more
 * notifications (layer names, scene names, a paused budget) and an account invited again starts with none.
 */
async function forgetNotifications(deps: RevokeDeps, uid: string): Promise<void> {
    await deleteCollection(deps, FIRESTORE_PATHS.pushDevices(uid), pushDeviceDocSchema);
    await deleteCollection(deps, FIRESTORE_PATHS.inbox(uid), inboxItemDocSchema);
    await deps.documents.delete(FIRESTORE_PATHS.notifySettings(uid));
}

/**
 * M4 first: the admin's push devices, inbox and notification settings, while the account is still an admin's, so its open
 * pages see their inbox emptied (the unread badge's listener) rather than a listener denied mid-edit, and a Save they
 * try next is refused by the rules as before (S-A20-BAD-REVOKED-WHILE-EDITING; `docs/LESSONS.md` 218). Then the
 * document: the access rule and the security rules require it, so the removed admin is denied from then on
 * (S-A20-BAD-ADMIN-REMOVED); then the claim and the refresh tokens, so the next token refresh carries no claim.
 */
async function removeAdmin(deps: RevokeDeps, uid: string): Promise<void> {
    await forgetNotifications(deps, uid);
    await deps.documents.delete(FIRESTORE_PATHS.admin(uid));
    await deps.auth.setAdminClaim(uid, false).catch(ignoreMissingAccount);
    await deps.auth.revokeSessions(uid).catch(ignoreMissingAccount);
}

/**
 * The admin leaves the city (S-A51-HAPPY): never oneself (`revoke.self`), in one transaction with the city's owners
 * (`changeCityRole`: an account that is not the city's admin → `apiError.notFound`, the city's last owner →
 * `apiError.city.lastOwner`, the project's owner → `apiError.city.projectOwnerStays`). An admin of no other city stops
 * being an admin at all (their document, claim, sessions and notifications go, as in M2 to M4); the project's owner keeps
 * their document even without a city.
 */
async function revokeAdmin(deps: RevokeDeps, caller: VerifiedCaller, cityId: string, uid: string): Promise<void> {
    if (uid === caller.uid) {
        throw new ApiError('apiError.revoke.self');
    }
    const { after, roles } = await changeCityRole(deps, { cityId, uid, role: null, by: caller.uid });
    if (Object.keys(roles).length === 0 && after.role !== 'owner') {
        await removeAdmin(deps, uid);
    }
}

/**
 * `admins.revoke` (a city's owner; S-A02-BAD-REVOKE, S-A02-BAD-LAST-ADMIN, S-A51-HAPPY): removes an
 * admin from the city or the city from a pending invitation.
 */
async function adminsRevoke(deps: RevokeDeps, caller: VerifiedCaller, data: RevokeRequest): Promise<CallableResponse<'admins.revoke'>> {
    if (data.kind === 'invite') {
        await revokeInvite(deps, caller, data.cityId, data.inviteId);
    } else {
        await revokeAdmin(deps, caller, data.cityId, data.uid);
    }
    deps.log.info('admin access revoked', { by: caller.uid, cityId: data.cityId, kind: data.kind });
    return { revoked: true };
}

/** The `admins-revoke` callable. */
export function revokeFunction(getDeps: () => RevokeDeps & CallableDeps) {
    return defineCallable('admins.revoke', adminsRevoke, getDeps);
}
