/**
 * The Setup Assistant's callables (`docs/research/M2-interfaces.md` §3.3; scenarios A03–A07, A22). Secrets travel
 * once, from the paste box to `setup.saveMapbox` / `setup.saveUsgs`, into Secret Manager; every response and every
 * document holds non-secret health only. Billing and provisioning run in the browser with the admin's own Google
 * token (PLAN Addendum 1) and report what they found with `setup.recordCloud`.
 */
import { z } from 'zod';

import { cityDocSchema, httpsOriginSchema, mapboxTokenIdSchema } from '../schemas/firestore.js';
import { PROVISION_ITEMS, SERVICE_STATES, USGS_ROLES, type SetupArea, type UsgsRole } from '../schemas/firestore-ops.js';
import { setupInstallSchema } from '../schemas/install.js';
import { cityIdSchema } from '../schemas/paths.js';
import { coded, firebaseAppIdsSchema, isoDateSchema, mapboxPublicTokenSchema, measurementIdSchema } from '../schemas/primitives.js';
import { emptyRequestSchema, healthViewFields, isoTimeSchema } from './common.js';
import { apiErrorCodeSchema, apiErrorParamsSchema } from './errors.js';

/** What the pasted bootstrap token must carry: a token can only mint scopes it holds (onboarding review §2B). */
export const MAPBOX_BOOTSTRAP_SCOPES = [
    'styles:read',
    'styles:tiles',
    'fonts:read',
    'tilesets:read',
    'tilesets:write',
    'tilesets:list',
    'tokens:read',
    'tokens:write',
] as const;
/** The minted secret `mapbox-sk-tiles` (the pipeline's MTS publishing). */
export const MAPBOX_TILES_SCOPES = ['tilesets:read', 'tilesets:write', 'tilesets:list'] as const;
/** The minted, URL-restricted public tokens of the viewer and the admin (security review §1.3). */
export const MAPBOX_PUBLIC_SCOPES = ['styles:read', 'styles:tiles', 'fonts:read'] as const;
/** Who a public token is for: the city's site origins, or the admin's Hosting origins. */
export const MAPBOX_TOKEN_AUDIENCES = ['viewer', 'admin'] as const;
/** A replaced public token keeps working this long, so cached manifests and open pages do not break. */
export const TOKEN_RETIRE_MINUTES = 10;
/** While USGS has not granted the M2M download role, `ops.tick` checks again this often. */
export const USGS_RECHECK_HOURS = 6;
/** The Setup Assistant reminds the admin this many days before the USGS application token expires. */
export const USGS_EXPIRY_REMINDER_DAYS = 14;
/** The `permissions` entry that means downloads are allowed. UNVERIFIED until the first real token (onboarding §0.4). */
export const USGS_DOWNLOAD_PERMISSION = 'download';
/** The areas that must be `ok` before the map can publish layers (analytics and crash reports are optional). */
export const SETUP_REQUIRED_AREAS = ['billing', 'provision', 'mapbox', 'usgs'] as const satisfies readonly SetupArea[];
/** What `setup.selfTest` exercises with the functions' own service account, in order. */
export const SELF_TEST_CHECKS = [
    'firestore',
    'secrets',
    'private-bucket',
    'public-bucket',
    'task-queue',
    /**
     * M6 (finding 17, `docs/research/M6-interfaces.md` §3.2): a write of `ops/probe` reaches `ops.onProbe` through Eventarc,
     * which delivers it with `fn-events@`: proves `roles/run.invoker`, which the emulators never check.
     */
    'events',
    'mapbox',
    'usgs',
    'firebase-management',
    'error-reporting',
    /** M4 (`docs/research/M4-interfaces.md` §4.4): Vertex AI's `countTokens` on the pinned model, which costs nothing. */
    'ai',
] as const;

export type MapboxTokenKind = 'secret' | 'public' | 'unknown';

const SECRET_TOKEN = /^sk\.[\w.-]{20,2000}$/;

/** What a pasted text is, so the admin can explain a public token before sending anything (S-A06-BAD-PUBLIC-TOKEN-PASTED). */
export function classifyMapboxToken(value: string): MapboxTokenKind {
    const token = value.trim();
    if (SECRET_TOKEN.test(token)) {
        return 'secret';
    }
    return token.startsWith('pk.') ? 'public' : 'unknown';
}

/** The required scopes a token lacks, in the required order (listed by name: S-A06-BAD-MISSING-SCOPES). */
export function missingScopes(granted: readonly string[], required: readonly string[] = MAPBOX_BOOTSTRAP_SCOPES): string[] {
    return required.filter((scope) => !granted.includes(scope));
}

/** The M2M role the `permissions` list grants. */
export function usgsRoleFromPermissions(permissions: readonly string[]): UsgsRole {
    return permissions.includes(USGS_DOWNLOAD_PERMISSION) ? 'download' : 'search';
}

