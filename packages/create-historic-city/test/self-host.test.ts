/**
 * `create-historic-city self-host` and `deploy` (docs/research/M5-interfaces.md §4.4): the owner's own tools after a y/N
 * per step, over fakes that record every call; billing checked, waited for, or never linked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/main.js';
import { translator } from '../src/i18n/index.js';
import { NPX_COMMAND } from '../src/version.js';
import { cleanUp, fakes, FakeRunner, packageFolder, read, temporaryFolder, writeBundle, type Answer, type Fakes } from './support.js';

const ro = translator('ro');
const PROJECT = 'cluj-harta';
/** A site served without TLS, which the functions must never accept as a viewer origin. */
const HTTP_ORIGIN = ['http', '//owner.github.io'].join(':');
const used: string[] = [];

const ok = (stdout = ''): Answer => ({ code: 0, stdout });
const listing = (result: unknown): Answer => ok(JSON.stringify({ status: 'success', result }));
const billing = (enabled: boolean): Answer => ok(JSON.stringify({ projectId: PROJECT, billingEnabled: enabled }));
const LISTED = listing([{ projectId: PROJECT, projectNumber: '123456789012', displayName: 'Cluj' }]);
/** firebase-tools 15.33.0's `login:list` without an account, and with one. */
const NO_ACCOUNT = ok('⚠  No authorized accounts, run "firebase login"\n');
const SIGNED_IN = ok('Logged in as owner@example.org\n');
/** What `login:list --json` would print: every account with its OAuth tokens (generated test values), never read. */
const TOKENS = listing([
    { user: { email: 'owner@example.org' }, tokens: { refresh_token: 'refresh-test-value', access_token: 'access-test-value' } },
]);
const resumeSelfHost = (dir = 'cluj'): string => `${NPX_COMMAND} self-host ${dir} --project ${PROJECT}`;
const resumeDeploy = (dir = 'cluj'): string => `${NPX_COMMAND} deploy ${dir} --project ${PROJECT}`;

/** A new account: nothing signed in, no project, no app or site, billing linked after the owner's Enter. */
function newAccount(changes: Readonly<Record<string, readonly Answer[]>> = {}, missing: readonly string[] = []): FakeRunner {
    return new FakeRunner(
        {
            'firebase --version': [ok('15.36.0\n')],
            'gcloud --version': [ok('Google Cloud SDK 550.0.0\n')],
            'firebase login:list': [NO_ACCOUNT],
            'firebase login:list --json': [TOKENS],
            'firebase projects:list --json': [listing([]), LISTED],
            [`firebase apps:list WEB --project ${PROJECT} --json`]: [listing([])],
            [`firebase hosting:sites:list --project ${PROJECT} --json`]: [listing({ sites: [] })],
            [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(false), billing(true)],
            ...changes,
        },
        missing,
    );
}

/** A world with a scaffolded city in `cluj/` (the scaffold's own output cleared). */
async function withCity(runner: FakeRunner, answers: readonly (string | null)[], packageDir?: string): Promise<Fakes> {
    const world = fakes({ answers, runner, ...(packageDir === undefined ? {} : { packageDir }) });
    used.push(world.cwd);
    expect(await runCli(['cluj', '--yes', '--name-ro', 'Cluj', '--bbox', '23.5,46.72,23.7,46.82'], world.ports)).toBe(0);
    world.terminal.lines.splice(0);
    return world;
}

afterEach(() => {
    cleanUp(...used.splice(0));
});

const EVERY_YES = ['y', 'y', 'y', 'y', '', 'y', 'y', '', 'y', '', 'y'];

