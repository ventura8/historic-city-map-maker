/** `create-historic-city [dir]`: the static scaffold with minimum input (docs/research/M5-interfaces.md §4.3). */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fillKitPage, KIT_PLACEHOLDER_TOKEN, NEW_CITY_SEEDS, readKitEngine, validateManifest, type Manifest } from '@hcm/shared';
import { themeFromSeed } from '@hcm/ui/dynamic-color';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/main.js';
import { translator } from '../src/i18n/index.js';
import { cleanUp, fakes, list, packageFolder, read, REPOSITORY, type Fakes } from './support.js';

const ro = translator('ro');
const en = translator('en');
const used: Fakes[] = [];

function world(answers: readonly (string | null)[] = []): Fakes {
    const made = fakes({ answers });
    used.push(made);
    return made;
}

afterEach(() => {
    cleanUp(...used.splice(0).map((made) => made.cwd));
});

function manifestIn(dir: string): Manifest {
    const result = validateManifest(JSON.parse(read(join(dir, 'city.json'))));
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.value;
}

describe('the template the CLI carries', () => {
    it('happyPath_itsThemeIsTheDefaultSeedsGeneratedTokens', () => {
        const template = JSON.parse(read(join(REPOSITORY, 'templates/starter-kit/city.json'))) as Manifest;

        expect(template.city.theme).toEqual({ seedColor: NEW_CITY_SEEDS[0], tokens: themeFromSeed(NEW_CITY_SEEDS[0]) });
    });
});

