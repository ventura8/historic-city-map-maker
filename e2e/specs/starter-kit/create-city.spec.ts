import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { KIT_PLACEHOLDER_TOKEN, NEW_CITY_SEEDS, validateManifest, type Manifest } from '@hcm/shared';
import type { Page, TestInfo } from '@playwright/test';

import { translator } from '../../../packages/create-historic-city/src/i18n/index.js';
import { NPX_COMMAND } from '../../../packages/create-historic-city/src/version.js';
import { E2E_TOKEN, SITE_ORIGIN } from '../../fixtures/world.js';
import { CliRun, FakeTools, runCli, type ToolScript } from '../../support/cli.js';
import { KIT_TEMPLATE, servedKitPage } from '../../support/kit.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * `create-historic-city` (behaviour V29; docs/research/M5-interfaces.md §4): the built CLI run as a child process, with
 * fake `firebase`, `gcloud` and `xdg-open` the only commands on its PATH. The static scaffold writes a city that boots;
 * the self-host steps run the owner's own tools after a y/N each, open Google's pages for every human part, and never ask
 * for or print a credential.
 */

const PROJECT = 'cluj-harta';
const CLUJ = ['--name-ro', 'Cluj', '--bbox', '23.5,46.72,23.7,46.82'];
const ok = (stdout = ''): { code: number; stdout: string } => ({ code: 0, stdout });
const listing = (result: unknown): { code: number; stdout: string } => ok(JSON.stringify({ status: 'success', result }));
const billing = (enabled: boolean): { code: number; stdout: string } => ok(JSON.stringify({ projectId: PROJECT, billingEnabled: enabled }));

/** A new Google account: nothing signed in, no project yet, billing linked once the owner did it in Google's page. */
const NEW_ACCOUNT: ToolScript = {
    'firebase --version': [ok('15.36.0\n')],
    'gcloud --version': [ok('Google Cloud SDK\n')],
    'firebase login:list': [ok('⚠  No authorized accounts, run "firebase login"\n')],
    // What `login:list --json` prints once signed in: the accounts with their OAuth tokens (generated test values). The
    // CLI never runs it (docs/LESSONS.md 237).
    'firebase login:list --json': [listing([{ user: { email: 'owner@example.org' }, tokens: { refresh_token: 'refresh-e2e-value' } }])],
    'firebase projects:list --json': [listing([]), listing([{ projectId: PROJECT, projectNumber: '123456789012' }])],
    [`firebase apps:list WEB --project ${PROJECT} --json`]: [listing([])],
    [`firebase hosting:sites:list --project ${PROJECT} --json`]: [listing({ sites: [] })],
    [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(false), billing(true)],
};

interface World {
    readonly cwd: string;
    readonly tools: FakeTools;
}

function world(
    testInfo: TestInfo,
    tools: readonly ('firebase' | 'gcloud' | 'xdg-open')[] = ['firebase', 'gcloud', 'xdg-open'],
    script: ToolScript = NEW_ACCOUNT,
): World {
    const cwd = testInfo.outputPath('cwd');
    mkdirSync(cwd, { recursive: true });
    return { cwd, tools: new FakeTools(testInfo.outputPath('bin'), tools, script) };
}

/** A self-host bundle with one file per folder (a release's CLI carries the real one, `npm run build:self-host`). */
function bundle(testInfo: TestInfo): string {
    const dir = testInfo.outputPath('bundle');
    for (const [path, content] of Object.entries({
        'hosting/admin/index.html': '<!doctype html>\n',
        'hosting/admin/install/1-0-0-e2e0000/manifest.json': '{ "projectId": "any-project" }\n',
        'hosting/city/index.html': 'https://us-central1-__HCM_PROJECT_ID__.cloudfunctions.net\n',
        'functions/index.js': 'export {};\n',
        'rules/firestore.rules': "rules_version = '2';\n",
        'firebase.template.json': '{ "hosting": { "site": "__PROJECT_ID__", "public": "hosting" } }\n',
        'bundle.json': '{ "release": "1.0.0+e2e0000", "templates": ["city/index.html"] }\n',
    })) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    return dir;
}