describe('self-host', () => {
    it('happyPath_everyStepRunsTheOwnersOwnToolsAfterItsYes', async () => {
        const runner = newAccount();
        const { ports, terminal, opener, cwd } = await withCity(runner, EVERY_YES);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);

        const server = join(cwd, 'cluj/server');
        expect(runner.calls.filter((call) => call.mode === 'interactive')).toEqual([
            { mode: 'interactive', line: 'firebase login', cwd: undefined },
            { mode: 'interactive', line: `firebase projects:create ${PROJECT} --display-name Cluj`, cwd: undefined },
            { mode: 'interactive', line: `firebase apps:create WEB Cluj admin --project ${PROJECT}`, cwd: undefined },
            { mode: 'interactive', line: `firebase hosting:sites:create ${PROJECT} --project ${PROJECT}`, cwd: undefined },
            { mode: 'interactive', line: `firebase deploy --only hosting --project ${PROJECT}`, cwd: server },
            { mode: 'interactive', line: `firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}`, cwd: server },
        ]);
        expect(opener.opened).toEqual([
            `https://console.firebase.google.com/project/${PROJECT}/authentication/providers`,
            `https://${PROJECT}.web.app/admin/`,
            `https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}`,
            `https://${PROJECT}.web.app/admin/`,
        ]);
        // Only y/N, Enter and nothing else: no credential is ever asked for.
        expect(new Set(terminal.questions)).toEqual(new Set([ro('cli.ask.consent'), ro('cli.ask.enter')]));
        expect(terminal.lines).toContain(ro('cli.billing.notLinked', { project: PROJECT }));
        expect(terminal.lines.at(-1)).toBe(ro('cli.selfHost.done', { url: `https://${PROJECT}.web.app/admin/` }));
        expect(JSON.parse(read(join(server, '.firebaserc')))).toEqual({ projects: { default: PROJECT } });
        expect(read(join(server, 'firebase.json'))).toContain(`"site": "${PROJECT}"`);
        expect(JSON.parse(read(join(server, 'hosting/admin/project.json')))).toEqual({
            projectId: PROJECT,
            projectNumber: '123456789012',
            region: 'us-central1',
            cities: ['cluj'],
            viewerOrigins: [`https://${PROJECT}.web.app`],
        });
        expect(JSON.parse(read(join(server, 'hosting/admin/runtime.json')))).toEqual({ release: '1.0.0+abc1234' });
        // Publish the map needs these on the site: Setup's bundle, and the city page with this project in it.
        expect(existsSync(join(server, 'hosting/admin/install/1-0-0-abc1234/manifest.json'))).toBe(true);
        expect(read(join(server, 'hosting/city/index.html'))).toBe(`connect-src https://us-central1-${PROJECT}.cloudfunctions.net\n`);
        expect(read(join(server, 'hosting/city/config.js'))).toBe(`${PROJECT}-public\n`);
        expect(read(join(server, `functions/.env.${PROJECT}`))).toBe(
            `HCM_VIEWER_ORIGINS=https://${PROJECT}.web.app\nHCM_APP_CHECK=monitor\n`,
        );
        expect(existsSync(join(server, 'rules/firestore.rules'))).toBe(true);
        expect(read(join(cwd, 'cluj/.gitignore'))).toBe('server/\n');
        // docs/LESSONS.md 237: the sign-in is probed in plain text; the JSON listing, which carries the tokens, is never run.
        expect(runner.lines('capture')).toContain('firebase login:list');
        expect(runner.lines()).not.toContain('firebase login:list --json');
        expect(runner.outputs.join('\n')).not.toContain('test-value');
    });

    it('happyPath_whatExistsIsNeverCreatedTwice', async () => {
        const runner = newAccount({
            'firebase login:list': [SIGNED_IN],
            'firebase projects:list --json': [LISTED],
            [`firebase apps:list WEB --project ${PROJECT} --json`]: [listing([{ appId: '1:123456789012:web:abc' }])],
            [`firebase hosting:sites:list --project ${PROJECT} --json`]: [
                listing({ sites: [{ name: `projects/123456789012/sites/${PROJECT}` }] }),
            ],
            [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(true)],
        });
        const { ports, terminal } = await withCity(runner, ['y', 'y', '', 'y', 'y', '', 'y', 'y']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);

        expect(runner.lines('interactive')).toEqual([
            `firebase deploy --only hosting --project ${PROJECT}`,
            `firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}`,
        ]);
        expect(terminal.lines).toEqual(
            expect.arrayContaining([
                ro('cli.login.already'),
                ro('cli.project.exists', { project: PROJECT }),
                ro('cli.app.exists'),
                ro('cli.site.exists', { project: PROJECT }),
                ro('cli.billing.linked'),
            ]),
        );
        expect(terminal.output).not.toContain('owner@example.org');
    });

    it('happyPath_aDryRunPrintsEveryCommandAndPageAndDoesNothing', async () => {
        const runner = newAccount();
        const { ports, terminal, opener, cwd } = await withCity(runner, []);
        runner.calls.splice(0);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT, '--dry-run'], ports)).toBe(0);

        expect(runner.calls).toEqual([]);
        expect(opener.opened).toEqual([]);
        expect(terminal.questions).toEqual([]);
        expect(existsSync(join(cwd, 'cluj/server'))).toBe(false);
        expect(terminal.lines).toEqual(
            expect.arrayContaining([
                ro('cli.dryRun.runs', { command: `firebase projects:create ${PROJECT} --display-name Cluj` }),
                ro('cli.dryRun.runs', { command: `firebase deploy --only hosting --project ${PROJECT}` }),
                ro('cli.dryRun.runs', { command: `gcloud billing projects describe ${PROJECT} --format=json` }),
                ro('cli.dryRun.opens', { url: `https://${PROJECT}.web.app/admin/` }),
                ro('cli.step.header', { n: 9, total: 9, title: ro('cli.step.rest.title') }),
            ]),
        );
        expect(terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
    });
});

