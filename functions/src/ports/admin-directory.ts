import type { AdminRole, CityRole } from '@hcm/shared';

/**
 * What one read of `admins/{uid}` says of an admin (M5, `docs/research/M5-interfaces.md` §1.3): the project role and the
 * role in each city. A document without `cities` (from before M5, not migrated yet) has no city role: fail closed.
 */
export interface AdminMembership {
    readonly projectRole: AdminRole;
    /** M13: it has cities and none as staff, so the project's own state is closed to it (`isContributorOnly`). */
    readonly contributorOnly: boolean;
    roleIn(cityId: string): CityRole | null;
}

/** The admins/{uid} documents: an admin's custom claim counts only while this document exists. */
export interface AdminDirectory {
    isAdmin(uid: string): Promise<boolean>;
    /** The admin's membership, or null without a document: one read serves every check of a call. */
    membership(uid: string): Promise<AdminMembership | null>;
}