function manifestIn(dir: string): Manifest {
    const result = validateManifest(JSON.parse(readFileSync(join(dir, 'city.json'), 'utf8')));
    expect(result.ok, 'city.json passes the manifest schema').toBe(true);
    return (result as { readonly value: Manifest }).value;
}

/** Serves the scaffolded folder at `/scaffold/` (its page pinned as the kit's is before a release, its token the e2e one). */
async function serveFolder(page: Page, testInfo: TestInfo, dir: string): Promise<void> {
    const files: Readonly<Record<string, readonly [string, string]>> = {
        '/scaffold/': [servedKitPage(testInfo, readFileSync(join(dir, 'index.html'), 'utf8')), 'text/html; charset=utf-8'],
        '/scaffold/city.json': [readFileSync(join(dir, 'city.json'), 'utf8').replace(KIT_PLACEHOLDER_TOKEN, E2E_TOKEN), 'application/json'],
    };
    await page.route(
        (url) => url.origin === SITE_ORIGIN && url.pathname in files,
        (route) => {
            const [body, contentType] = files[new URL(route.request().url()).pathname] ?? ['', 'text/plain'];
            return route.fulfill({ body, contentType });
        },
    );
}

test('One command scaffolds a city that boots', { tag: '@S-V29-HAPPY' }, async ({ page, lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    const t = translator(lang);

    const { code, output } = await runCli(['cluj', '--yes', '--lang', lang, ...CLUJ], { cwd, tools });

    expect(code).toBe(0);
    expect(readdirSync(join(cwd, 'cluj')).sort((a, b) => a.localeCompare(b))).toEqual(['city.json', 'index.html', 'README.md']);
    expect(output).toContain(t('cli.scaffold.done', { name: 'Cluj', dir: 'cluj' }));
    const manifest = manifestIn(join(cwd, 'cluj'));
    const template = JSON.parse(readFileSync(resolve(KIT_TEMPLATE, 'city.json'), 'utf8')) as Manifest;
    expect(manifest.city.name).toEqual({ ro: 'Cluj', en: 'Cluj' });
    expect(manifest.city.bounds).toEqual([
        [23.5, 46.72],
        [23.7, 46.82],
    ]);
    expect(manifest.city.theme).toEqual(template.city.theme);
    expect(manifest.city.theme.seedColor).toBe(NEW_CITY_SEEDS[0]);
    expect(tools.calls()).toEqual([]);

    await serveFolder(page, testInfo, join(cwd, 'cluj'));
    await page.goto(`/scaffold/?lang=${lang}`);
    await waitForEngineEvent(page, 'hcm-ready');
    expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: 'cluj', layers: 0, photos: 0 })]);
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
});

test('--dry-run shows everything and changes nothing', { tag: '@S-V29-HAPPY-DRY-RUN' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    const t = translator(lang);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const before = readdirSync(join(cwd, 'cluj'));

    const scaffold = await runCli(['oras', '--yes', '--dry-run', '--lang', lang], { cwd, tools });
    const selfHost = await runCli(['self-host', 'cluj', '--project', PROJECT, '--dry-run', '--lang', lang], { cwd, tools });

    expect([scaffold.code, selfHost.code]).toEqual([0, 0]);
    expect(existsSync(join(cwd, 'oras'))).toBe(false);
    expect(readdirSync(join(cwd, 'cluj'))).toEqual(before);
    expect(scaffold.output).toContain(t('cli.dryRun.nothing'));
    for (const line of [
        t('cli.dryRun.runs', { command: `firebase projects:create ${PROJECT} --display-name Cluj` }),
        t('cli.dryRun.runs', { command: `firebase deploy --only hosting --project ${PROJECT}` }),
        t('cli.dryRun.runs', { command: `firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}` }),
        t('cli.dryRun.opens', { url: `https://console.firebase.google.com/project/${PROJECT}/authentication/providers` }),
        t('cli.dryRun.opens', { url: `https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}` }),
        t('cli.dryRun.nothing'),
    ]) {
        expect(selfHost.output).toContain(line);
    }
    expect(tools.calls()).toEqual([]);
});

