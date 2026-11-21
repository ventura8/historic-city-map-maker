/**
 * Who belongs to which city (M5, `docs/research/M5-interfaces.md` §1.2): the plumbing every feature folder that reads
 * memberships shares (`api/` is the one place they may all import, CR-M2-3). The session and the tick migrate the
 * documents from before M5, the admins callables and the notifications' fan-out list a city's members, and the cities
 * callables count the project's cities.
 *
 * A project has a handful of admins and at most `MAX_CITIES` cities, so these read whole collections: no query on a
 * map key, no index.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    cityRoleOf,
    inviteDocSchema,
    legacyCityRoles,
    systemWriter,
    timestampFromDate,
    type AdminDoc,
    type CityRole,
} from '@hcm/shared';

import type { DocumentStore } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type MembershipDeps = Pick<Ports, 'documents' | 'clock'>;

/** One admin as the membership helpers see them: the uid and the document. */
export interface AdminEntry {
    readonly uid: string;
    readonly admin: AdminDoc;
}

/** Every city id of the project (valid or not: an id is a city whatever its document says), sorted. */
export async function projectCityIds(documents: DocumentStore): Promise<string[]> {
    const cities = await documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    return [...cities.documents, ...cities.invalid].map((city) => city.id).sort((a, b) => a.localeCompare(b));
}

/** Every admin of the project whose document is valid. */
export async function projectAdmins(documents: DocumentStore): Promise<AdminEntry[]> {
    const admins = await documents.query(FIRESTORE_PATHS.admins, adminDocSchema);
    return admins.documents.map((document) => ({ uid: document.id, admin: document.data }));
}

/** The admins with a role in `cityId`, and that role. */
export async function cityMembers(documents: DocumentStore, cityId: string): Promise<(AdminEntry & { readonly role: CityRole })[]> {
    return (await projectAdmins(documents)).flatMap((entry) => {
        const role = cityRoleOf(entry.admin.cities, cityId);
        return role === null ? [] : [{ ...entry, role }];
    });
}

/** The document a pre-M5 admin gets: every existing city, owned by the project's owner and edited by everyone else. */
function migratedAdmin(admin: AdminDoc, cityIds: readonly string[], now: Date): AdminDoc {
    return {
        ...admin,
        cities: legacyCityRoles(admin.role, cityIds),
        updatedBy: systemWriter('cities'),
        updatedAt: timestampFromDate(now),
    };
}

/**
 * The admin's document with its cities: one from before M5 (no `cities`) is migrated first, in a transaction that
 * writes only when the document still has none (S-A51-HAPPY-MIGRATION). Undefined without a document.
 */
export async function adminWithCities(deps: MembershipDeps, uid: string): Promise<AdminDoc | undefined> {
    const path = FIRESTORE_PATHS.admin(uid);
    const current = await deps.documents.get(path, adminDocSchema);
    if (current === undefined || current.cities !== undefined) {
        return current;
    }
    const cityIds = await projectCityIds(deps.documents);
    return deps.documents.transaction(async (transaction) => {
        const admin = await transaction.get(path, adminDocSchema);
        if (admin === undefined || admin.cities !== undefined) {
            return admin;
        }
        const migrated = migratedAdmin(admin, cityIds, deps.clock.now());
        await transaction.set(path, adminDocSchema, migrated);
        return migrated;
    });
}

/**
 * Every pending invitation from before M5 (no `cities`) given the cities that exist now, as an editor of each (what
 * `admin.session` gives its account once it joins: `legacyCityRoles`), each in a transaction that writes only while it
 * still names none. The `memberships` step of `ops.tick` runs it, and `cities.create` before it makes a city, so a city
 * made after M5 is never in a pre-M5 invitation, and the cities' owners see such an invitation (`admins.list`) and can
 * revoke it (S-A51-HAPPY-LEGACY-INVITE; `docs/LESSONS.md` 245). Returns how many it found.
 */
export async function migrateLegacyInvites(deps: MembershipDeps): Promise<number> {
    const legacy = (await deps.documents.query(FIRESTORE_PATHS.invites, inviteDocSchema)).documents.filter(
        (invite) => invite.data.cities === undefined,
    );
    const cityIds = legacy.length === 0 ? [] : await projectCityIds(deps.documents);
    for (const { path } of legacy) {
        await deps.documents.transaction(async (transaction) => {
            const invite = await transaction.get(path, inviteDocSchema);
            if (invite !== undefined && invite.cities === undefined) {
                const stamp = { updatedBy: systemWriter('cities'), updatedAt: timestampFromDate(deps.clock.now()) };
                await transaction.set(path, inviteDocSchema, { ...invite, cities: legacyCityRoles(invite.role, cityIds), ...stamp });
            }
        });
    }
    return legacy.length;
}

/** The admin's cities once they own `cityId` too; a pre-M5 document first gets every existing city (`cityIds`). */
export function rolesWithOwnedCity(admin: AdminDoc, cityIds: readonly string[], cityId: string): Record<string, CityRole> {
    return { ...(admin.cities ?? legacyCityRoles(admin.role, cityIds)), [cityId]: 'owner' };
}
