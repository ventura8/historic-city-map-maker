/** `upgrade` and `doctor` (docs/research/M5-interfaces.md §4.2) over a scaffolded city. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    engineCdnBase,
    fillKitPage,
    KIT_PLACEHOLDER_TOKEN,
    KIT_UNPINNED_INTEGRITY,
    policyExtras,
    readKitEngine,
    readKitPolicy,
    type KitEngine,
} from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { translator } from '../src/i18n/index.js';
import { NPX_COMMAND } from '../src/version.js';
import { runCli } from '../src/main.js';
import { cleanUp, fakes, FakeRunner, packageFolder, read, type Fakes } from './support.js';

const ro = translator('ro');
const folders: string[] = [];

/** Generated test digests (64 base64 characters each), never a real file's. */
const sri = (letter: string): string => `sha384-${letter.repeat(64)}`;

function pinned(version: string, letter: string): KitEngine {
    return {
        kind: 'cdn',
        release: {
            base: engineCdnBase(version),
            files: [
                { path: 'engine.css', integrity: sri(letter) },
                { path: 'engine.iife.js', integrity: sri(letter.toUpperCase()) },
            ],
        },
    };
}

/** The template's placeholder before any release pinned it: a folder and the unpinned integrity. */
const UNPINNED: KitEngine = {
    kind: 'cdn',
    release: {
        base: engineCdnBase('1.0.0'),
        files: [
            { path: 'engine.css', integrity: KIT_UNPINNED_INTEGRITY },
            { path: 'engine.iife.js', integrity: KIT_UNPINNED_INTEGRITY },
        ],
    },
};

/** A package whose template pins `engine` (a released CLI), or the placeholder no release has pinned yet. */
function release(engine: KitEngine = UNPINNED): string {
    const dir = packageFolder();
    folders.push(dir);
    const page = join(dir, 'template/index.html');
    writeFileSync(page, fillKitPage(read(page), { engine }));
    return dir;
}

async function city(packageDir: string, runner = new FakeRunner()): Promise<Fakes> {
    const world = fakes({ packageDir, runner });
    folders.push(world.cwd);
    expect(await runCli(['cluj', '--yes', '--name-ro', 'Cluj', '--bbox', '23.5,46.72,23.7,46.82'], world.ports)).toBe(0);
    world.terminal.lines.splice(0);
    return world;
}

afterEach(() => {
    cleanUp(...folders.splice(0));
});