const healthDetail = { detail: apiErrorCodeSchema.optional(), params: apiErrorParamsSchema.optional() };

const billingViewSchema = z.strictObject({
    ...healthViewFields,
    budgetId: z.string().max(200).optional(),
    budgetAmount: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    // [section setup-ux trial] M6 (docs/research/M6-interfaces.md §3.1, A60): a likely free trial and its dismissal.
    trialSince: isoTimeSchema.optional(),
    trialPaidAt: isoTimeSchema.optional(),
    // [end setup-ux trial]
});

const provisionItemViewSchema = z.strictObject({ id: z.enum(PROVISION_ITEMS), state: z.enum(SERVICE_STATES), ...healthDetail });

/** Finding 65 of 2026-11-02: the set version the project was last brought to (absent: before versions, 1). */
const setVersionSchema = z.number().int().min(1).max(1000);
const provisionViewSchema = z.strictObject({
    ...healthViewFields,
    items: z.array(provisionItemViewSchema).max(PROVISION_ITEMS.length),
    setVersion: setVersionSchema.optional(),
});

const mapboxViewSchema = z.strictObject({
    ...healthViewFields,
    user: z.string().max(64).optional(),
    scopes: z.array(z.string().max(41)).max(30).optional(),
    /** The admin's own public token, for its maps (URL-restricted to the admin's origins). */
    adminToken: mapboxPublicTokenSchema.optional(),
    adminAllowedUrls: z.array(httpsOriginSchema).max(10).optional(),
});

const usgsViewSchema = z.strictObject({
    ...healthViewFields,
    role: z.enum(USGS_ROLES).optional(),
    nextCheckAt: isoTimeSchema.optional(),
    tokenExpiresAt: isoTimeSchema.optional(),
    // [section setup-ux postponed] M6 (docs/research/M6-interfaces.md §4.1, A59): Do it later, and the approval's wait.
    postponedAt: isoTimeSchema.optional(),
    pendingSince: isoTimeSchema.optional(),
    // [end setup-ux postponed]
});

const analyticsViewSchema = z.strictObject({ ...healthViewFields, measurementId: measurementIdSchema.optional() });

const crashViewSchema = z.strictObject({ ...healthViewFields, lastReportAt: isoTimeSchema.optional() });

/** `setup.status` (and every `setup.*` response that changes it): the Setup Assistant's whole screen. */
export const setupStatusViewSchema = z.strictObject({
    billing: billingViewSchema,
    provision: provisionViewSchema,
    mapbox: mapboxViewSchema,
    usgs: usgsViewSchema,
    analytics: analyticsViewSchema,
    crash: crashViewSchema,
    secretsRev: z.number().int().min(0),
    /** Every `SETUP_REQUIRED_AREAS` area is `ok` (`setupReady`). */
    ready: z.boolean(),
    generatedAt: isoTimeSchema,
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7): each install target's last known
    // state, so Home can say an update is ready without a Google token.
    install: setupInstallSchema.optional(),
    // [end install]
});

export type SetupStatusView = z.infer<typeof setupStatusViewSchema>;

/** True once every required area is verified. */
export function setupReady(view: Pick<SetupStatusView, (typeof SETUP_REQUIRED_AREAS)[number]>): boolean {
    return SETUP_REQUIRED_AREAS.every((area) => view[area].state === 'ok');
}

export const statusRequestSchema = emptyRequestSchema;

/** `setup.selfTest`: one real, minimal operation per check with the runtime service account; results land in `setup/status`. */
export const selfTestRequestSchema = emptyRequestSchema;
export const selfTestResponseSchema = z.strictObject({
    checks: z
        .array(z.strictObject({ id: z.enum(SELF_TEST_CHECKS), state: z.enum(SERVICE_STATES), ...healthDetail }))
        .max(SELF_TEST_CHECKS.length),
    status: setupStatusViewSchema,
});

/** `setup.recordCloud`: what the browser-side billing check and the provisioning doctor found (non-secret). */
export const recordCloudRequestSchema = z
    .strictObject({
        billing: z
            .strictObject({
                state: z.enum(SERVICE_STATES),
                ...healthDetail,
                budgetId: z
                    .string()
                    .regex(/^billingAccounts\/[A-Z0-9-]{1,40}\/budgets\/[a-z0-9-]{1,64}$/)
                    .optional(),
                budgetAmount: z.number().min(0).max(1_000_000).optional(),
                currency: z
                    .string()
                    .regex(/^[A-Z]{3}$/)
                    .optional(),
            })
            .optional(),
        provision: z
            .strictObject({
                items: z.array(provisionItemViewSchema).min(1).max(PROVISION_ITEMS.length),
                setVersion: setVersionSchema.optional(),
            })
            .optional(),
        // [section install] owner: installer (M6, §1.7): what the install cards saw of each target (no token, no log line).
        install: setupInstallSchema.optional(),
        // [end install]
        // [section setup-ux postponed] M6 (docs/research/M6-interfaces.md §4.1, A59): Do it later on a postponable step
        // (true), or taken back (false); only USGS can wait.
        postponed: z.strictObject({ usgs: z.boolean() }).optional(),
        // [end setup-ux postponed]
        // [section setup-ux trial] M6 (§3.1, A60): an account appeared while the billing card waited (`since`), or the
        // owner said it is a paid account (`paid`).
        trial: z.union([z.strictObject({ since: isoTimeSchema }), z.strictObject({ paid: z.literal(true) })]).optional(),
        // [end setup-ux trial]
    })
    // At least one part to record (every part is optional, so a new part needs no change here).
    .refine((request) => Object.values(request).some((part) => part !== undefined), coded('validation.required'));
