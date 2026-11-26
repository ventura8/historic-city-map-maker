/**
 * Who belongs to which city (M5; `docs/research/M5-interfaces.md` §1.2; M13: `docs/research/M13-roles.md` §1): the roles of
 * `admins/{uid}.cities` and of an invitation's `cities`. Kept apart from `cities.ts` so the document schemas of
 * `firestore-ops.ts` can use it: `cities.ts` imports the imagery API, which imports `firestore-ops.ts`, and a module cycle
 * would read a schema before it exists.
 */
import { z } from 'zod';

import { cityIdSchema } from './paths.js';
import { coded } from './primitives.js';

/**
 * A city admin's role, strongest first: `owner` (its admins, its export, everything an editor does), `editor` (its content),
 * `moderator` (M13: reviews, edits or unpublishes any photo or place, and nothing else) and `uploader` (M13: adds photos and
 * places that wait for review).
 */
export const CITY_ROLES = ['owner', 'editor', 'moderator', 'uploader'] as const;

export type CityRole = (typeof CITY_ROLES)[number];

/** The roles with the whole city's content, its settings and its imagery: what every rule and callable before M13 meant. */
export const STAFF_ROLES: readonly CityRole[] = ['owner', 'editor'];

/** The roles that approve (M13 §2). */
export const REVIEW_ROLES: readonly CityRole[] = ['owner', 'editor', 'moderator'];

/** The stronger of two roles (`CITY_ROLES` runs strongest first). */
export function strongerRole(a: CityRole | null | undefined, b: CityRole): CityRole {
    return a !== null && a !== undefined && CITY_ROLES.indexOf(a) < CITY_ROLES.indexOf(b) ? a : b;
}

/** Whether `role` is a staff role: the settings, the imagery and the whole content of a city. */
export function isStaffRole(role: CityRole | null | undefined): boolean {
    return role === 'owner' || role === 'editor';
}

/** Whether `role` may review: approve, refuse, edit or unpublish any photo or place. */
export function isReviewRole(role: CityRole | null | undefined): boolean {
    return isStaffRole(role) || role === 'moderator';
}

/** At most this many cities in one project (the Mapbox account's 24-tileset cap is shared by all of them). */
export const MAX_CITIES = 20;

/** `admins/{uid}.cities`: the cities an admin belongs to, each with its role. */
export const cityRolesSchema = z
    .record(cityIdSchema, z.enum(CITY_ROLES))
    .refine((roles) => Object.keys(roles).length <= MAX_CITIES, coded('validation.tooBig'));

export type CityRoles = Readonly<Record<string, CityRole>>;

/**
 * M13 §1: whether an account's roles leave it out of the project's own state (Setup, budgets, the crash reports): it has
 * cities and none as staff. An account with no city at all keeps what it had before M13, so a project before its first
 * city and an owner's document from before M5 still work.
 */
export function isContributorOnly(roles: CityRoles | undefined): boolean {
    const held = Object.values(roles ?? {});
    return held.length > 0 && !held.some(isStaffRole);
}
