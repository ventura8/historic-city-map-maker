/** The engine in the tree (docs/research/M5-interfaces.md §2.3): cdn/engine/ and its release.json. */
import { createHash } from 'node:crypto';

import { ENGINE_REPOSITORY, engineReleaseSchema, validate } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
    CDN_ENGINE,
    RELEASE_JSON,
    engineReleaseOf,
    mapboxGlRelease,
    releaseFolder,
    releaseFolderProblems,
    releasedBytes,
    releasedFiles,
    repositoryVersion,
    writeReleaseFolder,
} from '../src/cdn.js';
import { readJsonObject } from '../src/files.js';
import { MAPBOX_CSS, MAPBOX_JS, cleanup, fakeRepository, withEngineBuild } from './support.js';

afterEach(cleanup);

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const sri = (value: string | Uint8Array): string => `sha384-${createHash('sha384').update(value).digest('base64')}`;

describe('releasedBytes', () => {
    it.each([
        ['engine.iife.js', 'var a=1;\n//# sourceMappingURL=engine.iife.js.map', 'var a=1;\n'],
        ['chunk.mjs', 'export{};\n//# sourceMappingURL=chunk.mjs.map\n', 'export{};\n'],
        ['engine.css', '.a{}\n/*# sourceMappingURL=engine.css.map */', '.a{}\n'],
        ['engine.css', '.a{}\n/*$vite$:1*/', '.a{}\n/*$vite$:1*/\n'],
        ['THIRD_PARTY_NOTICES.txt', 'notices\n', 'notices\n'],
        ['fonts/LICENSES.md', '# Fonts', '# Fonts\n'],
        ['empty.js', '', ''],
    ])('happyPath_%s_losesItsSourceMapLineAndEndsInANewline', (path, input, output) => {
        expect(text(releasedBytes(path, bytes(input)))).toBe(output);
    });

    it('happyPath_aMapLineInsideTheCodeIsKept', () => {
        const input = 'const s="\\n//# sourceMappingURL=x";\nvar b=2;\n';

        expect(text(releasedBytes('a.js', bytes(input)))).toBe(input);
    });

    it('happyPath_litHtmlsWhitespaceClassLosesItsTrailingWhitespace', () => {
        // DECISIONS-for-review.md §160: the minifier writes lit-html's `[ \t\n\f\r]` with a real tab and line break.
        const raw = 'gf=`[ \t\n\\f\\r]`,_f=1;\n';
        const released = text(releasedBytes('engine.mjs', bytes(raw)));

        expect(released).toBe('gf=`[ \\t\\n\\f\\r]`,_f=1;\n');
        expect(released.split('\n').some((line) => /[ \t]$/.test(line))).toBe(false);
        expect(text(releasedBytes('engine.css', bytes(raw)))).toBe(raw);
    });

    it('happyPath_binaryFilesAreCopiedAsTheyAre', () => {
        const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x0a, 0x20]);

        expect(releasedBytes('fonts/x.woff2', font)).toBe(font);
    });

    it('badPath_aTextFileThatIsNotUtf8IsRefused', () => {
        expect(() => releasedBytes('a.js', new Uint8Array([0xff, 0xfe]))).toThrow(TypeError);
    });
});

