/** The release scripts' command lines: exit statuses, what they write and what they log. */
import { afterEach, describe, expect, it } from 'vitest';

import { CDN_ENGINE, RELEASE_JSON } from '../src/cdn.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, runBump, runCdn, runNotes } from '../src/cli.js';
import { readJsonObject, type ReleaseFiles } from '../src/files.js';
import { SRI_BLOCK_END, SRI_BLOCK_START } from '../src/notes-sri.js';
import { cleanup, fakeRepository, messages, recordingLogger, withEngineBuild } from './support.js';

afterEach(cleanup);

const DESCRIPTION = 'docs/releases/v1.0.0_github_description.md';

function released(): ReleaseFiles {
    const { files } = fakeRepository('1.0.0');
    return withEngineBuild(files);
}

describe('release:bump', () => {
    it('happyPath_writesEveryVersionAndNamesTheNextStep', () => {
        const { files } = fakeRepository('0.0.0');
        const { log, records } = recordingLogger();

        expect(runBump(['1.0.0'], { files, log })).toBe(EXIT_OK);

        expect(readJsonObject(files, 'packages/shared/package.json')['version']).toBe('1.0.0');
        expect(messages(records, 'info')).toEqual([
            'every version is 1.0.0',
            'next: npm run build --workspace @hcm/engine, then npm run release:cdn (quality/prepare_release_skill.md)',
        ]);
        expect(records[0]?.data?.['rewritten']).toContain('package-lock.json');
    });

    it.each([[[]], [['1.0.0', '1.0.1']]])('badPath_%j_isAUsageError', (argv) => {
        const { files } = fakeRepository();
        const { log, records } = recordingLogger();

        expect(runBump(argv, { files, log })).toBe(EXIT_USAGE);
        expect(messages(records, 'error')).toEqual(['usage: release:bump -- <MAJOR.MINOR.PATCH>']);
    });

    it('badPath_anUnknownOptionIsAUsageError', () => {
        const { files } = fakeRepository();
        const { log, records } = recordingLogger();

        expect(runBump(['--force', '1.0.0'], { files, log })).toBe(EXIT_USAGE);
        expect(messages(records, 'error')).toEqual(['usage: release:bump -- <MAJOR.MINOR.PATCH>']);
        expect(String(records[0]?.data?.['reason'])).toContain('--force');
    });

    it('badPath_aVersionWithAVIsRefusedAndNothingIsWritten', () => {
        const { files } = fakeRepository('0.0.0');
        const { log, records } = recordingLogger();

        expect(runBump(['v1.0.0'], { files, log })).toBe(EXIT_INVALID);
        expect(messages(records, 'error')).toEqual([
            '"v1.0.0" is not a release version MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N / -rc.N (no v, no other suffix)',
        ]);
        expect(readJsonObject(files, 'package.json')['version']).toBe('0.0.0');
    });
});

describe('release:cdn', () => {
    it('happyPath_writesTheFolderThenTheGateAcceptsItAndWritesTheSummary', () => {
        const files = released();
        const { log, records } = recordingLogger();

        expect(runCdn([], { files, log })).toBe(EXIT_OK);
        expect(runCdn(['--check', '--summary', 'reports/release/engine-addresses.md'], { files, log })).toBe(EXIT_OK);

        expect(files.isFile(RELEASE_JSON)).toBe(true);
        expect(messages(records, 'info')).toEqual([
            'wrote cdn/engine/ for 1.0.0',
            'cdn/engine/ is the release folder of a fresh build of 1.0.0',
        ]);
        const summary = files.readText('reports/release/engine-addresses.md');
        expect(summary.startsWith(`${SRI_BLOCK_START}\n`)).toBe(true);
        expect(summary.endsWith(`${SRI_BLOCK_END}\n`)).toBe(true);
    });

    it('badPath_aFolderThatDriftedFailsTheGateWithEveryDifference', () => {
        const files = released();
        const { log, records } = recordingLogger();
        runCdn([], { files, log });
        files.write(`${CDN_ENGINE}/engine.css`, '.x{}\n');

        expect(runCdn(['--check', '--summary', 'reports/release/engine-addresses.md'], { files, log })).toBe(EXIT_INVALID);

        expect(messages(records, 'error')).toEqual([
            expect.stringMatching(/^cdn\/engine\/ is not the release folder of a fresh build:\ncdn\/engine\/engine\.css: differs/),
            'rebuild it on the release commit: npm run build --workspace @hcm/engine && npm run release:cdn',
        ]);
        expect(files.isFile('reports/release/engine-addresses.md')).toBe(false);
    });

    it('badPath_withoutTheEngineBuildTheReasonIsLogged', () => {
        const { files } = fakeRepository('1.0.0');
        const { log, records } = recordingLogger();

        expect(runCdn([], { files, log })).toBe(EXIT_INVALID);
        expect(messages(records, 'error')).toEqual([expect.stringMatching(/build the engine first/)]);
    });

    it('badPath_aPositionalIsAUsageError', () => {
        const { log, records } = recordingLogger();

        expect(runCdn(['cdn/engine'], { files: released(), log })).toBe(EXIT_USAGE);
        expect(messages(records, 'error')).toEqual(['usage: release:cdn [-- --check] [--summary <file>]']);
    });

    it.each([
        new RangeError('disk on fire'),
        new TypeError('not a usage error'),
        Object.assign(new TypeError('coded'), { code: 'ENOENT' }),
    ])('badPath_aBugIsNotSwallowed_%s', (bug) => {
        const files = released();
        const broken: ReleaseFiles = {
            ...files,
            listFiles: () => {
                throw bug;
            },
        };

        expect(() => runCdn([], { files: broken, log: recordingLogger().log })).toThrow(bug);
    });
});

describe('release:notes', () => {
    it('happyPath_writesTheBlockIntoTheDescription', () => {
        const files = released();
        const { log, records } = recordingLogger();
        runCdn([], { files, log });
        files.write(DESCRIPTION, `# Release v1.0.0 - First\n\n${SRI_BLOCK_START}\n${SRI_BLOCK_END}\n`);

        expect(runNotes(['--write', DESCRIPTION], { files, log })).toBe(EXIT_OK);

        expect(files.readText(DESCRIPTION)).toContain('| Engine script | `https://cdn.jsdelivr.net/gh/');
        expect(messages(records, 'info').at(-1)).toBe(`wrote the pinned addresses of 1.0.0 into ${DESCRIPTION}`);
    });

    it('badPath_withoutAFileToWriteItIsAUsageError', () => {
        const { log, records } = recordingLogger();

        expect(runNotes([], { files: released(), log })).toBe(EXIT_USAGE);
        expect(messages(records, 'error')).toEqual(['usage: release:notes -- --write docs/releases/vX.Y.Z_github_description.md']);
    });

    it('badPath_aMissingDescriptionIsRefused', () => {
        const { log, records } = recordingLogger();

        expect(runNotes(['--write', DESCRIPTION], { files: released(), log })).toBe(EXIT_INVALID);
        expect(messages(records, 'error')).toEqual([`${DESCRIPTION} is missing: write the release notes first (docs/releases/README.md)`]);
    });

    it('badPath_beforeTheReleaseFolderExistsThereIsNothingToWrite', () => {
        const files = released();
        const { log, records } = recordingLogger();
        files.write(DESCRIPTION, `${SRI_BLOCK_START}\n${SRI_BLOCK_END}\n`);

        expect(runNotes(['--write', DESCRIPTION], { files, log })).toBe(EXIT_INVALID);
        expect(messages(records, 'error')).toEqual([`${RELEASE_JSON} is missing`]);
    });
});