test('The self-host steps run the owner’s own CLIs, one consent each', { tag: '@S-V29-HAPPY-SELF-HOST' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    const t = translator(lang);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const run = new CliRun(['self-host', 'cluj', '--project', PROJECT, '--bundle', bundle(testInfo), '--lang', lang], {
        cwd,
        tools,
    });
    const consent = t('cli.ask.consent');
    const enter = t('cli.ask.enter');

    for (const [prompt, line] of [
        [consent, 'y'], // 2: firebase login
        [consent, 'y'], // 3: projects:create
        [consent, 'y'], // 4: the web app and the Hosting site
        [consent, 'y'], // 5: the Google sign-in provider page
        [enter, ''],
        [consent, 'y'], // 6: the admin in start-up mode
        [consent, 'y'], // 7: Setup in the admin
        [enter, ''],
        [consent, 'y'], // 8: billing, then the server
        [enter, ''], // billing linked in Google's page
        [consent, 'y'], // 9: the rest of Setup
    ] as const) {
        await run.answer(prompt, line);
    }

    expect(await run.end()).toBe(0);
    const admin = `https://${PROJECT}.web.app/admin/`;
    expect(tools.calls()).toEqual([
        'firebase --version',
        'gcloud --version',
        'firebase login:list',
        'firebase login',
        'firebase projects:list --json',
        `firebase projects:create ${PROJECT} --display-name Cluj`,
        `firebase apps:list WEB --project ${PROJECT} --json`,
        `firebase apps:create WEB Cluj admin --project ${PROJECT}`,
        `firebase hosting:sites:list --project ${PROJECT} --json`,
        `firebase hosting:sites:create ${PROJECT} --project ${PROJECT}`,
        `xdg-open https://console.firebase.google.com/project/${PROJECT}/authentication/providers`,
        'firebase projects:list --json',
        `firebase deploy --only hosting --project ${PROJECT}`,
        `xdg-open ${admin}`,
        `gcloud billing projects describe ${PROJECT} --format=json`,
        `xdg-open https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}`,
        `gcloud billing projects describe ${PROJECT} --format=json`,
        `firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}`,
        `xdg-open ${admin}`,
    ]);
    expect(run.output).toContain(t('cli.selfHost.done', { url: admin }));
    // Asked only y/N and Enter: never a project, a token or a password; nothing shaped like a key is printed.
    for (const question of [t('cli.ask.project'), t('cli.ask.token'), t('cli.ask.billing', { project: PROJECT })]) {
        expect(run.output).not.toContain(question);
    }
    expect(run.output).not.toMatch(/\b(?:sk|pk)\.[\w-]|AIza|refresh-e2e-value/);
    expect(run.output.split(consent).length - 1).toBe(8);
    expect(JSON.parse(readFileSync(join(cwd, 'cluj/server/.firebaserc'), 'utf8'))).toEqual({ projects: { default: PROJECT } });
    // Setup's Publish the map reads this bundle from the site, and the map's address serves this page.
    expect(existsSync(join(cwd, 'cluj/server/hosting/admin/install/1-0-0-e2e0000/manifest.json'))).toBe(true);
    expect(readFileSync(join(cwd, 'cluj/server/hosting/city/index.html'), 'utf8')).toBe(
        `https://us-central1-${PROJECT}.cloudfunctions.net\n`,
    );
});

test('A folder that is not empty is left alone', { tag: '@S-V29-BAD-NOT-EMPTY' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    mkdirSync(join(cwd, 'cluj'));
    writeFileSync(join(cwd, 'cluj/notes.txt'), 'the owner’s notes\n');

    const { code, output } = await runCli(['cluj', '--yes', '--lang', lang, ...CLUJ], { cwd, tools });

    expect(code).toBe(1);
    expect(output).toContain(translator(lang)('cli.target.notEmpty', { dir: 'cluj' }));
    expect(readdirSync(join(cwd, 'cluj'))).toEqual(['notes.txt']);
    expect(readFileSync(join(cwd, 'cluj/notes.txt'), 'utf8')).toBe('the owner’s notes\n');
});

