import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityRoleOf,
    inviteDocSchema,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type CityRole,
    type InviteDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { cityMembers, type AdminEntry } from '../api/memberships.js';
import type { Ports } from '../ports/index.js';
import { isBefore, isoTime } from './records.js';

export type ListDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type AdminsList = CallableResponse<'admins.list'>;

/** `cityAdminsListResponseSchema` lists at most this many admins and as many invitations. */
const MAX_ROWS = 100;

function adminRow(entry: AdminEntry & { readonly role: CityRole }, caller: VerifiedCaller): AdminsList['admins'][number] {
    const { admin } = entry;
    return {
        uid: entry.uid,
        role: entry.role,
        projectOwner: admin.role === 'owner',
        ...(admin.email === undefined ? {} : { email: admin.email }),
        ...(admin.displayName === undefined ? {} : { displayName: admin.displayName }),
        createdAt: isoTime(admin.createdAt),
        self: entry.uid === caller.uid,
    };
}

function inviteRow(inviteId: string, invite: InviteDoc, role: CityRole): AdminsList['invites'][number] {
    return {
        inviteId,
        role,
        invitedBy: invite.invitedBy,
        createdAt: isoTime(invite.createdAt),
        expiresAt: isoTime(invite.expiresAt),
    };
}

/** The city's pending invitations (each by its hash only: an invitation never stores its address), oldest first. */
async function cityInvites(deps: ListDeps, cityId: string): Promise<AdminsList['invites']> {
    const invites = await deps.documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { orderBy: ['createdAt', 'asc'] });
    if (invites.invalid.length > 0) {
        deps.log.warn('invitations left out of the list', { paths: invites.invalid.map((document) => document.path) });
    }
    const now = deps.clock.now();
    return invites.documents.flatMap((document) => {
        const role = cityRoleOf(document.data.cities, cityId);
        return role === null || !isBefore(now, document.data.expiresAt) ? [] : [inviteRow(document.id, document.data, role)];
    });
}

/**
 * `admins.list` (a city's members; S-A02-*, S-A51-HAPPY): the city's admins with their role in it, oldest first, the
 * project's owner marked, and the invitations to the city; expired invitations wait for `ops.tick` and are not shown.
 * An admin of other cities only is never listed (S-A51-BAD-OTHER-CITY-CALLABLE).
 */
async function adminsList(deps: ListDeps, caller: VerifiedCaller, data: CallableRequest<'admins.list'>): Promise<AdminsList> {
    const members = (await cityMembers(deps.documents, data.cityId)).sort(
        (a, b) => timestampToDate(a.admin.createdAt).getTime() - timestampToDate(b.admin.createdAt).getTime(),
    );
    return {
        admins: members.slice(0, MAX_ROWS).map((entry) => adminRow(entry, caller)),
        invites: (await cityInvites(deps, data.cityId)).slice(0, MAX_ROWS),
    };
}

/** The `admins-list` callable. */
export function listFunction(getDeps: () => ListDeps & CallableDeps) {
    return defineCallable('admins.list', adminsList, getDeps);
}
