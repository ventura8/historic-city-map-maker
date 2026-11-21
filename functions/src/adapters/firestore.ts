import { cityRoleOf, cityRolesSchema, isContributorOnly } from '@hcm/shared';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';

import type { AdminDirectory, AdminMembership } from '../ports/admin-directory.js';
import type { SetupRecords } from '../ports/setup-records.js';

/**
 * What an `admins/{uid}` document grants, read leniently and failing closed: only `owner` is the project's owner, and
 * `cities` counts only when it is a valid membership map (a document from before M5 has none until it is migrated).
 */
function membershipOf(data: DocumentData): AdminMembership {
    const parsed = cityRolesSchema.safeParse(data['cities']);
    const cities = parsed.success ? parsed.data : undefined;
    return {
        projectRole: data['role'] === 'owner' ? 'owner' : 'admin',
        contributorOnly: isContributorOnly(cities),
        roleIn: (cityId) => cityRoleOf(cities, cityId),
    };
}

/** admins/{uid} through the Admin SDK (which bypasses the security rules: the guard is the check). */
export function firestoreAdminDirectory(db: Firestore): AdminDirectory {
    return {
        isAdmin: async (uid) => (await db.collection('admins').doc(uid).get()).exists,
        membership: async (uid) => {
            const data = (await db.collection('admins').doc(uid).get()).data();
            return data === undefined ? null : membershipOf(data);
        },
    };
}

/** setup/status: written by the setup.* callables, read by setup.status. */
export function firestoreSetupRecords(db: Firestore): SetupRecords {
    return {
        readStatus: async () => (await db.collection('setup').doc('status').get()).data(),
    };
}
