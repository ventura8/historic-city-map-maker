/** The command line, help, version, usage errors and the CLI's languages (docs/research/M5-interfaces.md §4.2). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { version } from '../package.json';
import { parseOptions, UsageError } from '../src/args.js';
import { en } from '../src/i18n/en.js';
import { cliLocale, translator } from '../src/i18n/index.js';
import { ro } from '../src/i18n/ro.js';
import { runCli } from '../src/main.js';
import { cleanUp, fakes, packageFolder } from './support.js';

describe('parseOptions', () => {
    it('happyPath_theFirstWordIsACommandOrTheFolder', () => {
        expect(parseOptions([])).toMatchObject({ command: 'scaffold', dir: undefined, billingWait: 20, yes: false, dryRun: false });
        expect(parseOptions(['cluj', '-y', '--name-ro', 'Cluj'])).toMatchObject({
            command: 'scaffold',
            dir: 'cluj',
            yes: true,
            nameRo: 'Cluj',
        });
        expect(parseOptions(['self-host', 'cluj', '--project', 'cluj-harta', '--billing-wait', '0'])).toMatchObject({
            command: 'self-host',
            dir: 'cluj',
            project: 'cluj-harta',
            billingWait: 0,
        });
        // v1.0.0's notes name the flag: an old command line keeps working, and it changes nothing.
        expect(parseOptions(['--experimental', 'deploy'])).toMatchObject({ command: 'deploy' });
        expect(parseOptions(['theme', 'cluj', '--seed', '#1B6C4A'])).toMatchObject({ command: 'theme', dir: 'cluj', seed: '#1B6C4A' });
        expect(parseOptions(['doctor', '--lang', 'en', '--dry-run'])).toMatchObject({
            command: 'doctor',
            dir: undefined,
            lang: 'en',
            dryRun: true,
        });
        expect(parseOptions(['upgrade', '--help']).command).toBe('help');
        expect(parseOptions(['--version']).command).toBe('version');
    });

    it('badPath_whatItDoesNotUnderstandIsAUsageError', () => {
        for (const argv of [
            ['--colour', 'red'],
            ['cluj', 'extra'],
            ['deploy', 'cluj', 'extra'],
            ['--billing-wait', 'soon'],
            ['--billing-wait', '500'],
            ['--lang', 'fr'],
            ['--name-ro'],
        ]) {
            expect(() => parseOptions(argv)).toThrow(UsageError);
        }
    });
});

describe('runCli', () => {
    it('happyPath_helpAndVersion', async () => {
        const world = fakes({ env: { lang: 'en_GB.UTF-8' } });

        expect(await runCli(['--help'], world.ports)).toBe(0);
        expect(await runCli(['--version'], world.ports)).toBe(0);

        // docs/LESSONS.md 238: every printed command names this exact release, never a major line (@1).
        expect(world.terminal.lines[0]).toBe(en['cli.help.usage'].replaceAll('{version}', version));
        expect(world.terminal.lines[0]).toContain(`npx create-historic-city@${version} `);
        expect(world.terminal.lines).toHaveLength(11);
        expect(world.terminal.lines.at(-1)).toBe(version);
        cleanUp(world.cwd);
    });

    it('badPath_aUsageErrorEndsWithStatusTwoInTheTerminalsLanguage', async () => {
        const world = fakes({ env: { lang: 'en_US.UTF-8' } });

        expect(await runCli(['--colour', 'red'], world.ports)).toBe(2);

        expect(world.terminal.lines[0]).toMatch(/^I do not understand the command: .*colour.*\. See --help\.$/);
        cleanUp(world.cwd);
    });

    it('badPath_aBugIsNotDressedAsARefusal', async () => {
        const packageDir = packageFolder();
        writeFileSync(join(packageDir, 'template/city.json'), '{');
        const world = fakes({ packageDir });

        await expect(runCli(['oras', '--yes'], world.ports)).rejects.toThrow(SyntaxError);
        cleanUp(world.cwd, packageDir);
    });
});

describe('the CLI catalogue', () => {
    it('happyPath_theLanguageComesFromLangOrTheEnvironment', () => {
        expect(cliLocale('en', 'ro_RO.UTF-8')).toBe('en');
        expect(cliLocale(undefined, 'en_US.UTF-8')).toBe('en');
        expect(cliLocale(undefined, 'en')).toBe('en');
        expect(cliLocale(undefined, 'de_DE.UTF-8')).toBe('ro');
        expect(cliLocale(undefined, undefined)).toBe('ro');
    });

    it('happyPath_placeholdersAreFilledAndUnknownOnesStay', () => {
        expect(translator('ro')('cli.step.header', { n: 3, total: 9, title: 'X' })).toBe('Pasul 3 din 9: X');
        expect(translator('en')('cli.step.header', { n: 3 })).toBe('Step 3 of {total}: {title}');
    });

    it('badPath_bothLanguagesHoldTheSameKeysAndPlaceholders', () => {
        expect(Object.keys(en).sort((a, b) => a.localeCompare(b))).toEqual(Object.keys(ro).sort((a, b) => a.localeCompare(b)));
        for (const [key, text] of Object.entries(ro)) {
            const names = (value: string): string[] =>
                [...value.matchAll(/\{(\w+)\}/g)].map((match) => String(match[1])).sort((a, b) => a.localeCompare(b));
            expect({ key, names: names(en[key as keyof typeof ro]) }).toEqual({ key, names: names(text) });
        }
    });
});
