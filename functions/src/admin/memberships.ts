/**
 * The M5 memberships of the admins callables (`docs/research/M5-interfaces.md` §1.2, §1.7): how an invitation's cities
 * join an admin's (`admin.join` for a new admin, `admin.session` for an admin invited to one more city, the invitation
 * of their verified address as join reads it; a role granted twice keeps the stronger one), and every change of a role
 * in a city (`admins.setRole`, `admins.revoke`), one transaction each: a city keeps one owner at least, and the
 * project's owner stays an owner of every city they belong to.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityRoleOf,
    inviteDocSchema,
    inviteIdFor,
    strongerRole,
    type AdminDoc,
    type CityRole,
    type CityRoles,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { cityMembers } from '../api/memberships.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { callerStamp, isBefore } from './records.js';

export type InvitedCitiesDeps = Pick<Ports, 'documents' | 'clock'>;

/** `current` with every city of `added`, each at the stronger of its two roles. */
export function mergedRoles(current: CityRoles | undefined, added: CityRoles): Record<string, CityRole> {
    const merged: Record<string, CityRole> = { ...current };
    for (const [cityId, role] of Object.entries(added)) {
        merged[cityId] = strongerRole(merged[cityId], role);
    }
    return merged;
}

/**
 * An admin's pending invitation to more cities, accepted: its cities merged into `admins/{uid}` and the invitation
 * deleted, in one transaction. Undefined (nothing written) without an admin document or an unexpired invitation that
 * names cities.
 */
export async function acceptInvitedCities(deps: InvitedCitiesDeps, uid: string, email: string): Promise<AdminDoc | undefined> {
    const invitePath = FIRESTORE_PATHS.invite(await inviteIdFor(email));
    const adminPath = FIRESTORE_PATHS.admin(uid);
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction) => {
        const invite = await transaction.get(invitePath, inviteDocSchema);
        const admin = await transaction.get(adminPath, adminDocSchema);
        if (admin === undefined || invite?.cities === undefined || !isBefore(now, invite.expiresAt)) {
            return undefined;
        }
        const joined: AdminDoc = { ...admin, cities: mergedRoles(admin.cities, invite.cities), ...callerStamp(uid, now) };
        await transaction.set(adminPath, adminDocSchema, joined);
        await transaction.delete(invitePath);
        return joined;
    });
}

/** `roles` without `cityId`. */
export function withoutCity(roles: CityRoles | undefined, cityId: string): Record<string, CityRole> {
    return Object.fromEntries(Object.entries(roles ?? {}).filter(([id]) => id !== cityId));
}

/** One change of an admin's role in a city: `role` null takes the city away; `by` is the caller, one of its owners. */
export interface RoleChange {
    readonly cityId: string;
    readonly uid: string;
    readonly role: CityRole | null;
    readonly by: string;
}

/** The admin's document before and after the change, and their cities after it. */
export interface RoleChanged {
    readonly before: AdminDoc;
    readonly after: AdminDoc;
    readonly roles: Readonly<Record<string, CityRole>>;
}

export type RoleChangeDeps = Pick<Ports, 'documents' | 'clock'>;

/** Whether `uid`'s document, read through `transaction`, owns `cityId`. */
async function ownsCity(transaction: DocumentTransaction, uid: string, cityId: string): Promise<boolean> {
    return cityRoleOf((await transaction.get(FIRESTORE_PATHS.admin(uid), adminDocSchema))?.cities, cityId) === 'owner';
}

/**
 * `apiError.city.lastOwner` when the change would leave the city without an owner. The owners a query found before the
 * transaction (a query cannot run in one) are read again through it, so a concurrent change to any of them makes one of
 * the two transactions run again and see the other's write (`docs/LESSONS.md` 243). An owner made meanwhile is not
 * counted: the refusal errs on the side of keeping one.
 */
async function refuseLastOwner(transaction: DocumentTransaction, owners: readonly string[], change: RoleChange): Promise<void> {
    for (const uid of owners) {
        if (uid !== change.uid && (await ownsCity(transaction, uid, change.cityId))) {
            return;
        }
    }
    throw new ApiError('apiError.city.lastOwner');
}

/** The target's document and role; `apiError.notFound` for an account that is not the city's admin. */
function cityAdmin(admin: AdminDoc | undefined, cityId: string): { readonly admin: AdminDoc; readonly role: CityRole } {
    const role = cityRoleOf(admin?.cities, cityId);
    if (admin === undefined || role === null) {
        throw new ApiError('apiError.notFound');
    }
    return { admin, role };
}

/** `roles` with `cityId` at `role`, or without it. */
function rolesWith(roles: CityRoles | undefined, cityId: string, role: CityRole | null): Record<string, CityRole> {
    return role === null ? withoutCity(roles, cityId) : { ...roles, [cityId]: role };
}

/**
 * The checks of a role change, read through `transaction`: the caller still owns the city (`apiError.city.notOwner`),
 * the target is its admin (`apiError.notFound`), the project's owner stays an owner of every city they belong to
 * (`apiError.city.projectOwnerStays`: the one account that can always reach a city, so no city is ever left to the
 * Firestore console), and an owner who stops being one leaves another (`refuseLastOwner`).
 */
async function checkedTarget(transaction: DocumentTransaction, owners: readonly string[], change: RoleChange): Promise<AdminDoc> {
    if (!(await ownsCity(transaction, change.by, change.cityId))) {
        throw new ApiError('apiError.city.notOwner', { cityId: change.cityId });
    }
    const { admin, role } = cityAdmin(await transaction.get(FIRESTORE_PATHS.admin(change.uid), adminDocSchema), change.cityId);
    if (role === 'owner' && change.role !== 'owner') {
        if (admin.role === 'owner') {
            throw new ApiError('apiError.city.projectOwnerStays');
        }
        await refuseLastOwner(transaction, owners, change);
    }
    return admin;
}

/**
 * An admin's role in one city changed (`admins.setRole`) or taken away (`admins.revoke`), their other cities untouched,
 * in one transaction that reads the caller, the target and every owner of the city before it writes: two owners demoting
 * or removing each other at once can no longer leave the city without one, and a change made from a stale read can no
 * longer bring back a membership another owner just took away (`docs/LESSONS.md` 243). The same role again writes
 * nothing.
 */
export async function changeCityRole(deps: RoleChangeDeps, change: RoleChange): Promise<RoleChanged> {
    const owners = (await cityMembers(deps.documents, change.cityId))
        .filter((member) => member.role === 'owner')
        .map((member) => member.uid);
    const path = FIRESTORE_PATHS.admin(change.uid);
    return deps.documents.transaction(async (transaction) => {
        const before = await checkedTarget(transaction, owners, change);
        const roles = rolesWith(before.cities, change.cityId, change.role);
        if (cityRoleOf(before.cities, change.cityId) === change.role) {
            return { before, after: before, roles };
        }
        const after: AdminDoc = { ...before, cities: roles, ...callerStamp(change.by, deps.clock.now()) };
        await transaction.set(path, adminDocSchema, after);
        return { before, after, roles };
    });
}
