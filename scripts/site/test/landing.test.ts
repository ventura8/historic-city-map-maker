/** The project's landing page on GitHub Pages (docs/research/DECISIONS-for-review.md §162). */
import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem } from '../src/files.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, LANDING_DIR, landingFiles, runLandingCli } from '../src/landing/build.js';
import { EXAMPLE_URL, LANDING_FILES, START_SITE_URL } from '../src/landing/page.js';
import { LANDING_CATALOGUES, LANDING_KEYS, landingCatalogues, missingLandingKeys } from '../src/landing/texts.js';
import { cleanup, htmlValidateMessages, recordingLogger, ROOT, temporaryDir } from './support.js';

afterEach(cleanup);

const VERSION = (JSON.parse(nodeFileSystem(ROOT).readText('package.json')) as { version: string }).version;

/** A repository with only a root package.json at `version`, in a temporary folder. */
function tinyRepository(version: string | null = '1.2.3-beta.4'): ReturnType<typeof nodeFileSystem> {
    const files = nodeFileSystem(temporaryDir());
    files.write('package.json', JSON.stringify(version === null ? { name: 'x' } : { name: 'x', version }));
    return files;
}

describe('the landing page', () => {
    it('happyPath_bothLanguagesNameTheProductAndLinkTheStartPageTheExampleAndEachOther', () => {
        const pages = Object.fromEntries(landingFiles(nodeFileSystem(ROOT)).map((file) => [file.path, file.text]));
        expect(Object.keys(pages)).toEqual(['index.html', 'landing.css', 'ro.html']);
        for (const [lang, other] of [
            ['en', 'ro'],
            ['ro', 'en'],
        ] as const) {
            const page = String(pages[LANDING_FILES[lang]]);
            expect(page).toContain(`<html lang="${lang}">`);
            expect(page).toContain('<h1>Historic City Map Maker</h1>');
            expect(page).toContain(`href="${START_SITE_URL}"`);
            expect(page).toContain(`href="${EXAMPLE_URL}"`);
            expect(page).toContain(`href="${LANDING_FILES[other]}"`);
            expect(page).toContain(`npx create-historic-city@${VERSION} self-host`);
            expect(page).not.toContain('create-historic-city@1 ');
            expect(page).not.toContain('<script');
            expect(page).toContain("script-src 'none'");
            expect(page.split('\n').some((line) => /[ \t]$/.test(line))).toBe(false);
        }
    });

    it('happyPath_everyLocalLinkNamesAFileOfTheFolder', () => {
        const built = landingFiles(nodeFileSystem(ROOT));
        const names = new Set(built.map((file) => file.path));
        const local = built.flatMap((file) => [...file.text.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => String(match[1])));
        const relative = local.filter((href) => !href.startsWith('https://') && !href.startsWith('data:'));
        expect(relative.length).toBeGreaterThan(0);
        expect(relative.filter((href) => !names.has(href))).toEqual([]);
        expect(local.filter((href) => href.startsWith('http://'))).toEqual([]);
    });

    it('happyPath_thePagesPassTheRepositorysHtmlRules', async () => {
        for (const file of landingFiles(nodeFileSystem(ROOT)).filter((built) => built.path.endsWith('.html'))) {
            expect(await htmlValidateMessages(file.text, `${LANDING_DIR}/${file.path}`)).toEqual([]);
        }
    });

    it('happyPath_theCommittedFolderIsWhatTheBuildWrites', () => {
        const { log, records } = recordingLogger();
        expect(runLandingCli(['--check'], { files: nodeFileSystem(ROOT), log })).toBe(EXIT_OK);
        expect(records.at(-1)?.message).toBe(`[landing] OK: ${LANDING_DIR} is what the build writes`);
    });

    it('happyPath_theBuildWritesTheFolderAndThenChecksIt', () => {
        const files = tinyRepository();
        files.write('sites/landing/old.html', 'stale');
        const { log } = recordingLogger();
        expect(runLandingCli([], { files, log })).toBe(EXIT_OK);
        expect(files.listFiles('sites/landing')).toEqual(['index.html', 'landing.css', 'ro.html']);
        expect(files.readText('sites/landing/ro.html')).toContain('npx create-historic-city@1.2.3-beta.4 self-host');
        expect(runLandingCli(['--check'], { files, log })).toBe(EXIT_OK);
    });
});

describe('the landing page refused', () => {
    it('badPath_aMissingOrEmptyKeyStopsTheBuildBeforeAnythingIsWritten', () => {
        const files = tinyRepository();
        const withoutTitle = Object.fromEntries(Object.entries(LANDING_CATALOGUES.ro).filter(([key]) => key !== 'title'));
        const catalogues = { en: { ...LANDING_CATALOGUES.en, footer: ' ' }, ro: withoutTitle };
        const { log, records } = recordingLogger();

        expect(missingLandingKeys(catalogues)).toEqual(['en: footer', 'ro: title']);
        expect(() => landingCatalogues(catalogues)).toThrow("the landing page's words are incomplete: en: footer, ro: title");
        expect(runLandingCli([], { files, log }, catalogues)).toBe(EXIT_INVALID);
        expect(records.at(-1)?.message).toBe("the landing page's words are incomplete: en: footer, ro: title");
        expect(files.isFile('sites/landing/index.html')).toBe(false);
    });

    it('happyPath_theShippedCataloguesAreComplete', () => {
        expect(missingLandingKeys(LANDING_CATALOGUES)).toEqual([]);
        expect(Object.keys(LANDING_CATALOGUES.ro).sort((a, b) => a.localeCompare(b))).toEqual(
            [...LANDING_KEYS].sort((a, b) => a.localeCompare(b)),
        );
    });

    it('badPath_aStaleOrForeignFileFailsTheCheck', () => {
        const files = tinyRepository();
        const { log, records } = recordingLogger();
        runLandingCli([], { files, log });
        files.write('sites/landing/ro.html', 'changed');
        files.write('sites/landing/extra.txt', 'x');

        expect(runLandingCli(['--check'], { files, log })).toBe(EXIT_INVALID);
        expect(records.at(-1)?.data).toEqual({
            problems: ['sites/landing/ro.html: missing or not what the build writes', 'sites/landing/extra.txt: not written by the build'],
        });
    });

    it('badPath_aMissingFolderFailsTheCheck', () => {
        const { log } = recordingLogger();
        expect(runLandingCli(['--check'], { files: tinyRepository(), log })).toBe(EXIT_INVALID);
    });

    it('badPath_aRepositoryWithoutAVersionHasNoTerminalRoad', () => {
        const { log, records } = recordingLogger();
        expect(runLandingCli([], { files: tinyRepository(null), log })).toBe(EXIT_INVALID);
        expect(records.at(-1)?.message).toBe('package.json has no version for the landing page’s terminal road');
    });

    it('badPath_anUnknownOptionIsAUsageError', () => {
        const { log } = recordingLogger();
        expect(runLandingCli(['--nope'], { files: tinyRepository(), log })).toBe(EXIT_USAGE);
    });

    it('badPath_anErrorThatIsNoBuildErrorIsThrown', () => {
        const files = tinyRepository();
        files.write('package.json', '{');
        const { log } = recordingLogger();
        expect(() => runLandingCli([], { files, log })).toThrow(SyntaxError);
    });
});