describe('the release folder', () => {
    it('happyPath_everyBuiltFileButTheMapsTransformed', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);

        const released = releasedFiles(files);

        expect(released.map((file) => file.path)).toEqual([
            'THIRD_PARTY_NOTICES.txt',
            'compare-AbC123.js',
            'engine.css',
            'engine.iife.js',
            'engine.mjs',
            'fonts/roboto-flex-latin-wght.woff2',
        ]);
        expect(text(released[3]?.content ?? new Uint8Array())).toBe('var HistoricCityMap=(function(){return {}})();\n');
    });

    it('badPath_withoutTheEngineBuildNothingIsReleased', () => {
        const { files } = fakeRepository('1.0.0');

        expect(() => releasedFiles(files)).toThrow(/build the engine first/);
    });

    it('happyPath_mapboxGlIsPinnedFromTheInstalledRelease', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);

        expect(mapboxGlRelease(files)).toEqual({
            version: '3.34.1',
            script: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js', integrity: sri(MAPBOX_JS) },
            stylesheet: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css', integrity: sri(MAPBOX_CSS) },
        });
    });

    it('badPath_anotherInstalledMapboxReleaseIsRefused', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files, '3.31.0');

        expect(() => mapboxGlRelease(files)).toThrow(/node_modules\/mapbox-gl is 3.31.0, the engine is written against 3.34.1/);
    });

    it('happyPath_theReleaseFileListsEveryFileWithItsSizeAndIntegrity', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);

        const folder = releaseFolder(files);
        const release = folder.release;

        expect(validate(engineReleaseSchema, release).ok).toBe(true);
        expect(release.version).toBe('1.0.0');
        expect(release.repository).toBe(ENGINE_REPOSITORY);
        expect(release.base).toBe('https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.0.0/cdn/engine/');
        const css = '.hcm-engine-root{display:block}\n/*$vite$:1*/\n';
        expect(release.files.find((file) => file.path === 'engine.css')).toEqual({
            path: 'engine.css',
            bytes: css.length,
            integrity: sri(css),
        });
        expect(folder.files.at(-1)?.path).toBe('release.json');
        expect(JSON.parse(text(folder.files.at(-1)?.content ?? new Uint8Array()))).toEqual(release);
    });

    it('badPath_aBuildWithoutTheStylesheetMakesNoReleaseFile', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);
        files.remove('packages/engine/dist/engine.css');

        expect(() => releaseFolder(files)).toThrow(/the release file would be invalid:\nfiles:/);
    });

    it('badPath_aRepositoryWithoutAVersionHasNoRelease', () => {
        const { files } = fakeRepository('1.0.0');
        files.write('package.json', '{"name":"x"}');

        expect(() => repositoryVersion(files)).toThrow('package.json has no version');
    });

    it('happyPath_writingReplacesTheFolderAndTheCheckThenPasses', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);
        files.write(`${CDN_ENGINE}/compare-OLD.js`, 'stale');

        const release = writeReleaseFolder(files);

        expect(files.isFile(`${CDN_ENGINE}/compare-OLD.js`)).toBe(false);
        expect(files.isFile(`${CDN_ENGINE}/engine.iife.js.map`)).toBe(false);
        expect(readJsonObject(files, RELEASE_JSON)).toEqual(release);
        expect(releaseFolderProblems(files)).toEqual({ release, problems: [] });
    });

    it('badPath_everyDifferenceFromAFreshBuildIsListed', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);
        writeReleaseFolder(files);
        files.write(`${CDN_ENGINE}/engine.css`, '.edited{}\n');
        files.write(`${CDN_ENGINE}/engine.mjs`, 'export const v=2;\n');
        files.remove(`${CDN_ENGINE}/fonts`);
        files.write(`${CDN_ENGINE}/extra.js`, 'x');
        files.write('packages/engine/dist/engine.mjs', 'export const v=2;\n//# sourceMappingURL=engine.mjs.map');

        expect(releaseFolderProblems(files).problems).toEqual([
            `${CDN_ENGINE}/engine.css: differs from a fresh build (10 bytes, expected ${String('.hcm-engine-root{display:block}\n/*$vite$:1*/\n'.length)})`,
            `${CDN_ENGINE}/fonts/roboto-flex-latin-wght.woff2: missing`,
            expect.stringMatching(/^cdn\/engine\/release\.json: differs from a fresh build \(\d+ bytes, expected \d+\)$/),
            `${CDN_ENGINE}/extra.js: not part of the build`,
        ]);
    });

    it('badPath_aVersionBumpWithoutANewFolderIsCaught', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);
        writeReleaseFolder(files);
        files.write('package.json', '{"version":"1.0.1"}');

        expect(releaseFolderProblems(files).problems).toEqual([
            expect.stringMatching(/^cdn\/engine\/release\.json: differs from a fresh build/),
        ]);
    });

    it('badPath_beforeTheFirstReleaseTheFolderIsMissing', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);

        expect(releaseFolderProblems(files).problems).toEqual([
            `${RELEASE_JSON} is missing: run npm run release:cdn on the release commit`,
        ]);
    });

    it('happyPath_theReleaseFileIsMadeFromWhatIsGiven', () => {
        const mapboxGl = {
            version: '3.34.1',
            script: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js', integrity: sri('s') },
            stylesheet: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css', integrity: sri('c') },
        };
        const released = [
            { path: 'engine.iife.js', content: bytes('a\n') },
            { path: 'engine.css', content: bytes('b\n') },
        ];

        expect(engineReleaseOf('2.3.4', released, mapboxGl).files).toEqual([
            { path: 'engine.iife.js', bytes: 2, integrity: sri('a\n') },
            { path: 'engine.css', bytes: 2, integrity: sri('b\n') },
        ]);
    });
});
