import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    cityIdsOf,
    cityRoleOf,
    inviteDocSchema,
    inviteIdFor,
    ownerDocSchema,
    type AdminDoc,
    type CallableResponse,
    type CityRoles,
    type SessionCity,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { adminWithCities } from '../api/memberships.js';
import { InvalidDocumentError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { acceptInvitedCities } from './memberships.js';
import { isBefore } from './records.js';

export type SessionDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** An invitation for the caller's verified address that has not expired (the app then offers "Join"). */
async function invitePending(deps: SessionDeps, email: string | undefined): Promise<boolean> {
    if (email === undefined) {
        return false;
    }
    const invite = await deps.documents.get(FIRESTORE_PATHS.invite(await inviteIdFor(email)), inviteDocSchema);
    return invite !== undefined && isBefore(deps.clock.now(), invite.expiresAt);
}

/**
 * The city's name for the switcher; its id while the city has no document (the bundled city before Setup writes it) or
 * when the document no longer passes its schema, so its admins can still open it and invite.
 */
async function cityName(deps: SessionDeps, cityId: string): Promise<SessionCity['name']> {
    try {
        return (await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema))?.name ?? { ro: cityId };
    } catch (error) {
        if (error instanceof InvalidDocumentError) {
            deps.log.warn('a city document is not valid: the switcher shows its id', { cityId });
            return { ro: cityId };
        }
        throw error;
    }
}

/** The caller's cities with their role and name. */
async function sessionCities(deps: SessionDeps, roles: CityRoles | undefined): Promise<SessionCity[]> {
    const listed = await Promise.all(
        cityIdsOf(roles).map(async (id) => {
            const role = cityRoleOf(roles, id);
            return role === null ? [] : [{ id, role, name: await cityName(deps, id) }];
        }),
    );
    return listed.flat();
}

/**
 * The caller's `admins/{uid}`, M5-ready: a document from before M5 gets its cities (`adminWithCities`), and an admin
 * invited to more cities since gets them now (`acceptInvitedCities`), so an existing admin never needs "Join".
 */
async function currentAdmin(deps: SessionDeps, caller: VerifiedCaller): Promise<AdminDoc | undefined> {
    const admin = await adminWithCities(deps, caller.uid);
    if (admin === undefined || caller.email === undefined) {
        return admin;
    }
    return (await acceptInvitedCities(deps, caller.uid, caller.email)) ?? admin;
}

/**
 * `admin.session` (any verified Google account, S-A01-*, S-A20-*, S-A49-*, S-A51-HAPPY-MIGRATION): whether the caller
 * administers the map and with which role, whether its ID token already carries the claim (`refreshToken` when the token
 * and the document disagree: a fresh claim or a revoked one), whether the map has an owner, whether an invitation waits
 * for the caller's address, and (M5) the caller's cities for the switcher and whether they own the project. It writes
 * only the caller's own document, and only to migrate it or accept an invitation to more cities; the address is
 * hashed, never stored or logged.
 */
async function adminSession(deps: SessionDeps, caller: VerifiedCaller): Promise<CallableResponse<'admin.session'>> {
    const admin = await currentAdmin(deps, caller);
    const owner = await deps.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema);
    const facts = adminFacts(admin);
    return {
        admin: facts.admin,
        role: facts.role,
        claim: caller.claim,
        refreshToken: facts.admin !== caller.claim,
        ownerClaimed: owner !== undefined,
        invitePending: !facts.admin && (await invitePending(deps, caller.email)),
        cities: await sessionCities(deps, admin?.cities),
        projectOwner: facts.projectOwner,
    };
}

/** What the document says of the caller: an admin or not, the project role, and whether they own the project. */
function adminFacts(admin: AdminDoc | undefined): {
    readonly admin: boolean;
    readonly role: AdminDoc['role'] | null;
    readonly projectOwner: boolean;
} {
    return admin === undefined
        ? { admin: false, role: null, projectOwner: false }
        : { admin: true, role: admin.role, projectOwner: admin.role === 'owner' };
}

/** The `admin-session` callable. */
export function sessionFunction(getDeps: () => SessionDeps & CallableDeps) {
    return defineCallable('admin.session', adminSession, getDeps);
}