test('A secret Mapbox token is refused at the prompt', { tag: '@S-V29-BAD-SECRET-TOKEN' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    const t = translator(lang);
    const secret = 'sk.e2e-secret-test-value';
    const run = new CliRun(['cluj', '--lang', lang, ...CLUJ], { cwd, tools });

    await run.answer(t('cli.ask.seed', { default: NEW_CITY_SEEDS[0] }), '');
    await run.answer(t('cli.ask.token'), secret);
    await run.answer(t('cli.ask.token'), 'pk.e2e-public-test-value');

    expect(await run.end()).toBe(0);
    expect(run.output).toContain(t('cli.token.secret'));
    expect(run.output).not.toContain(secret);
    const written = readFileSync(join(cwd, 'cluj/city.json'), 'utf8');
    expect(written).not.toContain('sk.');
    expect(manifestIn(join(cwd, 'cluj')).city.mapbox.publicToken).toBe('pk.e2e-public-test-value');
});

test(
    'Without the Firebase CLI the self-host steps stop before running anything',
    { tag: '@S-V29-BAD-NO-FIREBASE-CLI' },
    async ({ lang }, testInfo) => {
        const { cwd, tools } = world(testInfo, ['gcloud', 'xdg-open']);
        expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);

        const { code, output } = await runCli(['self-host', 'cluj', '--project', PROJECT, '--lang', lang], {
            cwd,
            tools,
        });

        expect(code).toBe(1);
        expect(output).toContain(translator(lang)('cli.tools.noFirebase', { version: '15.36.0' }));
        expect(output).toContain('npm install -g firebase-tools@15.36.0');
        expect(tools.calls()).toEqual([]);
        expect(existsSync(join(cwd, 'cluj/server'))).toBe(false);
    },
);

test('Billing never linked stops with how to resume', { tag: '@S-V29-BAD-BILLING-NOT-LINKED' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo, ['firebase', 'gcloud', 'xdg-open'], {
        ...NEW_ACCOUNT,
        [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(false)],
    });
    const t = translator(lang);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const run = new CliRun(['deploy', 'cluj', '--project', PROJECT, '--billing-wait', '0', '--lang', lang], {
        cwd,
        tools,
    });

    await run.answer(t('cli.ask.consent'), 'y');
    await run.answer(t('cli.ask.enter'), '');

    expect(await run.end()).toBe(1);
    const page = `https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}`;
    const resume = `${NPX_COMMAND} deploy cluj --project ${PROJECT}`;
    expect(run.output).toContain(t('cli.billing.never', { url: page, command: resume }));
    expect(tools.calls().filter((line) => line.startsWith('gcloud billing'))).toHaveLength(2);
    expect(tools.calls().filter((line) => line.startsWith('firebase deploy'))).toEqual([]);
});

test('Answering no stops at that step', { tag: '@S-V29-BAD-DECLINED' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    const t = translator(lang);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const run = new CliRun(['self-host', 'cluj', '--project', PROJECT, '--lang', lang], { cwd, tools });

    await run.answer(t('cli.ask.consent'), 'y');
    await run.answer(t('cli.ask.consent'), 'n');

    expect(await run.end()).toBe(0);
    expect(tools.calls()).not.toContain(`firebase projects:create ${PROJECT} --display-name Cluj`);
    expect(run.output).toContain(t('cli.step.declined'));
    expect(run.output).toContain(t('cli.step.left', { n: 9, title: t('cli.step.rest.title') }));
    expect(run.output).toContain(t('cli.step.resume', { command: `${NPX_COMMAND} self-host cluj --project ${PROJECT}` }));
});

