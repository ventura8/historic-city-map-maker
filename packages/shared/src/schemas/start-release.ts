/**
 * Start your own map (M14, `docs/research/M14-start-your-map.md` §6, §8): what the start site publishes beside its page.
 * `start-release.json` lists every file of the tree a new project's first Hosting release is made from, each with its
 * SHA-256, and the Hosting rules (`ServingConfig`) that release carries. A file marked `template` holds
 * {@link START_PROJECT_TOKEN} where the project's id goes; the browser replaces it, so the tree names no project at all.
 */
import { z } from 'zod';

import { CITY_ID_PATTERN } from './primitives.js';

/** The manifest's format; a page refuses a manifest of another one. */
export const START_RELEASE_FORMAT = 1;

/** Where the project's id goes in a template file and in the Hosting rules. */
export const START_PROJECT_TOKEN = '__HCM_PROJECT_ID__';

/** The manifest's name in the release's folder (`release/<slug>/`). */
export const START_RELEASE_FILE = 'start-release.json';

/** The folder of the tree's files, in the release's folder. */
export const START_TREE_FOLDER = 'tree';

/** The start site's configuration, beside the page. */
export const START_CONFIG_FILE = 'start-config.json';

/**
 * The install bundle of a project nobody knew at build time (§6): `manifest.projectId` names this, and an admin of any
 * project accepts it. Its name fits the manifest's id pattern; it is compared, never used as an address, and nothing else
 * reads it: a real project that happened to carry the name would only accept a bundle made for any project.
 */
export const GENERIC_INSTALL_PROJECT = 'any-project';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const startFileSchema = z.strictObject({
    /** Relative to the Hosting site's root, no leading slash. */
    path: z
        .string()
        .min(1)
        .max(512)
        .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w@.+/-]+$/),
    bytes: z.number().int().min(0),
    sha256,
    template: z.literal(true).optional(),
});

export type StartFile = z.infer<typeof startFileSchema>;

const headerRuleSchema = z.strictObject({
    glob: z.string().optional(),
    regex: z.string().optional(),
    headers: z.record(z.string(), z.string()),
});

const rewriteRuleSchema = z.strictObject({ glob: z.string().optional(), regex: z.string().optional(), path: z.string() });

const redirectRuleSchema = z.strictObject({
    glob: z.string().optional(),
    regex: z.string().optional(),
    location: z.string(),
    statusCode: z.number().int().min(300).max(399),
});

/** Firebase Hosting's `ServingConfig`, the fields `firebase.json` uses (`sites.versions` of the REST API). */
export const hostingServingConfigSchema = z.strictObject({
    rewrites: z.array(rewriteRuleSchema).optional(),
    headers: z.array(headerRuleSchema).optional(),
    redirects: z.array(redirectRuleSchema).optional(),
    cleanUrls: z.boolean().optional(),
    trailingSlashBehavior: z.enum(['ADD', 'REMOVE']).optional(),
});

export type HostingServingConfig = z.infer<typeof hostingServingConfigSchema>;

export const startReleaseSchema = z.strictObject({
    format: z.literal(START_RELEASE_FORMAT),
    /** The admin's release, `<version>+<short commit>`. */
    release: z.string().min(1).max(64),
    releaseTime: z.number().int().min(0).nullable(),
    slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
    hosting: hostingServingConfigSchema,
    files: z.array(startFileSchema).min(1).max(5000),
});

export type StartRelease = z.infer<typeof startReleaseSchema>;

/** `start-config.json`: the OAuth client's public id, or nothing while the road is not open (§2). */
export const startConfigSchema = z.strictObject({
    oauthClientId: z
        .string()
        .regex(/^[\w.-]{10,200}$/)
        .optional(),
    /** The manifest of the release the page deploys. */
    release: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

export type StartConfig = z.infer<typeof startConfigSchema>;

/** What the start page keeps of the city (§8): New city opens with it filled in. */
export const startFirstCitySchema = z.strictObject({
    id: z.string().regex(CITY_ID_PATTERN),
    name: z.strictObject({ ro: z.string().trim().min(1).max(80), en: z.string().trim().min(1).max(80).optional() }),
    bounds: z
        .strictObject({
            west: z.number().min(-180).max(180),
            south: z.number().min(-90).max(90),
            east: z.number().min(-180).max(180),
            north: z.number().min(-90).max(90),
        })
        .optional(),
});

export type StartFirstCity = z.infer<typeof startFirstCitySchema>;
