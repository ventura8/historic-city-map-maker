import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DOCKER_BUILDER_IMAGE } from '@hcm/shared';

import {
    OVER_TAG,
    buildDefinition,
    installerServiceAccount,
    releaseTag,
    targetTag,
    type BuildParams,
} from '../../src/install/build-spec.js';
import { FETCH_BUNDLE_SCRIPT } from '../../src/install/fetch-script.js';

/**
 * The three install builds as the admin submits them (`docs/research/M6-interfaces.md` §1.4), pinned against golden
 * JSON (`golden/<target>.json`; the inline `fetch` program is pinned by `fetch-script.test.ts`, which runs it).
 */

const PARAMS: BuildParams = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    origin: 'https://demo-hcm.web.app',
    basePath: '/admin/',
    release: '1.0.0+abc1234',
    releaseTime: 1_761_955_200,
    slug: '1-0-0-abc1234',
    manifestSha256: 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    images: { node: `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`, docker: DOCKER_BUILDER_IMAGE },
    legacy: false,
};

const TARGETS = ['server', 'pipeline', 'site'] as const;

function golden(target: string): unknown {
    return JSON.parse(readFileSync(new URL(`golden/${target}.json`, import.meta.url), 'utf8')) as unknown;
}

/** The definition with the inline fetch program replaced by its placeholder, as the golden files hold it. */
function comparable(target: (typeof TARGETS)[number]): unknown {
    const definition = buildDefinition(target, PARAMS) as { steps: Record<string, unknown>[] };
    const steps = definition.steps.map((step) => {
        if (step['id'] !== 'fetch') {
            return step;
        }
        expect(step['args']).toEqual(['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT]);
        return { ...step, args: ['--input-type=module', '--eval', '<FETCH_BUNDLE_SCRIPT>'] };
    });
    return { ...definition, steps };
}

describe('buildDefinition', () => {
    it.each(TARGETS)('happyPath_the %s build is the golden one', (target) => {
        expect(comparable(target)).toEqual(golden(target));
    });

    it('happyPath_everyBuildRunsAsTheInstallerLogsToCloudLoggingAndCarriesItsTags', () => {
        for (const target of TARGETS) {
            const definition = buildDefinition(target, PARAMS);

            expect(definition).toMatchObject({
                serviceAccount: installerServiceAccount('demo-hcm'),
                options: { logging: 'CLOUD_LOGGING_ONLY' },
                tags: ['hcm-install', targetTag(target), releaseTag('1-0-0-abc1234')],
            });
        }
    });

    it('happyPath_aBuildTheOwnerInstalledOverANewerReleaseCarriesItsTag', () => {
        // The live finding of 2026-11-12: a confirmed rollback stays in Cloud Build's history.
        expect(buildDefinition('server', { ...PARAMS, over: true })['tags']).toEqual([
            'hcm-install',
            'hcm-server',
            releaseTag('1-0-0-abc1234'),
            OVER_TAG,
        ]);
    });

    it('happyPath_everyStepNamesItsImageByDigest', () => {
        const images = TARGETS.flatMap((target) =>
            (buildDefinition(target, PARAMS)['steps'] as { name: string }[]).map((step) => step.name),
        );

        expect(images.every((image) => /@sha256:[0-9a-f]{64}$/.test(image))).toBe(true);
    });

    it('happyPath_theServerDeploysWithForce_theSiteKeepsTheBundleInItsTree', () => {
        const server = JSON.stringify(buildDefinition('server', PARAMS));
        const site = buildDefinition('site', PARAMS)['steps'] as { env?: string[] }[];

        expect(server).toContain('"steps/deploy-with-retry.mjs","--project","$PROJECT_ID","--force"');
        expect(site[0]?.env).toContain('HCM_KEEP_BUNDLE=public${_BASE}install/${_SLUG}');
        expect(site[0]?.env).toContain('HCM_FILES=site,server,pipeline');
    });

    it('happyPath_aSiteBuildBeforeTheLegacyImportEndsFetchesAndUnpacksTheOriginals_badPath_otherTargetsNever', () => {
        // §73k: the originals (legacy.tgz) only while step (h) has not imported every old photo.
        const site = buildDefinition('site', { ...PARAMS, legacy: true })['steps'] as { env?: string[] }[];
        const server = buildDefinition('server', { ...PARAMS, legacy: true })['steps'] as { env?: string[] }[];

        expect(site[0]?.env).toEqual(expect.arrayContaining(['HCM_FILES=site,server,pipeline,legacy', 'HCM_UNPACK=legacy']));
        const trimmed = buildDefinition('site', PARAMS)['steps'] as { env?: string[] }[];
        expect(server[0]?.env).toContain('HCM_FILES=server');
        expect(server[0]?.env?.some((line) => line.startsWith('HCM_UNPACK'))).toBe(false);
        expect(trimmed[0]?.env?.some((line) => line.startsWith('HCM_UNPACK') || line.includes('legacy'))).toBe(false);
    });

    it('happyPath_anAdminOnItsOwnSiteNamesItToTheServersFunctions_badPath_noOtherTargetAndNoOtherAdminDoes', () => {
        // §210: only an admin served from its own site proves the site is the project's; its functions then link there.
        const server = buildDefinition('server', { ...PARAMS, adminSite: 'demo-hcm-admin' })['steps'] as { env?: string[] }[];
        const site = buildDefinition('site', { ...PARAMS, adminSite: 'demo-hcm-admin' })['steps'] as { env?: string[] }[];
        const plain = buildDefinition('server', PARAMS)['steps'] as { env?: string[] }[];

        expect(server[0]?.env).toContain('HCM_ADMIN_SITE=demo-hcm-admin');
        expect([...(site[0]?.env ?? []), ...(plain[0]?.env ?? [])].some((line) => line.startsWith('HCM_ADMIN_SITE'))).toBe(false);
    });

    it('happyPath_theServerInstallsTheFunctionsPackagesBeforeItDeploysThem_badPath_noOtherTargetDoes', () => {
        // Finding 30 of 2026-10-31: firebase-tools loads the functions' source to discover them, so their packages must be
        // in that folder (the tarball carries none); the laptop found them in the repository's node_modules above it.
        const ids = (target: (typeof TARGETS)[number]): string[] =>
            (buildDefinition(target, PARAMS)['steps'] as { id: string }[]).map((step) => step.id);
        const server = buildDefinition('server', PARAMS)['steps'] as { id: string; dir?: string; args: string[] }[];
        const packages = server.find((step) => step.id === 'packages');

        expect(ids('server').indexOf('packages')).toBeLessThan(ids('server').indexOf('functions'));
        expect(packages?.dir).toBe('server/functions/dist');
        expect(packages?.args).toEqual(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
        expect([...ids('pipeline'), ...ids('site')]).not.toContain('packages');
    });

    it('happyPath_theBuildTimeIsASubstitutionTheFetchStepChecks_badPath_aReleaseWithoutOneSendsItEmpty', () => {
        // Finding 39 of 2026-11-01: Cloud Build refuses a substitution no step uses, so `fetch` reads it for every target.
        for (const target of TARGETS) {
            const definition = buildDefinition(target, PARAMS) as { substitutions: Record<string, string>; steps: { env?: string[] }[] };
            expect(definition.substitutions['_RELEASE_TIME']).toBe('1761955200');
            expect(definition.steps[0]?.env).toContain('HCM_RELEASE_TIME=${_RELEASE_TIME}');
        }
        const untimed = buildDefinition('pipeline', { ...PARAMS, releaseTime: null }) as { substitutions: Record<string, string> };
        expect(untimed.substitutions['_RELEASE_TIME']).toBe('');
    });

    it('badPath_noValueFromTheOwnersTokenOrDataReachesTheBuild', () => {
        const text = JSON.stringify(TARGETS.map((target) => buildDefinition(target, PARAMS)));

        expect(text).not.toMatch(/ya29\.|sk\.|Bearer/);
        expect(FETCH_BUNDLE_SCRIPT).not.toContain('$');
    });
});
