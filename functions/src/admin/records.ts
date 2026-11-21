/**
 * Helpers of the `admin.*` and `admins.*` handlers (`docs/research/M2-interfaces.md` §3.1): times as responses carry
 * them, the audit stamp of a callable, and the account details an `admins/{uid}` document keeps.
 */
import { normalizeEmail, timestampFromDate, timestampToDate, type AdminDoc, type AdminRole, type TimestampLike } from '@hcm/shared';

import type { AuthAdmin } from '../ports/auth-admin.js';

/** `adminDocSchema.displayName` keeps at most this many characters. */
const DISPLAY_NAME_MAX = 200;

/** A stored time as the ISO 8601 string of a response. */
export function isoTime(value: TimestampLike): string {
    return timestampToDate(value).toISOString();
}

/** A callable's audit stamp: the calling admin and the handler's clock. */
export function callerStamp(uid: string, now: Date): Pick<AdminDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: uid, updatedAt: timestampFromDate(now) };
}

/** True while an invitation (or anything with an expiry) is still valid at `now`. */
export function isBefore(now: Date, expiresAt: TimestampLike): boolean {
    return now.getTime() < timestampToDate(expiresAt).getTime();
}

/** The account's Google display name as `adminDocSchema` stores it (trimmed, cut to 200), or undefined. */
export async function displayNameOf(auth: AuthAdmin, uid: string): Promise<string | undefined> {
    const name = (await auth.getUser(uid))?.displayName?.trim().slice(0, DISPLAY_NAME_MAX).trim() ?? '';
    return name === '' ? undefined : name;
}

/** What `admins/{uid}` says of an account becoming an admin (`admin.claim`, `admin.join`). */
export interface NewAdmin {
    readonly uid: string;
    /** The verified address of the caller's ID token. */
    readonly email: string;
    readonly role: AdminRole;
    readonly displayName: string | undefined;
    readonly invitedBy?: string;
    /** The existing document's `createdAt`, kept when an admin claims ownership or joins again. */
    readonly createdAt: TimestampLike | undefined;
    readonly now: Date;
}

/**
 * The `admins/{uid}` document of a new (or re-confirmed) admin. The address is the verified one of the ID token,
 * stored normalized so `admins.invite` can tell an existing admin (`invite.alreadyAdmin`); it is shown in the admins
 * list and deleted with the document.
 */
export function adminRecord(admin: NewAdmin): AdminDoc {
    return {
        role: admin.role,
        email: normalizeEmail(admin.email),
        ...(admin.displayName === undefined ? {} : { displayName: admin.displayName }),
        ...(admin.invitedBy === undefined ? {} : { invitedBy: admin.invitedBy }),
        createdAt: admin.createdAt ?? timestampFromDate(admin.now),
        ...callerStamp(admin.uid, admin.now),
    };
}