describe('scaffold', () => {
    it('happyPath_oneCommandWritesThreeFilesOfAValidCity', async () => {
        const { ports, terminal, cwd, runner } = world();

        const code = await runCli(['cluj', '--yes', '--name-ro', 'Cluj', '--bbox', '23.5,46.72,23.7,46.82'], ports);

        expect(code).toBe(0);
        expect(list(join(cwd, 'cluj'))).toEqual(['city.json', 'index.html', 'README.md']);
        const manifest = manifestIn(join(cwd, 'cluj'));
        expect(manifest.city.id).toBe('cluj');
        expect(manifest.city.name).toEqual({ ro: 'Cluj', en: 'Cluj' });
        expect(manifest.city.bounds).toEqual([
            [23.5, 46.72],
            [23.7, 46.82],
        ]);
        expect(manifest.city.center).toEqual([23.6, 46.77]);
        expect(manifest.city.theme).toEqual({ seedColor: NEW_CITY_SEEDS[0], tokens: themeFromSeed(NEW_CITY_SEEDS[0]) });
        expect(manifest.city.mapbox.publicToken).toBe(KIT_PLACEHOLDER_TOKEN);
        expect(manifest.city.about.ro).toContain('**Cluj**');
        expect(manifest.photos).toEqual([]);
        // The example places moved with the city.
        expect(manifest.pois?.[0]?.geometry).toEqual({ type: 'Point', coordinates: [23.600002, 46.769963] });
        const page = read(join(cwd, 'cluj/index.html'));
        expect(page).toContain('<title>Cluj</title>');
        expect(page).toContain('<h1 class="hcm-visually-hidden">Cluj</h1>');
        expect(page).toContain(`content="${ro('kit.description', { name: 'Cluj' })}"`);
        expect(page).toContain('<meta name="theme-color" content="#8B5E3C" />');
        const template = read(join(REPOSITORY, 'templates/starter-kit/index.html'));
        expect(readKitEngine(page)).toEqual(readKitEngine(template));
        expect(read(join(cwd, 'cluj/README.md'))).toBe(read(join(REPOSITORY, 'templates/starter-kit/README.md')));
        expect(terminal.questions).toEqual([]);
        expect(terminal.lines).toContain(ro('cli.scaffold.nextToken'));
        expect(terminal.lines).toContain(ro('cli.scaffold.done', { name: 'Cluj', dir: 'cluj' }));
        expect(runner.calls).toEqual([]);
    });

    it('happyPath_theQuestionsAnswerWhatNoOptionGave', async () => {
        const { ports, terminal, cwd } = world(['  Bacău  ', '', '#3d6b8c', 'pk.e2e-test-token']);

        const code = await runCli(['--lang', 'en'], ports);

        expect(code).toBe(0);
        expect(terminal.questions).toEqual([
            en('cli.ask.name', { default: 'Orașul meu' }),
            en('cli.ask.bbox', { default: '25.93,44.33,26.25,44.55', name: 'Orașul meu' }),
            en('cli.ask.seed', { default: '#8B5E3C' }),
            en('cli.ask.token'),
        ]);
        const manifest = manifestIn(join(cwd, 'bacau'));
        expect(manifest.city.name).toEqual({ ro: 'Bacău', en: 'Bacău' });
        expect(manifest.city.theme.seedColor).toBe('#3D6B8C');
        expect(manifest.city.mapbox.publicToken).toBe('pk.e2e-test-token');
        const page = read(join(cwd, 'bacau/index.html'));
        expect(page).toContain('<html lang="en">');
        expect(page).toContain('<hcm-map-viewer manifest-url="city.json" lang="en">');
        expect(terminal.lines).not.toContain(en('cli.scaffold.nextToken'));
    });

    it('happyPath_theEndOfTheInputTakesEveryDefault', async () => {
        const { ports, cwd } = world();

        expect(await runCli(['--name-en', 'My town'], ports)).toBe(0);

        const manifest = manifestIn(join(cwd, 'orasul-meu'));
        expect(manifest.city.name).toEqual({ ro: 'Orașul meu', en: 'My town' });
        expect(manifest.city.about.en).toContain('**My town**');
    });

    it('happyPath_aDryRunListsTheFilesAndWritesNothing', async () => {
        const { ports, terminal, cwd } = world();

        expect(await runCli(['oras', '--yes', '--dry-run'], ports)).toBe(0);

        expect(existsSync(join(cwd, 'oras'))).toBe(false);
        expect(terminal.lines.filter((line) => line.startsWith('Aș scrie: oras/'))).toHaveLength(3);
        expect(terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
    });
});

describe('scaffold: what it refuses', () => {
    it('badPath_aFolderThatIsNotEmptyIsLeftAlone', async () => {
        const { ports, terminal, cwd } = world(['Cluj']);
        mkdirSync(join(cwd, 'cluj'));
        writeFileSync(join(cwd, 'cluj/notes.txt'), 'mine\n');

        expect(await runCli(['cluj'], ports)).toBe(1);

        expect(terminal.questions).toEqual([]);
        expect(terminal.lines.at(-1)).toBe(ro('cli.target.notEmpty', { dir: 'cluj' }));
        expect(list(join(cwd, 'cluj'))).toEqual(['notes.txt']);
    });

    it('badPath_theFolderNamedAfterTheIdMustBeEmptyToo', async () => {
        const { ports, cwd } = world();
        mkdirSync(join(cwd, 'cluj'));
        writeFileSync(join(cwd, 'cluj/notes.txt'), 'mine\n');

        expect(await runCli(['--yes', '--name-ro', 'Cluj'], ports)).toBe(1);
        expect(list(join(cwd, 'cluj'))).toEqual(['notes.txt']);
    });

    it('badPath_aSecretTokenIsRefusedNeverWrittenOrShown', async () => {
        const secret = 'sk.e2e-secret-test-value';
        const { ports, terminal, cwd } = world(['Cluj', '23.5,46.72,23.7,46.82', '', secret, 'not-a-token', 'pk.e2e-public']);

        expect(await runCli(['cluj'], ports)).toBe(0);

        expect(terminal.lines).toContain(ro('cli.token.secret'));
        expect(terminal.lines).toContain(ro('cli.token.invalid'));
        expect(terminal.output).not.toContain(secret);
        expect(read(join(cwd, 'cluj/city.json'))).not.toContain('sk.');
        expect(manifestIn(join(cwd, 'cluj')).city.mapbox.publicToken).toBe('pk.e2e-public');
    });

    it('badPath_aRefusedAnswerIsAskedAgain', async () => {
        const { ports, terminal, cwd } = world(['', '1,2,3', '20,40,30,50', '20,40,20.001,40.001', '', 'red', '', '']);

        expect(await runCli(['oras'], ports)).toBe(0);

        expect(terminal.lines).toEqual(
            expect.arrayContaining([
                ro('cli.bbox.format'),
                ro('cli.bbox.tooBig', { max: 2 }),
                ro('cli.bbox.tooSmall', { min: 0.01 }),
                ro('cli.seed.invalid', { example: '#8B5E3C' }),
            ]),
        );
        expect(manifestIn(join(cwd, 'oras')).city.bounds).toEqual([
            [25.93, 44.33],
            [26.25, 44.55],
        ]);
    });

    it('badPath_refusedOptionsStopBeforeAnythingIsWritten', async () => {
        const cases: readonly (readonly [readonly string[], string])[] = [
            [['--bbox', '1,2,3'], ro('cli.bbox.format')],
            [['--bbox', '30,50,20,40'], ro('cli.bbox.bounds')],
            [['--seed', 'red'], ro('cli.seed.invalid', { example: '#8B5E3C' })],
            [['--id', 'admin'], ro('cli.id.invalid', { id: 'admin' })],
            [['--name-ro', ' '], ro('cli.name.empty')],
            [['--name-ro', '!!!', '--id', 'x'], ro('cli.id.invalid', { id: 'x' })],
        ];
        for (const [options, message] of cases) {
            const { ports, terminal, cwd } = world();

            expect(await runCli(['oras', '--yes', ...options], ports)).toBe(1);
            expect(terminal.lines.at(-1)).toBe(message);
            expect(existsSync(join(cwd, 'oras'))).toBe(false);
        }
    });

    it('badPath_aRefusedDefaultAtTheEndOfTheInputStops', async () => {
        const { ports, terminal } = world(['Cluj', null]);

        expect(await runCli(['oras', '--bbox', '23.5,46.72,23.7,46.82', '--seed', '#123456', '--name-en', ''], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toBe(ro('cli.name.empty'));
    });

    it('badPath_anInvalidBundledTemplateIsABug', async () => {
        const packageDir = packageFolder();
        writeFileSync(join(packageDir, 'template/city.json'), '{ "version": 1 }');
        const made = fakes({ packageDir });
        used.push(made);

        await expect(runCli(['oras', '--yes'], made.ports)).rejects.toThrow(/the bundled template\/city\.json is invalid/);
        cleanUp(packageDir);
    });

    it('happyPath_thePageOfTheKitIsTheTemplateFilledNotRewritten', async () => {
        const { ports, cwd } = world();
        await runCli(['oras', '--yes'], ports);
        const template = read(join(REPOSITORY, 'templates/starter-kit/index.html'));

        expect(read(join(cwd, 'oras/index.html'))).toBe(
            fillKitPage(template, {
                engine: readKitEngine(template),
                lang: 'ro',
                title: 'Orașul meu',
                heading: 'Orașul meu',
                description: ro('kit.description', { name: 'Orașul meu' }),
                themeColor: '#8B5E3C',
            }),
        );
    });
});
