import { adminSiteId, httpsOriginSchema, siteOrigins, startFirstCitySchema } from '@hcm/shared';
import { z } from 'zod';

import { serviceAccountEmail } from '../google/iam.js';

/**
 * `infra/project.json` (`docs/research/M2b-interfaces.md` §3.7): the committed, public facts of the Google Cloud project
 * the admin provisions (ids, region, the cities, the viewer's origins, and, only for a project that deploys from GitHub
 * Actions, the repository whose `master` deploys through Workload Identity Federation: CR-M5-7, a project deployed from the
 * owner's browser or terminal has none). Bundled into the admin build; the provisioner refuses to run when its
 * `projectId` is not the web configuration's. The numeric GitHub ids are what `gh api users/<owner> --jq .id` and
 * `gh api repos/<owner>/<repo> --jq .id` print.
 */

const ID = /^[a-z][a-z0-9-]{4,29}$/;

const projectConfigSchema = z.strictObject({
    projectId: z.string().regex(ID),
    projectNumber: z.string().regex(/^\d{6,20}$/),
    region: z.string().regex(/^[a-z]+-[a-z]+\d$/),
    cities: z
        .array(z.string().regex(/^[a-z0-9-]{2,32}$/))
        .min(1)
        .max(20),
    viewerOrigins: z.array(httpsOriginSchema).min(1).max(10),
    github: z
        .strictObject({
            owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
            ownerId: z.number().int().positive(),
            repo: z.string().regex(/^[\w.-]{1,100}$/),
            repoId: z.number().int().positive(),
            branch: z.string().regex(/^[\w./-]{1,100}$/),
            environment: z.string().regex(/^[\w-]{1,100}$/),
        })
        .optional(),
    /** M14 (`docs/research/M14-start-your-map.md` §8): what the start page was told; New city opens with it filled in. */
    firstCity: startFirstCitySchema.optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** The configuration, or undefined when the file is not one. */
export function parseProjectConfig(value: unknown): ProjectConfig | undefined {
    const parsed = projectConfigSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

/** The service accounts the provisioner creates (security review §1.1), with their display names. */
export const SERVICE_ACCOUNTS = {
    'fn-admin': 'Functions: admin, setup, telemetry, ops',
    'fn-events': 'Functions: events (history, publish, photos)',
    'fn-crash': 'Functions: the public crash endpoint (no role)',
    'job-raster': 'Cloud Run Job: raster pipeline',
    'gh-deployer': 'GitHub Actions deploy (Workload Identity)',
    // M6 (docs/research/M6-interfaces.md §1.2): the account the in-app installer's Cloud Build builds run as.
    'hcm-installer': 'Cloud Build: the in-app installer',
} as const;

export type ServiceAccountId = keyof typeof SERVICE_ACCOUNTS;

export const SERVICE_ACCOUNT_IDS = Object.keys(SERVICE_ACCOUNTS) as readonly ServiceAccountId[];

/** The account only a project deploying from GitHub Actions has (CR-M5-7). */
const GITHUB_ACCOUNT: ServiceAccountId = 'gh-deployer';

/** The service accounts `project` needs: all, but `gh-deployer` only with its GitHub repository (CR-M5-7). */
export function serviceAccountIdsOf(project: Pick<ProjectConfig, 'github'>): readonly ServiceAccountId[] {
    return project.github === undefined ? SERVICE_ACCOUNT_IDS.filter((account) => account !== GITHUB_ACCOUNT) : SERVICE_ACCOUNT_IDS;
}

/** The names every item derives from the configuration. */
export interface ProjectNames {
    readonly privateBucket: string;
    readonly publicBucket: string;
    /**
     * The admin's Hosting origins (`https://<projectId>.web.app`, `https://<projectId>.firebaseapp.com`, then its own
     * site's two, `<projectId>-admin`: §210).
     */
    readonly adminOrigins: readonly string[];
    /** `serviceAccount:<id>@<projectId>.iam.gserviceaccount.com` */
    member(account: ServiceAccountId): string;
    email(account: ServiceAccountId): string;
}

export function projectNames(project: ProjectConfig): ProjectNames {
    const email = (account: ServiceAccountId): string => serviceAccountEmail(account, project.projectId);
    return {
        privateBucket: `${project.projectId}.firebasestorage.app`,
        publicBucket: `${project.projectId}-public`,
        adminOrigins: [
            `https://${project.projectId}.web.app`,
            `https://${project.projectId}.firebaseapp.com`,
            ...siteOrigins(adminSiteId(project.projectId)),
        ],
        member: (account) => `serviceAccount:${email(account)}`,
        email,
    };
}