describe('upgrade', () => {
    it('happyPath_onlyTheEngineBlockAndThePolicyChange', async () => {
        const old = await city(release(pinned('1.0.0', 'a')));
        const page = join(old.cwd, 'cluj/index.html');
        const before = read(page);
        const newer = fakes({ packageDir: release(pinned('1.1.0', 'b')), cwd: old.cwd });

        expect(await runCli(['upgrade', 'cluj', '--dry-run'], newer.ports)).toBe(0);
        expect(read(page)).toBe(before);
        expect(newer.terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
        expect(await runCli(['upgrade', 'cluj'], newer.ports)).toBe(0);

        expect(readKitEngine(read(page))).toEqual(pinned('1.1.0', 'b'));
        expect(read(page)).toBe(fillKitPage(before, { engine: pinned('1.1.0', 'b') }));
        expect(newer.terminal.lines.at(-1)).toBe(ro('cli.upgrade.done', { base: engineCdnBase('1.1.0') }));
        expect(await runCli(['upgrade', 'cluj'], newer.ports)).toBe(0);
        expect(newer.terminal.lines.at(-1)).toBe(ro('cli.upgrade.same'));
    });

    it('happyPath_theOriginsAndTelemetryThePageAddedStay', async () => {
        // docs/LESSONS.md 242: the README tells an owner to add a tile host to the policy; an export's page names its own and
        // none of the telemetry's hosts. Upgrade keeps both.
        const old = await city(release(pinned('1.0.0', 'a')));
        const page = join(old.cwd, 'cluj/index.html');
        const sources = { connect: ['https://tiles.example.org'], images: ['https://tiles.example.org', 'https://photos.example.org'] };
        writeFileSync(page, fillKitPage(read(page), { engine: pinned('1.0.0', 'a'), sources, analytics: false }));
        const newer = fakes({ packageDir: release(pinned('1.1.0', 'b')), cwd: old.cwd });
        folders.push(newer.cwd);

        expect(await runCli(['upgrade', 'cluj'], newer.ports)).toBe(0);

        const policy = readKitPolicy(read(page));
        expect(policyExtras(policy)).toEqual({ sources, analytics: false });
        expect(policy).toContain(engineCdnBase('1.1.0'));
    });

    it('badPath_whatUpgradeCannotDo', async () => {
        const unreleased = await city(release());
        expect(await runCli(['upgrade', 'cluj'], unreleased.ports)).toBe(1);
        expect(unreleased.terminal.lines.at(-1)).toBe(ro('cli.upgrade.unpinned', { command: NPX_COMMAND }));

        const released = await city(release(pinned('1.1.0', 'b')));
        expect(await runCli(['upgrade', 'nowhere'], released.ports)).toBe(1);
        expect(released.terminal.lines.at(-1)).toBe(ro('cli.page.missing', { dir: 'nowhere' }));

        const page = join(released.cwd, 'cluj/index.html');
        writeFileSync(page, fillKitPage(read(page), { engine: pinned('1.0.0', 'a') }).replace(/<title>[^<]*<\/title>/, ''));
        expect(await runCli(['upgrade', 'cluj'], released.ports)).toBe(1);
        expect(released.terminal.lines.at(-1)).toMatch(/^index\.html nu are blocul motorului pe care îl pot citi: .*<title>/);

        writeFileSync(page, '<!doctype html>\n<title>mine</title>\n');
        expect(await runCli(['upgrade', 'cluj'], released.ports)).toBe(1);
        expect(released.terminal.lines.at(-1)).toMatch(/^index\.html nu are blocul motorului pe care îl pot citi: /);
    });
});

describe('doctor', () => {
    const tools = new FakeRunner({ 'firebase --version': [{ code: 0, stdout: '15.36.0' }] }, ['gcloud']);

    it('happyPath_aCityThatIsReady', async () => {
        const world = await city(release(pinned('1.0.0', 'a')), tools);
        const manifest = join(world.cwd, 'cluj/city.json');
        writeFileSync(manifest, read(manifest).replace(KIT_PLACEHOLDER_TOKEN, 'pk.e2e-owner-token'));

        expect(await runCli(['doctor', 'cluj'], world.ports)).toBe(0);

        expect(world.terminal.lines).toEqual([
            ro('cli.doctor.ok', { check: ro('cli.doctor.node', { version: '24.21.0' }) }),
            ro('cli.doctor.ok', { check: ro('cli.doctor.firebase') }),
            ro('cli.doctor.optional', { check: ro('cli.doctor.gcloudMissing') }),
            ro('cli.doctor.ok', { check: ro('cli.doctor.manifest') }),
            ro('cli.doctor.ok', { check: ro('cli.doctor.pins') }),
            ro('cli.doctor.clean'),
        ]);
    });

    it('badPath_everyProblemOnItsOwnLine', async () => {
        const world = await city(release(), tools);

        expect(await runCli(['doctor', 'cluj', '--dry-run'], { ...world.ports, env: { ...world.ports.env, nodeVersion: '22.11.0' } })).toBe(
            1,
        );

        expect(world.terminal.lines).toEqual([
            ro('cli.doctor.problem', { check: ro('cli.doctor.nodeOld', { version: '22.11.0', min: '24.12.0' }) }),
            ro('cli.doctor.ok', { check: ro('cli.doctor.manifest') }),
            ro('cli.doctor.problem', { check: ro('cli.doctor.token') }),
            ro('cli.doctor.problem', { check: ro('cli.doctor.pinsUnpinned') }),
            ro('cli.doctor.summary', { count: 3 }),
        ]);
    });

    it('happyPath_theFolderTheCliRunsInAndAnUnreadableNodeVersion', async () => {
        const world = await city(release(pinned('1.0.0', 'a')), tools);
        const inside = fakes({ packageDir: release(), cwd: join(world.cwd, 'cluj'), runner: tools, env: { nodeVersion: 'v24' } });

        expect(await runCli(['doctor', '--dry-run'], inside.ports)).toBe(1);
        expect(inside.terminal.lines[0]).toBe(
            ro('cli.doctor.problem', { check: ro('cli.doctor.nodeOld', { version: 'v24', min: '24.12.0' }) }),
        );
        expect(await runCli(['upgrade'], inside.ports)).toBe(1);
        expect(inside.terminal.lines.at(-1)).toBe(ro('cli.upgrade.unpinned', { command: NPX_COMMAND }));
    });

    it('badPath_aMissingOrBrokenCityAndAnotherRelease', async () => {
        const world = await city(release(pinned('1.1.0', 'b')), tools);
        writeFileSync(
            join(world.cwd, 'cluj/index.html'),
            fillKitPage(read(join(world.cwd, 'cluj/index.html')), { engine: pinned('1.0.0', 'a') }),
        );
        writeFileSync(join(world.cwd, 'cluj/city.json'), '{ "version": 1 }');

        expect(await runCli(['doctor', 'cluj', '--dry-run'], world.ports)).toBe(1);
        expect(world.terminal.lines).toContain(ro('cli.doctor.problem', { check: ro('cli.doctor.pinsOther', { command: NPX_COMMAND }) }));
        expect(world.terminal.lines.some((line) => line.startsWith('[!!] city.json: city '))).toBe(true);

        world.terminal.lines.splice(0);
        writeFileSync(join(world.cwd, 'cluj/index.html'), '<!doctype html>\n');
        expect(await runCli(['doctor', 'nowhere', '--dry-run'], world.ports)).toBe(1);
        expect(world.terminal.lines).toEqual(
            expect.arrayContaining([
                ro('cli.doctor.problem', { check: ro('cli.doctor.manifestMissing') }),
                ro('cli.doctor.problem', { check: ro('cli.page.missing', { dir: 'nowhere' }) }),
            ]),
        );
        world.terminal.lines.splice(0);
        expect(await runCli(['doctor', 'cluj', '--dry-run'], world.ports)).toBe(1);
        expect(world.terminal.lines.some((line) => line.startsWith('[!!] index.html nu are blocul motorului'))).toBe(true);
    });
});
