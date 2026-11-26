/** A release's pinned addresses and their integrity in its GitHub description (docs/research/M5-interfaces.md §2.5). */
import { ENGINE_REPOSITORY, type EngineRelease } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { jsonText, nodeReleaseFiles } from '../src/files.js';
import { SRI_BLOCK_END, SRI_BLOCK_START, pinnedSubresources, readRelease, sriBlock, withSriBlock } from '../src/notes-sri.js';
import { cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

/** Generated test digests (64 base64 characters each), never a real file's. */
const sri = (letter: string): string => `sha384-${letter.repeat(64)}`;
const BASE = 'https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.2.0/cdn/engine/';

const RELEASE: EngineRelease = {
    version: '1.2.0',
    repository: ENGINE_REPOSITORY,
    base: BASE,
    mapboxGl: {
        version: '3.34.1',
        script: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js', integrity: sri('M') },
        stylesheet: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css', integrity: sri('N') },
    },
    files: [
        { path: 'engine.css', bytes: 272, integrity: sri('B') },
        { path: 'engine.iife.js', bytes: 424_503, integrity: sri('A') },
    ],
};

describe('pinned subresources', () => {
    it('happyPath_mapboxThenTheEngineEachStylesheetFirst', () => {
        expect(pinnedSubresources(RELEASE)).toEqual([
            { label: 'Mapbox GL JS stylesheet', kind: 'stylesheet', url: RELEASE.mapboxGl.stylesheet.url, integrity: sri('N') },
            { label: 'Mapbox GL JS script', kind: 'script', url: RELEASE.mapboxGl.script.url, integrity: sri('M') },
            { label: 'Engine stylesheet', kind: 'stylesheet', url: `${BASE}engine.css`, integrity: sri('B') },
            { label: 'Engine script', kind: 'script', url: `${BASE}engine.iife.js`, integrity: sri('A') },
        ]);
    });

    it('badPath_aReleaseWithoutAPageFileHasNoPins', () => {
        const partial = { ...RELEASE, files: [{ path: 'engine.iife.js', bytes: 1, integrity: sri('A') }] };

        expect(() => pinnedSubresources(partial)).toThrow('the release file does not list engine.css');
    });

    it('happyPath_theBlockHasTheTableTheFoldersAndTheTagsToPaste', () => {
        const block = sriBlock(RELEASE).split('\n');

        expect(block[0]).toBe(SRI_BLOCK_START);
        expect(block.at(-1)).toBe(SRI_BLOCK_END);
        expect(block).toContain(`| Engine script | \`${BASE}engine.iife.js\` | \`${sri('A')}\` |`);
        expect(block).toContain(`| Mapbox GL JS stylesheet | \`${RELEASE.mapboxGl.stylesheet.url}\` | \`${sri('N')}\` |`);
        expect(block).toContain(`Every file of the release with its size and integrity: \`${BASE}release.json\`.`);
        expect(block).toContain(
            'The 1.x line without integrity, for a page that follows every compatible release: `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/cdn/engine/`.',
        );
        expect(block).toContain(`<script src="${BASE}engine.iife.js" integrity="${sri('A')}" crossorigin="anonymous" defer></script>`);
        expect(block).toContain(`<link rel="stylesheet" href="${BASE}engine.css" integrity="${sri('B')}" crossorigin="anonymous" />`);
    });
});

describe('a pre-release’s block', () => {
    const PRE_BASE = 'https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.2.0-beta.1/cdn/engine/';
    const PRE: EngineRelease = { ...RELEASE, version: '1.2.0-beta.1', base: PRE_BASE };

    it('happyPath_aPreReleaseIsPinnedAtItsFullVersionAndOffersNoMajorLine', () => {
        const block = sriBlock(PRE).split('\n');

        expect(block).toContain(`| Engine script | \`${PRE_BASE}engine.iife.js\` | \`${sri('A')}\` |`);
        expect(block).toContain('A pre-release is served only at its exact version: no major line (such as `@1`) resolves to it.');
        expect(block.join('\n')).not.toContain('historic-city-map-maker@1/');
    });

    it('badPath_aPreReleaseOfAnotherFormIsNoRelease', () => {
        expect(() => sriBlock({ ...PRE, version: '1.2.0-alpha.1' })).toThrow(RangeError);
    });
});

describe('the notes’ block', () => {
    const NOTES = `# Release v1.2.0 - Title\n\nIntro.\n\n${SRI_BLOCK_START}\nold\n${SRI_BLOCK_END}\n\n## After\n`;

    it('happyPath_onlyTheBlockBetweenTheMarkersIsReplaced', () => {
        expect(withSriBlock(NOTES, RELEASE)).toBe(`# Release v1.2.0 - Title\n\nIntro.\n\n${sriBlock(RELEASE)}\n\n## After\n`);
        expect(withSriBlock(withSriBlock(NOTES, RELEASE), RELEASE)).toBe(withSriBlock(NOTES, RELEASE));
    });

    it.each([
        ['no start', `${SRI_BLOCK_END}\n`, `the notes must hold the line ${SRI_BLOCK_START} exactly once`],
        ['no end', `${SRI_BLOCK_START}\n`, `the notes must hold the line ${SRI_BLOCK_END} exactly once`],
        [
            'two starts',
            `${SRI_BLOCK_START}\n${SRI_BLOCK_START}\n${SRI_BLOCK_END}\n`,
            `the notes must hold the line ${SRI_BLOCK_START} exactly once`,
        ],
        ['reversed', `${SRI_BLOCK_END}\n${SRI_BLOCK_START}\n`, `${SRI_BLOCK_END} comes before ${SRI_BLOCK_START}`],
    ])('badPath_%s_isRefused', (_name, markdown, reason) => {
        expect(() => withSriBlock(markdown, RELEASE)).toThrow(reason);
    });

    it('happyPath_readsAValidReleaseFile', () => {
        const files = nodeReleaseFiles(temporaryDir());
        files.write('release.json', jsonText(RELEASE));

        expect(readRelease(files, 'release.json')).toEqual(RELEASE);
    });

    it('badPath_anInvalidReleaseFileIsRefusedWithItsIssues', () => {
        const files = nodeReleaseFiles(temporaryDir());
        files.write('release.json', jsonText({ ...RELEASE, base: 'https://cdn.jsdelivr.net/gh/someone/else@v1.2.0/cdn/engine/' }));

        expect(() => readRelease(files, 'release.json')).toThrow(/release.json is not a valid release file:\nbase:/);
    });
});