describe('self-host: not yet available (CR-M5-7)', () => {
    it('happyPath_theOldFlagIsAcceptedAndChangesNothing', async () => {
        // v1.0.0's notes name --experimental; CR-M5-7 needs no flag, and an old command line keeps working.
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, []);

        expect(await runCli(['deploy', 'cluj', '--project', PROJECT, '--dry-run', '--experimental'], ports)).toBe(0);

        expect(terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
    });

    it('happyPath_aDryRunNeedsNoFlag', async () => {
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, []);

        expect(await runCli(['deploy', 'cluj', '--project', PROJECT, '--dry-run'], ports)).toBe(0);

        expect(terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
    });
});

describe('self-host: stopping', () => {
    it('badPath_noStopsAtThatStepWithTheStepsLeft', async () => {
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, ['y', 'n']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);

        expect(runner.lines('interactive')).toEqual(['firebase login']);
        expect(terminal.lines.slice(-9)).toEqual([
            ro('cli.step.declined'),
            ...['project', 'app', 'provider', 'admin', 'setup', 'server', 'rest'].map((id, index) =>
                ro('cli.step.left', { n: index + 3, title: ro(`cli.step.${id as 'project'}.title`) }),
            ),
            ro('cli.step.resume', { command: resumeSelfHost() }),
        ]);
    });

    it('badPath_withoutTheFirebaseCliNothingRuns', async () => {
        const runner = newAccount({}, ['firebase']);
        const { ports, terminal, opener } = await withCity(runner, EVERY_YES);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(runner.lines()).toEqual(['firebase --version']);
        expect(opener.opened).toEqual([]);
        expect(terminal.lines).toContain(ro('cli.tools.noFirebase', { version: '15.36.0' }));
    });

    it('badPath_billingNeverLinkedStopsWithThePageAndTheResumeCommand', async () => {
        const runner = newAccount({ [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(false)] });
        const { ports, terminal, clock } = await withCity(runner, EVERY_YES);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT, '--billing-wait', '1'], ports)).toBe(1);

        expect(runner.lines('interactive')).not.toContain(
            `firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}`,
        );
        expect(clock.sleeps).toEqual([15_000, 15_000, 15_000, 15_000]);
        expect(terminal.lines).toContain(ro('cli.billing.waiting', { seconds: 15, minutes: 1 }));
        const resume = resumeDeploy();
        expect(terminal.lines.slice(-2)).toEqual([
            ro('cli.billing.never', { url: `https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}`, command: resume }),
            ro('cli.step.resume', { command: resume }),
        ]);
    });

    it('badPath_withoutGcloudTheOwnerSaysWhetherBillingIsLinked', async () => {
        const runner = newAccount({}, ['gcloud']);
        const { ports, terminal } = await withCity(runner, ['y', 'y', 'y', 'y', '', 'y', 'y', '', 'y', 'n', '', 'n']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(terminal.lines).toContain(ro('cli.tools.noGcloud'));
        expect(terminal.questions.filter((question) => question === ro('cli.ask.billing', { project: PROJECT }))).toHaveLength(2);
        expect(runner.lines()).not.toContain(`gcloud billing projects describe ${PROJECT} --format=json`);
    });
});

