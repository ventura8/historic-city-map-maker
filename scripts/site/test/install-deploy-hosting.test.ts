import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFakeFetch, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deployHosting, ownSite } from '../src/install/steps/deploy-hosting.js';
import { FIREBASE_BIN } from '../src/install/steps/deploy-with-retry.js';
import type { CommandResult, StepDeps } from '../src/install/steps/step-io.js';

/**
 * The site build's `hosting` step (DECISIONS-for-review.md §210) over fakes of Hosting and the command: the admin's own
 * site deployed beside the public map's when the project has it, the tree as before when it has none or another
 * project holds the id.
 */
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const SITE_URL = `${HOSTING}/projects/demo-hcm/sites/demo-hcm-admin`;

let dir: string;

function site(status: number): Route {
    return route('GET', SITE_URL, 'hosting.sites.get', () =>
        status === 200
            ? jsonResponse({ name: 'projects/demo-hcm/sites/demo-hcm-admin' })
            : jsonResponse({ error: { code: status } }, status),
    );
}

const CONFIG_ROUTE = route('PATCH', `${HOSTING}/sites/demo-hcm-admin/config`, 'hosting.config', () => jsonResponse({ maxVersions: 10 }));

function world(routes: readonly Route[], result: CommandResult = { code: 0, output: '' }) {
    const lines: string[] = [];
    const runs: (readonly string[])[] = [];
    const fetcher = createFakeFetch(routeTable(routes));
    const deps: StepDeps = {
        run: (_command, args) => {
            runs.push(args);
            return Promise.resolve(result);
        },
        fetch: fetcher.fetch,
        token: () => Promise.resolve('e2e-build-token'),
        readFile: () => '',
        sleep: () => Promise.resolve(),
        random: () => 0.5,
        log: (line) => {
            lines.push(line);
        },
    };
    return { deps, lines, runs, calls: fetcher.calls };
}

function tree(): void {
    mkdirSync(join(dir, 'public/admin'), { recursive: true });
    writeFileSync(join(dir, 'public/admin/index.html'), 'the admin');
    writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ hosting: { site: 'demo-hcm', public: 'public' } }));
}

const ARGS = (): string[] => ['--project', 'demo-hcm', '--dir', dir];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hcm-deploy-hosting-'));
    tree();
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('deploy-hosting', () => {
    it('happyPath_theProjectsAdminSiteDeploysBesideThePublicMapAndKeepsItsLastReleases', async () => {
        const fakes = world([site(200), CONFIG_ROUTE]);

        await expect(deployHosting(ARGS(), fakes.deps)).resolves.toBe(0);

        expect(fakes.runs).toEqual([[FIREBASE_BIN, 'deploy', '--only', 'hosting', '--project', 'demo-hcm', '--non-interactive']]);
        expect((JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8')) as { hosting: unknown[] }).hosting).toHaveLength(2);
        expect(fakes.lines[0]).toContain('https://demo-hcm-admin.web.app/admin/');
        expect(fakes.calls.map((call) => call.operation)).toEqual(['hosting.sites.get', 'hosting.config']);
    });

    it.each([404, 403])('badPath_aSiteTheProjectDoesNotOwn_%s_leavesTheAdminUnderThePublicMap', async (status) => {
        const fakes = world([site(status)]);

        await expect(deployHosting(ARGS(), fakes.deps)).resolves.toBe(0);

        expect(JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8'))).toEqual({ hosting: { site: 'demo-hcm', public: 'public' } });
        expect(fakes.lines[0]).toContain('stays at /admin/ of the public map');
        expect(fakes.calls.map((call) => call.operation)).toEqual(['hosting.sites.get']);
    });

    it('badPath_aFailedDeployFailsTheStepWithoutTouchingTheSitesConfig', async () => {
        const fakes = world([site(200), CONFIG_ROUTE], { code: 2, output: 'Error: HTTP 403' });

        await expect(deployHosting(ARGS(), fakes.deps)).resolves.toBe(2);
        expect(fakes.calls.map((call) => call.operation)).toEqual(['hosting.sites.get']);
    });

    it('badPath_anyOtherAnswerOfHostingFailsTheStep_andAnArgumentLessCallIsRefused', async () => {
        await expect(ownSite(world([site(500)]).deps, 'demo-hcm', 'demo-hcm-admin')).rejects.toThrow('HTTP 500');
        await expect(deployHosting(['--max-versions', '0'], world([]).deps)).rejects.toThrow('usage: deploy-hosting');
    });
});
