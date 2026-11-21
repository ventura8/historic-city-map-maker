/**
 * The deploy-time configuration of the functions (DECISIONS-for-review.md §22a): `functions/deploy-env.json` maps each
 * real project to the public `HCM_*` values `functions/build.mjs` writes into `dist/.env.<project>`, which firebase-tools
 * loads at deploy for that project only. A secret never belongs there (Secret Manager holds every secret), so only the
 * keys `runtimeConfig` reads are accepted, and each one is checked the way the deployed functions will read it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '../src/deps.js';

const ROOT = resolve(import.meta.dirname, '../..');

/** The variables `runtimeConfig` reads from the deploy (functions/src/deps.ts); nothing else may be configured. */
const PUBLIC_KEYS = ['HCM_APP_CHECK', 'HCM_OAUTH_CLIENT_IDS', 'HCM_VIEWER_ORIGINS'];

const GOOGLE_WEB_CLIENT = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, unknown>;
}

const deployEnv = readJson('functions/deploy-env.json') as Record<string, Record<string, string>>;
const firebaseProjects = Object.values(readJson('.firebaserc')['projects'] as Record<string, string>);
const rows = Object.entries(deployEnv).map(([project, values]) => ({ project, values }));

describe('functions/deploy-env.json', () => {
    it('happyPath_configuresOnlyTheRealProjectsOfFirebaserc', () => {
        const projects = Object.keys(deployEnv);

        expect(projects.length).toBeGreaterThan(0);
        expect(projects.every((project) => firebaseProjects.includes(project) && !project.startsWith('demo-'))).toBe(true);
    });

    it.each(rows)('happyPath_holdsOnlyThePublicKeysTheFunctionsRead ($project)', ({ values }) => {
        expect(Object.keys(values).sort((a, b) => a.localeCompare(b))).toEqual(PUBLIC_KEYS);
        expect(Object.values(values).every((value) => typeof value === 'string' && !/[\r\n]/.test(value))).toBe(true);
    });

    it.each(rows)('happyPath_isReadAsTheDeployedFunctionsReadIt ($project)', ({ project, values }) => {
        const config = runtimeConfig({ GCLOUD_PROJECT: project, ...values });

        expect(config.oauthClientIds.length).toBeGreaterThan(0);
        expect(config.oauthClientIds.every((id) => GOOGLE_WEB_CLIENT.test(id))).toBe(true);
        expect(config.viewerOrigins.every((origin) => new URL(origin).origin === origin && origin.startsWith('https://'))).toBe(true);
        expect(config.appCheck).toBe(values['HCM_APP_CHECK']);
    });

    it('badPath_theBuildRefusesTheViewerOriginsTheCitySchemaRefuses @S-A06-BAD-ORIGINS-REFUSED', () => {
        // functions/build.mjs checks HCM_VIEWER_ORIGINS with the same pattern as httpsOriginSchema (@hcm/shared), so a
        // deploy never carries origins the runtime would refuse (finding 3 of the M6 security review).
        const pattern = /\/\^https:[^\n]*\$\//;
        const build = pattern.exec(readFileSync(resolve(ROOT, 'functions/build.mjs'), 'utf8'))?.[0];
        const schema = pattern.exec(readFileSync(resolve(ROOT, 'packages/shared/src/schemas/firestore.ts'), 'utf8'))?.[0];

        expect(build).toBeDefined();
        expect(build).toBe(schema);
        expect(build).toContain('{1,253}');
    });

    it('badPath_anUnknownAppCheckModeWouldSilentlyMeanMonitor', () => {
        // Why the value is pinned above: any other spelling than `enforce` reads as `monitor`.
        expect(runtimeConfig({ GCLOUD_PROJECT: 'bucurestiul-disparut', HCM_APP_CHECK: 'Enforce' }).appCheck).toBe('monitor');
    });
});