describe('self-host: failures', () => {
    it('happyPath_googlesTermsFirstThenTheProjectIsCreatedOnTheRetry', async () => {
        const create = `firebase projects:create ${PROJECT} --display-name Cluj`;
        const runner = newAccount({ [create]: [{ code: 2, stdout: '' }, ok()] });
        const { ports, opener, terminal } = await withCity(runner, ['y', 'y', 'y', '', 'n']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);

        expect(runner.lines('interactive').filter((line) => line === create)).toHaveLength(2);
        expect(opener.opened).toEqual(['https://console.firebase.google.com/']);
        expect(terminal.lines).toEqual(
            expect.arrayContaining([
                ro('cli.project.failed', { project: PROJECT }),
                ro('cli.project.otherId', { suggestion: `${PROJECT}-2` }),
                ro('cli.project.terms'),
            ]),
        );
    });

    it('badPath_aTakenIdIsNamedWithAnotherToTryAndNothingElseRuns', async () => {
        // docs/LESSONS.md 240: firebase's own message is above (the owner's terminal); the CLI suggests another id.
        const create = `firebase projects:create ${PROJECT} --display-name Cluj`;
        const runner = newAccount({ [create]: [{ code: 1, stdout: '' }] });
        const { ports, opener, terminal } = await withCity(runner, ['y', 'y', 'n']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(runner.lines('interactive')).toEqual(['firebase login', create]);
        expect(opener.opened).toEqual([]);
        expect(terminal.lines.slice(-5)).toEqual([
            ro('cli.project.failed', { project: PROJECT }),
            ro('cli.project.otherId', { suggestion: `${PROJECT}-2` }),
            ro('cli.project.terms'),
            ro('cli.project.notCreated', { project: PROJECT, suggestion: `${PROJECT}-2` }),
            ro('cli.step.resume', { command: resumeSelfHost() }),
        ]);
    });

    it('badPath_aFailedCommandStopsWithItsStatusAndTheResumeCommand', async () => {
        const runner = newAccount({ [`firebase deploy --only hosting --project ${PROJECT}`]: [{ code: 7, stdout: '' }] });
        const { ports, terminal } = await withCity(runner, EVERY_YES);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(terminal.lines.slice(-2)).toEqual([
            ro('cli.step.failed', { command: `firebase deploy --only hosting --project ${PROJECT}`, code: 7 }),
            ro('cli.step.resume', { command: resumeSelfHost() }),
        ]);
    });

    it('badPath_listingsThatFailOrToolsThatVanishStopTheRun', async () => {
        const failing = newAccount({ 'firebase login:list': [{ code: 1, stdout: '' }] });
        const first = await withCity(failing, EVERY_YES);
        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], first.ports)).toBe(1);
        expect(first.terminal.lines).toContain(ro('cli.step.failed', { command: 'firebase login:list', code: 1 }));

        const vanished = newAccount({ 'firebase login:list': [null] });
        const second = await withCity(vanished, EVERY_YES);
        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], second.ports)).toBe(1);
        expect(second.terminal.lines).toContain(ro('cli.step.missing', { command: 'firebase' }));

        const gone = newAccount({ 'firebase login': [null] });
        const third = await withCity(gone, EVERY_YES);
        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], third.ports)).toBe(1);
        expect(third.terminal.lines).toContain(ro('cli.step.missing', { command: 'firebase' }));
    });
});

