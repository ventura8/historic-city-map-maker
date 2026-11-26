/**
 * The `invites` and `users` steps of `ops.tick` (`docs/research/M2-interfaces.md` §3.7; security review §5, GDPR):
 * expired invitations are deleted, and so are the Firebase Auth accounts that signed in but never became admins,
 * once `STALE_USER_HOURS` have passed. Never an admin, never the owner, never an account with a pending invitation.
 */
import {
    FIRESTORE_PATHS,
    STALE_USER_HOURS,
    adminDocSchema,
    inviteDocSchema,
    inviteIdFor,
    ownerDocSchema,
    timestampToDate,
} from '@hcm/shared';

import type { AuthUser } from '../ports/auth-admin.js';
import type { Ports } from '../ports/index.js';

export type AccountsDeps = Pick<Ports, 'log' | 'documents' | 'auth'>;

const HOUR_MS = 3_600_000;

/** The `invites` step: deletes every invitation whose `expiresAt` has passed; returns how many. */
export async function expireInvites(deps: AccountsDeps, now: Date): Promise<number> {
    const invites = await deps.documents.query(FIRESTORE_PATHS.invites, inviteDocSchema);
    const expired = invites.documents.filter(({ data }) => timestampToDate(data.expiresAt) <= now);
    for (const invite of expired) {
        await deps.documents.delete(invite.path);
    }
    return expired.length;
}

/** Whom the cleanup never touches: every `admins/{uid}` (a document that no longer validates too) and the owner. */
async function protectedUids(deps: AccountsDeps): Promise<ReadonlySet<string>> {
    const [admins, owner] = await Promise.all([
        deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema),
        deps.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema),
    ]);
    const uids = [...admins.documents, ...admins.invalid].map((admin) => admin.id);
    return new Set(owner === undefined ? uids : [...uids, owner.uid]);
}

/** The ids of the invitations still open (`inviteIdFor` of the invited address; a refused document counts as open). */
async function openInvites(deps: AccountsDeps): Promise<ReadonlySet<string>> {
    const invites = await deps.documents.query(FIRESTORE_PATHS.invites, inviteDocSchema);
    return new Set([...invites.documents, ...invites.invalid].map((invite) => invite.id));
}

interface Keep {
    readonly uids: ReadonlySet<string>;
    readonly invites: ReadonlySet<string>;
    readonly createdBefore: Date;
}

async function isStale(user: AuthUser, keep: Keep): Promise<boolean> {
    if (keep.uids.has(user.uid) || user.createdAt > keep.createdBefore) {
        return false;
    }
    return user.email === undefined || !keep.invites.has(await inviteIdFor(user.email));
}

async function removeFromPage(deps: AccountsDeps, users: readonly AuthUser[], keep: Keep): Promise<number> {
    let removed = 0;
    for (const user of users) {
        if (await isStale(user, keep)) {
            await deps.auth.deleteUser(user.uid);
            deps.log.info('stale account deleted', { uid: user.uid });
            removed += 1;
        }
    }
    return removed;
}

/** The `users` step: deletes the stale accounts page by page; returns how many. */
export async function removeStaleUsers(deps: AccountsDeps, now: Date): Promise<number> {
    const keep: Keep = {
        uids: await protectedUids(deps),
        invites: await openInvites(deps),
        createdBefore: new Date(now.getTime() - STALE_USER_HOURS * HOUR_MS),
    };
    let removed = 0;
    let pageToken: string | undefined;
    do {
        const page = await deps.auth.listUsers(pageToken);
        removed += await removeFromPage(deps, page.users, keep);
        pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return removed;
}