test(
    'Self-hosting names what is missing when the package carries no bundle',
    { tag: '@S-V29-BAD-NO-BUNDLE' },
    async ({ lang }, testInfo) => {
        // CR-M5-7 removed the old refusal (--experimental): what can still stop step 6 is a package without the admin's files.
        const { cwd, tools } = world(testInfo);
        const t = translator(lang);
        expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);

        const run = new CliRun(['self-host', 'cluj', '--project', PROJECT, '--bundle', join(cwd, 'no-such-bundle'), '--lang', lang], {
            cwd,
            tools,
        });
        const consent = t('cli.ask.consent');
        for (const [prompt, line] of [
            [consent, 'y'],
            [consent, 'y'],
            [consent, 'y'],
            [consent, 'y'],
            [t('cli.ask.enter'), ''],
            [consent, 'y'],
        ] as const) {
            await run.answer(prompt, line);
        }
        expect(await run.end()).toBe(1);

        expect(run.output).toContain(t('cli.admin.noBundle', { command: NPX_COMMAND }));
        expect(existsSync(join(cwd, 'cluj/server/firebase.json'))).toBe(false);
    },
);

test('A taken project id is named with another to try', { tag: '@S-V29-BAD-PROJECT-TAKEN' }, async ({ lang }, testInfo) => {
    // The UX review of M5: any failure of projects:create was taken for Google's terms, and the same id was tried again.
    const create = `firebase projects:create ${PROJECT} --display-name Cluj`;
    const { cwd, tools } = world(testInfo, ['firebase', 'gcloud', 'xdg-open'], { ...NEW_ACCOUNT, [create]: [{ code: 1 }] });
    const t = translator(lang);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const run = new CliRun(['self-host', 'cluj', '--project', PROJECT, '--lang', lang], { cwd, tools });

    await run.answer(t('cli.ask.consent'), 'y');
    await run.answer(t('cli.ask.consent'), 'y');
    await run.answer(t('cli.ask.consent'), 'n');

    expect(await run.end()).toBe(1);
    expect(run.output).toContain(t('cli.project.failed', { project: PROJECT }));
    expect(run.output).toContain(t('cli.project.otherId', { suggestion: `${PROJECT}-2` }));
    expect(run.output).toContain(t('cli.project.notCreated', { project: PROJECT, suggestion: `${PROJECT}-2` }));
    expect(tools.calls().filter((line) => line === create)).toHaveLength(1);
    expect(tools.calls().filter((line) => line.startsWith('xdg-open'))).toEqual([]);
});

test('The map’s colours change from one colour', { tag: '@S-V29-HAPPY-THEME' }, async ({ lang }, testInfo) => {
    // The UX review of M5: the viewer reads city.json's four schemes, so editing seedColor by hand changed nothing.
    const { cwd, tools } = world(testInfo);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);

    const { code, output } = await runCli(['theme', 'cluj', '--seed', '#1b6c4a', '--lang', lang], { cwd, tools });

    expect(code).toBe(0);
    expect(output).toContain(translator(lang)('cli.theme.done', { seed: '#1B6C4A' }));
    const manifest = manifestIn(join(cwd, 'cluj'));
    expect(manifest.city.theme.seedColor).toBe('#1B6C4A');
    expect(manifest.city.theme.tokens.light).not.toEqual(manifestIn(join(KIT_TEMPLATE)).city.theme.tokens.light);
    expect(readFileSync(join(cwd, 'cluj/index.html'), 'utf8')).toContain('<meta name="theme-color" content="#1B6C4A" />');
    expect(tools.calls()).toEqual([]);
});

test('A colour that is no colour changes nothing', { tag: '@S-V29-BAD-THEME-SEED' }, async ({ lang }, testInfo) => {
    const { cwd, tools } = world(testInfo);
    expect((await runCli(['cluj', '--yes', ...CLUJ], { cwd, tools })).code).toBe(0);
    const before = readFileSync(join(cwd, 'cluj/city.json'), 'utf8');

    const { code, output } = await runCli(['theme', 'cluj', '--seed', 'green', '--lang', lang], { cwd, tools });

    expect(code).toBe(1);
    expect(output).toContain(translator(lang)('cli.seed.invalid', { example: '#8B5E3C' }));
    expect(readFileSync(join(cwd, 'cluj/city.json'), 'utf8')).toBe(before);
});