describe('self-host: what the run cannot use', () => {
    it('badPath_aProjectWithoutANumberStopsBeforeWritingTheServer', async () => {
        const runner = newAccount({ 'firebase projects:list --json': [listing([{ projectId: PROJECT }])] });
        const { ports, terminal, cwd } = await withCity(runner, ['y', 'y', 'y', '', 'y']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(terminal.lines).toContain(ro('cli.project.noNumber', { project: PROJECT }));
        expect(existsSync(join(cwd, 'cluj/server'))).toBe(false);
    });

    it('badPath_aPackageWithoutTheBundleRefusesBeforeWritingTheServer', async () => {
        const runner = newAccount();
        const packageDir = packageFolder({ bundle: false });
        used.push(packageDir);
        const { ports, terminal, cwd } = await withCity(runner, EVERY_YES, packageDir);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);

        expect(terminal.lines).toContain(ro('cli.admin.noBundle', { command: NPX_COMMAND }));
        expect(existsSync(join(cwd, 'cluj/server'))).toBe(false);
    });

    it('happyPath_anOwnBundleAndAViewerOriginOfTheOwnersSite', async () => {
        const bundle = temporaryFolder();
        used.push(bundle);
        writeBundle(bundle);
        const runner = newAccount();
        const { ports, cwd } = await withCity(runner, ['y', 'y', 'y', 'y', '', 'y', 'n']);

        const code = await runCli(
            ['self-host', 'cluj', '--project', PROJECT, '--bundle', bundle, '--viewer-origin', 'https://owner.github.io', '--experimental'],
            ports,
        );

        expect(code).toBe(0);
        expect(JSON.parse(read(join(cwd, 'cluj/server/hosting/admin/project.json')))).toMatchObject({
            viewerOrigins: ['https://owner.github.io'],
        });
        expect(JSON.parse(read(join(cwd, 'cluj/server/hosting/admin/runtime.json')))).toEqual({ release: '1.0.0+abc1234', startUp: true });
    });

    it('badPath_whatTheRunCannotUseIsRefused', async () => {
        const cases: readonly (readonly [readonly string[], string])[] = [
            [['self-host', 'nowhere', '--project', PROJECT], ro('cli.admin.noKit', { dir: 'nowhere', command: NPX_COMMAND })],
            [['self-host', 'cluj', '--project', 'Not_A_Project'], ro('cli.project.invalid', { project: 'Not_A_Project' })],
            [['self-host', 'cluj'], ro('cli.project.invalid', { project: '' })],
            [
                ['self-host', 'cluj', '--project', PROJECT, '--viewer-origin', HTTP_ORIGIN, '--experimental'],
                ro('cli.origin.invalid', { origin: HTTP_ORIGIN }),
            ],
            [
                ['self-host', 'cluj', '--project', PROJECT, '--viewer-origin', 'https://owner.github.io/map/', '--experimental'],
                ro('cli.origin.invalid', { origin: 'https://owner.github.io/map/' }),
            ],
            [
                ['self-host', 'cluj', '--project', PROJECT, '--viewer-origin', 'not a url', '--experimental'],
                ro('cli.origin.invalid', { origin: 'not a url' }),
            ],
        ];
        for (const [argv, message] of cases) {
            const runner = newAccount();
            const { ports, terminal } = await withCity(runner, []);
            runner.calls.splice(0);

            expect(await runCli(argv, ports)).toBe(1);
            expect(terminal.lines.at(-1)).toBe(message);
            expect(runner.calls).toEqual([]);
        }
    });

    it('badPath_anInvalidCityJsonIsNamed', async () => {
        const runner = newAccount();
        const { ports, terminal, cwd } = await withCity(runner, []);
        const city = join(cwd, 'cluj/city.json');
        const text = readFileSync(city, 'utf8').replace('"version": 1', '"version": 2');
        writeFileSync(city, text);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toMatch(/^city\.json: version /);
    });
});

