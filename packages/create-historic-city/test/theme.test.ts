/** `theme` (UX review M5 #13): the map's colours from one colour, in city.json's theme and the page's theme-color. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fillKitPage, policyExtras, readKitEngine, readKitPolicy, validateManifest, type Manifest } from '@hcm/shared';
import { themeFromSeed } from '@hcm/ui/dynamic-color';
import { afterEach, describe, expect, it } from 'vitest';

import { translator } from '../src/i18n/index.js';
import { runCli } from '../src/main.js';
import { NPX_COMMAND } from '../src/version.js';
import { cleanUp, fakes, read, type Fakes } from './support.js';

const ro = translator('ro');
const used: string[] = [];

async function city(answers: readonly (string | null)[] = []): Promise<Fakes> {
    const world = fakes({ answers });
    used.push(world.cwd);
    expect(await runCli(['cluj', '--yes', '--name-ro', 'Cluj', '--bbox', '23.5,46.72,23.7,46.82'], world.ports)).toBe(0);
    world.terminal.lines.splice(0);
    return world;
}

function manifestIn(cwd: string): Manifest {
    const result = validateManifest(JSON.parse(read(join(cwd, 'cluj/city.json'))));
    expect(result.ok).toBe(true);
    return (result as { readonly value: Manifest }).value;
}

afterEach(() => {
    cleanUp(...used.splice(0));
});

describe('theme', () => {
    it('happyPath_theSeedsFourSchemesAndThePagesColourEverythingElseKept', async () => {
        const { ports, terminal, cwd } = await city();
        const page = join(cwd, 'cluj/index.html');
        const sources = { connect: ['https://tiles.example.org'], images: [] };
        writeFileSync(page, fillKitPage(read(page), { engine: readKitEngine(read(page)), sources }));
        const before = manifestIn(cwd);

        expect(await runCli(['theme', 'cluj', '--seed', '#1b6c4a'], ports)).toBe(0);

        const after = manifestIn(cwd);
        expect(after.city.theme).toEqual({ seedColor: '#1B6C4A', tokens: themeFromSeed('#1B6C4A') });
        expect({ ...after, city: { ...after.city, theme: before.city.theme } }).toEqual(before);
        expect(read(page)).toContain('<meta name="theme-color" content="#1B6C4A" />');
        expect(policyExtras(readKitPolicy(read(page))).sources).toEqual(sources);
        expect(terminal.lines.at(-1)).toBe(ro('cli.theme.done', { seed: '#1B6C4A' }));
    });

    it('happyPath_askedWithTheCurrentColourAndADryRunWritesNothing', async () => {
        const { ports, terminal, cwd } = await city(['#3d6b8c']);
        const before = read(join(cwd, 'cluj/city.json'));
        const seed = manifestIn(cwd).city.theme.seedColor;

        expect(await runCli(['theme', 'cluj', '--dry-run'], ports)).toBe(0);

        expect(terminal.questions).toEqual([ro('cli.ask.seed', { default: seed })]);
        expect(read(join(cwd, 'cluj/city.json'))).toBe(before);
        expect(terminal.lines.at(-1)).toBe(ro('cli.dryRun.nothing'));
    });

    it('badPath_whatThemeCannotChange', async () => {
        const { ports, terminal, cwd } = await city();

        expect(await runCli(['theme', 'nowhere', '--seed', '#1B6C4A'], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toBe(ro('cli.admin.noKit', { dir: 'nowhere', command: NPX_COMMAND }));

        expect(await runCli(['theme', 'cluj', '--seed', 'green'], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toBe(ro('cli.seed.invalid', { example: '#8B5E3C' }));

        writeFileSync(join(cwd, 'cluj/index.html'), '<!doctype html>\n<title>mine</title>\n');
        expect(await runCli(['theme', 'cluj', '--seed', '#1B6C4A'], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toMatch(/^index\.html nu are blocul motorului pe care îl pot citi: /);

        writeFileSync(join(cwd, 'cluj/city.json'), '{ "version": 1 }');
        expect(await runCli(['theme', 'cluj', '--seed', '#1B6C4A'], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toMatch(/^city\.json: city /);
    });

    it('badPath_aCityWithoutItsPage', async () => {
        const { ports, terminal, cwd } = await city();
        cleanUp(join(cwd, 'cluj/index.html'));

        expect(await runCli(['theme', 'cluj', '--seed', '#1B6C4A'], ports)).toBe(1);
        expect(terminal.lines.at(-1)).toBe(ro('cli.page.missing', { dir: 'cluj' }));
    });
});
