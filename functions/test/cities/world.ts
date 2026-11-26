/**
 * The M5 cities tests' helpers (`docs/research/M5-interfaces.md` §1): the admin world's emulators, an admin document
 * with its cities, a city document, and a call of a cities callable as one admin.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    timestampFromDate,
    type AdminRole,
    type CityDoc,
    type CityRoles,
} from '@hcm/shared';

import type { World } from '../admin/world.js';
import { googleToken } from '../admin/world.js';

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

const TOKENS = { '--md-sys-color-primary': '#8B5E3C', '--md-sys-color-on-primary': '#ffffff' };

/** The theme a New city flow sends (the seed and its four schemes). */
export const THEME = { seedColor: '#8B5E3C', tokens: { light: TOKENS, dark: TOKENS, highContrastLight: TOKENS, highContrastDark: TOKENS } };

/** Cluj's rectangle: about 0.2 by 0.1 degrees. */
export const CLUJ_BOUNDS = { west: 23.5, south: 46.72, east: 23.7, north: 46.82 };

export async function seedAdmin(world: World, uid: string, role: AdminRole, cities?: CityRoles): Promise<void> {
    const doc = { role, createdAt: AT, updatedBy: uid, updatedAt: AT };
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, cities === undefined ? doc : { ...doc, cities });
}

export async function seedCity(world: World, cityId: string, overrides: Partial<CityDoc> = {}): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.city(cityId), cityDocSchema, {
        name: { ro: cityId },
        bounds: CLUJ_BOUNDS,
        published: true,
        updatedBy: 'u-owner',
        updatedAt: AT,
        ...overrides,
    });
}

/** The caller of a callable: a verified Google admin with the claim. */
export function adminCaller(uid: string) {
    return { uid, token: googleToken(`${uid}@example.test`, { admin: true }) };
}