describe('self-host details', () => {
    it('badPath_theEndOfTheInputIsANo', async () => {
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, []);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);
        expect(terminal.lines).toContain(ro('cli.step.declined'));
        expect(runner.lines('interactive')).toEqual([]);
    });

    it('happyPath_aGitignoreOfTheOwnersKeepsItsLinesAndGainsServerOnce', async () => {
        for (const [before, after] of [
            ['node_modules/', 'node_modules/\nserver/\n'],
            ['node_modules/\n', 'node_modules/\nserver/\n'],
            ['server/\n', 'server/\n'],
        ] as const) {
            const runner = newAccount();
            const { ports, cwd } = await withCity(runner, ['y', 'y', 'y', 'y', '', 'y', 'n']);
            writeFileSync(join(cwd, 'cluj/.gitignore'), before);

            expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);
            expect(read(join(cwd, 'cluj/.gitignore'))).toBe(after);
        }
    });

    it('badPath_aBundleWithoutItsReleaseNamesNone', async () => {
        const bundle = temporaryFolder();
        used.push(bundle);
        writeBundle(bundle);
        writeFileSync(join(bundle, 'bundle.json'), '{}');
        const { ports, cwd } = await withCity(newAccount(), ['y', 'y', 'y', 'y', '', 'y', 'n']);

        expect(await runCli(['self-host', 'cluj', '--project', PROJECT, '--bundle', bundle], ports)).toBe(0);
        expect(JSON.parse(read(join(cwd, 'cluj/server/hosting/admin/runtime.json')))).toEqual({ release: '0.0.0', startUp: true });
    });

    it('badPath_aBrokenBundleIsABugNotAStep', async () => {
        const bundle = temporaryFolder();
        used.push(bundle);
        writeBundle(bundle);
        writeFileSync(join(bundle, 'bundle.json'), '{');
        const { ports } = await withCity(newAccount(), ['y', 'y', 'y', 'y', '', 'y']);

        await expect(runCli(['self-host', 'cluj', '--project', PROJECT, '--bundle', bundle], ports)).rejects.toThrow(SyntaxError);
    });
});

describe('deploy', () => {
    it('happyPath_resumesWithTheServerOfTheEarlierProject', async () => {
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, [...EVERY_YES.slice(0, 8), 'n', 'y', '', 'y']);
        expect(await runCli(['self-host', 'cluj', '--project', PROJECT], ports)).toBe(0);
        runner.calls.splice(0);

        expect(await runCli(['deploy', 'cluj'], ports)).toBe(0);

        expect(runner.lines('interactive')).toEqual([`firebase deploy --only functions,firestore,storage,hosting --project ${PROJECT}`]);
        expect(terminal.lines.at(-1)).toBe(ro('cli.selfHost.done', { url: `https://${PROJECT}.web.app/admin/` }));
    });

    it('happyPath_aDeployWithoutAnEarlierRunWritesTheServerFirst', async () => {
        const runner = newAccount({
            'firebase projects:list --json': [LISTED],
            [`gcloud billing projects describe ${PROJECT} --format=json`]: [billing(true)],
        });
        const { ports, cwd } = await withCity(runner, ['y', 'y']);

        expect(await runCli(['deploy', 'cluj', '--project', PROJECT], ports)).toBe(0);

        expect(JSON.parse(read(join(cwd, 'cluj/server/hosting/admin/runtime.json')))).toEqual({ release: '1.0.0+abc1234' });
    });

    it('happyPath_theCityFolderTheCliRunsIn', async () => {
        const runner = newAccount();
        const { cwd } = await withCity(runner, []);
        const inside = fakes({ runner, cwd: join(cwd, 'cluj'), answers: ['n'] });

        expect(await runCli(['deploy', '--project', PROJECT], inside.ports)).toBe(0);
        expect(inside.terminal.lines.at(-1)).toBe(ro('cli.step.resume', { command: resumeDeploy('.') }));
    });

    it('badPath_anEarlierRunsFileWithoutItsProjectAsksForIt', async () => {
        const runner = newAccount();
        const { ports, terminal, cwd } = await withCity(runner, []);
        mkdirSync(join(cwd, 'cluj/server'));
        writeFileSync(join(cwd, 'cluj/server/.firebaserc'), '{ "projects": {} }');

        expect(await runCli(['deploy', 'cluj'], ports)).toBe(1);
        expect(terminal.questions).toEqual([ro('cli.ask.project')]);
    });

    it('badPath_aServerDeclinedResumesWithDeploy', async () => {
        const runner = newAccount();
        const { ports, terminal } = await withCity(runner, ['n']);

        expect(await runCli(['deploy', 'cluj', '--project', PROJECT], ports)).toBe(0);

        expect(terminal.lines.at(-1)).toBe(ro('cli.step.resume', { command: resumeDeploy() }));
    });
});
