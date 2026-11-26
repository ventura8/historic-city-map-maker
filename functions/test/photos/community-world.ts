/** M13's test world (`docs/research/M13-roles.md`): a city, its people, and a callable's `.run()` as each of them. */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    cityRoleOf,
    isContributorOnly,
    photoDocSchema,
    timestampFromDate,
    type CityRole,
    type PhotoDoc,
} from '@hcm/shared';
import type { CallableRequest } from 'firebase-functions/https';

import type { AdminDirectory } from '../../src/ports/admin-directory.js';
import type { AuthAdmin } from '../../src/ports/auth-admin.js';
import { cityDoc, photoDoc } from '../publish/city.js';
import { contentDeps } from '../publish/fakes.js';

export const CITY_ID = 'bucuresti';
export const AT = timestampFromDate(new Date('2026-10-12T08:00:00.000Z'));

const ROLES: Readonly<Record<string, Readonly<Record<string, CityRole>>>> = {
    'u-owner': { [CITY_ID]: 'owner' },
    'u-editor': { [CITY_ID]: 'editor' },
    'u-moderator': { [CITY_ID]: 'moderator' },
    'u-uploader': { [CITY_ID]: 'uploader' },
    'u-other': { cluj: 'owner' },
};

const directory: AdminDirectory = {
    isAdmin: (uid) => Promise.resolve(ROLES[uid] !== undefined),
    membership: (uid) => {
        const roles = ROLES[uid];
        return Promise.resolve(
            roles === undefined
                ? null
                : { projectRole: 'admin', contributorOnly: isContributorOnly(roles), roleIn: (city: string) => cityRoleOf(roles, city) },
        );
    },
};

/** Who has had the `admin` claim set, as the fake auth saw it. */
function fakeAuth(): AuthAdmin & { readonly claims: Map<string, boolean> } {
    const claims = new Map<string, boolean>();
    return {
        claims,
        getUser: (uid) =>
            Promise.resolve({
                uid,
                displayName: `Name of ${uid}`,
                emailVerified: true,
                providers: [],
                createdAt: new Date(0),
                customClaims: {},
            }),
        setAdminClaim: (uid, admin) => {
            claims.set(uid, admin);
            return Promise.resolve();
        },
        revokeSessions: () => Promise.resolve(),
        deleteUser: () => Promise.resolve(),
        createCustomToken: () => Promise.resolve('token'),
        listUsers: () => Promise.resolve({ users: [] }),
    };
}

export type CommunityWorld = Omit<ReturnType<typeof contentDeps>, 'admins'> & {
    readonly admins: AdminDirectory;
    readonly auth: ReturnType<typeof fakeAuth>;
};

export async function communityWorld(): Promise<CommunityWorld> {
    const deps = contentDeps();
    await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ published: true }));
    const auth = fakeAuth();
    return { ...deps, admins: directory, auth };
}

/** A callable request from `uid`, signed in with a verified Google account (or `signedOut`). */
export function as(uid: string | null, data: unknown): CallableRequest<unknown> {
    const base = { data, rawRequest: {} as CallableRequest['rawRequest'], acceptsStreaming: false };
    if (uid === null) {
        return base;
    }
    const token = {
        email: `${uid}@example.test`,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
        admin: ROLES[uid] !== undefined,
    };
    return { ...base, auth: { uid, token, rawToken: 't' } } as unknown as CallableRequest<unknown>;
}

/** The code of a failed callable. */
export async function refusal(run: Promise<unknown>): Promise<string> {
    try {
        await run;
    } catch (error) {
        return String((error as { readonly details?: { readonly code?: string } }).details?.code);
    }
    throw new Error('expected a refusal');
}

export async function seedPhoto(world: CommunityWorld, id: string, overrides: Partial<PhotoDoc> = {}): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.photo(CITY_ID, id), photoDocSchema, photoDoc(id, overrides));
}

export async function seedMember(world: CommunityWorld, uid: string, cities: Readonly<Record<string, CityRole>>): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
        role: 'admin',
        cities,
        createdAt: AT,
        updatedBy: uid,
        updatedAt: AT,
    });
}