export const recordCloudResponseSchema = z.strictObject({ status: setupStatusViewSchema });

/** `setup.saveMapbox`: the secret token pasted once (validated upstream before it is stored). */
export const saveMapboxRequestSchema = z.strictObject({ cityId: cityIdSchema, secretToken: z.string().trim().min(1).max(4096) });

const mintedTokenViewSchema = z.strictObject({ tokenId: mapboxTokenIdSchema, allowedUrls: z.array(httpsOriginSchema).min(1).max(10) });

export const saveMapboxResponseSchema = z.strictObject({
    mapbox: mapboxViewSchema,
    viewer: mintedTokenViewSchema,
    admin: mintedTokenViewSchema,
});

/** `setup.saveUsgs`: the ERS username and the application token (shown for 60 s by ERS: the paste box opens first). */
export const saveUsgsRequestSchema = z.strictObject({
    username: z.string().trim().min(1).max(100),
    applicationToken: z.string().trim().min(1).max(512),
    /** The expiry the admin chose in ERS, if any: a reminder comes 14 days before (`USGS_EXPIRY_REMINDER_DAYS`). */
    expiresOn: isoDateSchema.optional(),
});
export const saveUsgsResponseSchema = z.strictObject({ usgs: usgsViewSchema });

/** `setup.rotatePublicToken`: the panic button (security review §1.3). */
export const rotatePublicTokenRequestSchema = z.strictObject({ cityId: cityIdSchema, audience: z.enum(MAPBOX_TOKEN_AUDIENCES) });
export const rotatePublicTokenResponseSchema = z.strictObject({
    tokenId: mapboxTokenIdSchema,
    /** When the replaced token is deleted (null when there was none). */
    retiresOldAt: isoTimeSchema.nullable(),
    /** A viewer token is written to the city and published with a manifest rebuild. */
    manifestQueued: z.boolean(),
});

/** `setup.analyticsConfig`: detect the GA4 measurement id and the web app's public ids, store them for the manifest. */
export const analyticsConfigRequestSchema = z.strictObject({ cityId: cityIdSchema });
export const analyticsConfigResponseSchema = z.strictObject({
    analytics: analyticsViewSchema,
    measurementId: measurementIdSchema,
    firebase: firebaseAppIdsSchema,
    manifestQueued: z.boolean(),
});

/** `setup.createCity` (CR-M2b-1): creates `cities/{cityId}` once from the bundled city; an existing city stays unchanged. */
export const createCityRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    /**
     * The bundled seed's name, view, texts, theme, basemap and imagery settings (its target years, M8). The server owns the rest: `id`, `createdAt`, the stamp,
     * `published` (true: the bundled city is public today), the viewer token (`setup.saveMapbox`) and the analytics ids
     * (`setup.analyticsConfig`).
     */
    city: cityDocSchema.pick({
        name: true,
        bounds: true,
        center: true,
        zoom: true,
        minZoom: true,
        maxZoom: true,
        about: true,
        privacy: true,
        credits: true,
        theme: true,
        basemap: true,
        imagery: true,
    }),
});
/** `created: false` when the city already existed (the call is idempotent: a second owner claim, a reload). */
export const createCityResponseSchema = z.strictObject({ created: z.boolean() });

export type SaveMapboxRequest = z.infer<typeof saveMapboxRequestSchema>;
export type SaveMapboxResponse = z.infer<typeof saveMapboxResponseSchema>;
export type SaveUsgsRequest = z.infer<typeof saveUsgsRequestSchema>;
export type SaveUsgsResponse = z.infer<typeof saveUsgsResponseSchema>;
export type SelfTestResponse = z.infer<typeof selfTestResponseSchema>;
export type RecordCloudRequest = z.infer<typeof recordCloudRequestSchema>;
export type RotatePublicTokenRequest = z.infer<typeof rotatePublicTokenRequestSchema>;
export type RotatePublicTokenResponse = z.infer<typeof rotatePublicTokenResponseSchema>;
export type AnalyticsConfigResponse = z.infer<typeof analyticsConfigResponseSchema>;
export type SelfTestCheck = (typeof SELF_TEST_CHECKS)[number];
export type MapboxTokenAudience = (typeof MAPBOX_TOKEN_AUDIENCES)[number];
