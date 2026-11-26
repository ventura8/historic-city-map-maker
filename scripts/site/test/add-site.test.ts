import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { ADD_EXIT_INVALID, ADD_EXIT_OK, ADD_EXIT_USAGE, addSite, configJs, runAddSite, siteJson } from '../src/add-site.js';
import { readConfigJs } from '../src/config-js.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { parseSiteSpec } from '../src/site-spec.js';
import { ROOT, cleanup, recordingLogger, temporaryDir } from './support.js';

/**
 * `npm run site:add` (`scripts/site/src/add-site.ts`, M5-interfaces §1.10; behaviour V26): a new city's public site,
 * written from the M1 files, which the site build reads as it is.
 */

const ENTRY = join(ROOT, 'scripts/site/add-site.ts');
const HOOK = join(ROOT, 'scripts/site/register-ts.mjs');
const CLUJ = { cityId: 'cluj-napoca', nameRo: 'Cluj-Napoca', theme: '#3A6EA5' };

function repository(): { root: string; files: SiteFileSystem } {
    const root = temporaryDir();
    const files = nodeFileSystem(root);
    files.write('sites/bucharest/site.css', nodeFileSystem(ROOT).readText('sites/bucharest/site.css'));
    return { root, files };
}

afterEach(cleanup);

describe('site:add', () => {
    it('happyPath_writesTheThreeFilesTheSiteBuildReads', () => {
        const { files } = repository();

        expect(addSite(CLUJ, files)).toBe('sites/cluj-napoca');

        const spec = parseSiteSpec(files.readText('sites/cluj-napoca/site.json'));
        expect(spec).toMatchObject({
            lang: 'ro',
            title: 'Cluj-Napoca',
            themeColor: '#3A6EA5',
            publicManifest: true,
            pagesPath: 'cluj-napoca/',
        });
        expect(spec.manifest).toBeUndefined();
        expect(readConfigJs(files.readText('sites/cluj-napoca/config.js'), 'config.js')).toMatchObject({ cityId: 'cluj-napoca' });
        expect(files.readText('sites/cluj-napoca/site.css')).toBe(files.readText('sites/bucharest/site.css'));
        expect(siteJson(CLUJ)).toContain('Cluj-Napoca de altădată');
        expect(configJs(CLUJ)).toContain("cityId: 'cluj-napoca'");
    });

    it.each([
        ['a reserved id', { ...CLUJ, cityId: 'engine' }, 'not a usable city id'],
        ['a malformed id', { ...CLUJ, cityId: 'Cluj Napoca' }, 'not a usable city id'],
        ['an empty name', { ...CLUJ, nameRo: '  ' }, 'the Romanian name'],
        ['a colour that is not #rrggbb', { ...CLUJ, theme: 'blue' }, 'the theme colour'],
    ] as const)('badPath_%s_writesNothing', (_name, site, words) => {
        const { files } = repository();

        expect(() => addSite(site, files)).toThrow(words);
        expect(files.listFiles('sites')).toEqual(['bucharest/site.css']);
    });

    it('badPath_anExistingSiteIsKept', () => {
        const { files } = repository();
        files.write('sites/cluj-napoca/site.json', '{"kept": true}');
        const { log, records } = recordingLogger();

        expect(runAddSite(['--city', 'cluj-napoca', '--name-ro', 'Cluj-Napoca', '--theme', '#3A6EA5'], { files, log })).toBe(
            ADD_EXIT_INVALID,
        );
        expect(records.at(-1)?.message).toContain('sites/cluj-napoca/ exists already');
        expect(files.readText('sites/cluj-napoca/site.json')).toBe('{"kept": true}');
    });

    it('badPath_aMissingOptionIsAUsageError', () => {
        const { files } = repository();
        const { log, records } = recordingLogger();

        expect(runAddSite(['--city', 'bacau'], { files, log })).toBe(ADD_EXIT_USAGE);
        expect(runAddSite(['--bogus'], { files, log })).toBe(ADD_EXIT_USAGE);
        expect(records[0]?.message).toContain('usage: add-site.ts');
    });

    it('badPath_aBugIsNotSwallowed', () => {
        const { files } = repository();
        const broken: SiteFileSystem = {
            ...files,
            write: () => {
                throw new Error('disk full');
            },
        };

        expect(() =>
            runAddSite(['--city', 'bacau', '--name-ro', 'Bacău', '--theme', '#112233'], { files: broken, log: recordingLogger().log }),
        ).toThrow('disk full');
    });

    it('happyPath_runsUnderNodeWithTheTypeScriptHook', () => {
        const { root, files } = repository();

        const result = spawnSync(
            process.execPath,
            ['--import', HOOK, ENTRY, '--city', 'bacau', '--name-ro', 'Bacău', '--theme', '#112233'],
            {
                cwd: root,
                encoding: 'utf8',
            },
        );

        expect(result).toMatchObject({ status: ADD_EXIT_OK });
        expect(files.isFile('sites/bacau/site.json')).toBe(true);
    });
});
