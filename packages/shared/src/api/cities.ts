/**
 * Many cities in one project (M5; `docs/research/M5-interfaces.md` §1.3, §1.6 to §1.8): the requests and responses of
 * `cities.create` and `cities.setLimits` (the project owner's), of the per-city admin callables (`admins.invite`,
 * `admins.revoke`, `admins.list` take a city from M5; `admins.setRole` is new) and the cities `admin.session` lists.
 * The registry rows (`registry.ts`) take these schemas in the same change as their implementation (the multi-city
 * workstream), because the functions' index test compares the registry with what is deployed.
 */
import { z } from 'zod';

import { CITY_ROLES, cityLimitsSchema, MAX_CITIES } from '../schemas/cities.js';
import { cityBoundsProblem, isUsableCityId } from '../schemas/city-id.js';
import { sha256Schema, uidSchema } from '../schemas/firestore-common.js';
import { themeSchema } from '../schemas/manifest.js';
import { cityIdSchema } from '../schemas/paths.js';
import { boundsRecordSchema, coded, localizedPartial, plainText } from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';

const cityRoleSchema = z.enum(CITY_ROLES);

/** A city id a new city may take: well formed and not reserved (`RESERVED_CITY_IDS`). */
const newCityIdSchema = cityIdSchema.refine(isUsableCityId, coded('validation.value'));

/** The rectangle drawn in the New city flow, within `CITY_SPAN_LIMITS`. */
const newCityBoundsSchema = boundsRecordSchema.superRefine((bounds, context) => {
    const problem = cityBoundsProblem(bounds);
    if (problem !== null) {
        context.addIssue({ code: 'custom', ...coded(problem) });
    }
});

/**
 * `cities.create` (project owner): the New city flow's one call. The server derives the rest: the start view
 * (`startViewForBounds`), the default About and privacy texts, the basemap, `published: false`, the imagery defaults,
 * `limits` (`DEFAULT_NEW_CITY_LIMITS`), the viewer's Mapbox token when Mapbox is set up, the project's analytics ids,
 * and the caller as the city's owner. A city that exists and whose owner is the caller answers `created: false` (a
 * retried call); any other existing id is `apiError.city.idTaken`.
 */
export const citiesCreateRequestSchema = z.strictObject({
    cityId: newCityIdSchema,
    name: localizedPartial(100),
    bounds: newCityBoundsSchema,
    /** The seed and its four schemes, computed in the browser as Settings does (`themeFromSeed` of `@hcm/ui`). */
    theme: themeSchema,
});
export const citiesCreateResponseSchema = z.strictObject({ created: z.boolean(), cityId: cityIdSchema });

/**
 * `cities.locate` (project owner): where the name New city was given lies on OpenStreetMap (Nominatim's search, one
 * request; the server's own cool-down after a refusal holds), as a rectangle that can be a city (`cityAreaAround`), and
 * the place's name as OpenStreetMap writes it; `bounds` null when nothing is found or Nominatim cannot answer now, and
 * the admin draws the rectangle by hand.
 */
export const citiesLocateRequestSchema = z.strictObject({ name: plainText(100) });
export const citiesLocateResponseSchema = z.strictObject({ bounds: boundsRecordSchema.nullable(), place: plainText(300).optional() });

/** `cities.setLimits` (project owner): a city's share of the project's budgets (`cities/{city}.limits`). */
export const citiesSetLimitsRequestSchema = z.strictObject({ cityId: cityIdSchema, limits: cityLimitsSchema });
export const citiesSetLimitsResponseSchema = z.strictObject({ limits: cityLimitsSchema });

/** One city of the signed-in admin, as `admin.session` lists it for the switcher (names from the city documents). */
export const sessionCitySchema = z.strictObject({ id: cityIdSchema, role: cityRoleSchema, name: localizedPartial(100) });
export const sessionCitiesSchema = z.array(sessionCitySchema).max(MAX_CITIES);

/** `admins.invite` from M5 (city owner): an address invited to one city with a role; the link is copied at once. */
export const cityInviteRequestSchema = z.strictObject({ cityId: cityIdSchema, email: z.email().max(254), role: cityRoleSchema });

/** `admins.revoke` from M5 (city owner): an admin removed from one city (never its last owner), or that city's invitation. */
export const cityRevokeRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('admin'), cityId: cityIdSchema, uid: uidSchema }),
    z.strictObject({ kind: z.literal('invite'), cityId: cityIdSchema, inviteId: sha256Schema }),
]);

/** `admins.setRole` (city owner, new in M5): an admin's role in one city (never the last owner's own demotion). */
export const citySetRoleRequestSchema = z.strictObject({ cityId: cityIdSchema, uid: uidSchema, role: cityRoleSchema });
export const citySetRoleResponseSchema = z.strictObject({ role: cityRoleSchema });

/** `admins.list` from M5 (city member): the city's admins and its pending invitations. */
export const cityAdminsListRequestSchema = z.strictObject({ cityId: cityIdSchema });
export const cityAdminsListResponseSchema = z.strictObject({
    admins: z
        .array(
            z.strictObject({
                uid: uidSchema,
                role: cityRoleSchema,
                /** The project's owner (the account that claimed it): shown, never removed from or demoted in a city they own. */
                projectOwner: z.boolean(),
                email: z.email().max(254).optional(),
                displayName: plainText(200).optional(),
                createdAt: isoTimeSchema,
                self: z.boolean(),
            }),
        )
        .max(100),
    invites: z
        .array(
            z.strictObject({
                inviteId: sha256Schema,
                role: cityRoleSchema,
                invitedBy: uidSchema,
                createdAt: isoTimeSchema,
                expiresAt: isoTimeSchema,
            }),
        )
        .max(100),
});

export type CitiesCreateRequest = z.infer<typeof citiesCreateRequestSchema>;
export type SessionCity = z.infer<typeof sessionCitySchema>;
export type CityAdminsListResponse = z.infer<typeof cityAdminsListResponseSchema>;
