import { afterEach, describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { assemblePages } from '../src/pages.js';
import { cleanup, temporaryDir } from './support.js';

/**
 * The GitHub Pages tree of every city (`scripts/site/src/pages.ts`, M5-interfaces §1.10; behaviour V26): Bucharest at
 * the root, every other city in its folder, and a tree refused (nothing written) when two sites clash.
 */

function builtSites(): SiteFileSystem {
    const files = nodeFileSystem(temporaryDir());
    for (const [site, extra] of [
        ['bucharest', 'data/manifest.json'],
        ['cluj', 'engine/engine.mjs'],
        ['bacau', 'engine/engine.mjs'],
    ] as const) {
        files.write(`dist/site/${site}/index.html`, `<title>${site}</title>`);
        files.write(`dist/site/${site}/${extra}`, site);
    }
    files.write('dist/site/bucharest/engine/engine.mjs', 'engine');
    return files;
}

afterEach(cleanup);

describe('assemblePages', () => {
    it('happyPath_bucharestAtTheRootAndEachCityInItsFolder', () => {
        const files = builtSites();
        files.write('dist/pages/stale.txt', 'from the last build');

        const report = assemblePages(
            [
                { outDir: 'dist/site/bucharest', pagesPath: '' },
                { outDir: 'dist/site/cluj', pagesPath: 'cluj/' },
                { outDir: 'dist/site/bacau', pagesPath: 'bacau/' },
            ],
            'dist/pages',
            files,
        );

        expect(report).toEqual({ pagesDir: 'dist/pages', paths: ['/', '/cluj/', '/bacau/'], files: 7 });
        expect(files.listFiles('dist/pages')).toEqual([
            'bacau/engine/engine.mjs',
            'bacau/index.html',
            'cluj/engine/engine.mjs',
            'cluj/index.html',
            'data/manifest.json',
            'engine/engine.mjs',
            'index.html',
        ]);
        expect(files.readText('dist/pages/index.html')).toBe('<title>bucharest</title>');
    });

    it.each([
        [
            'two sites on one path',
            [
                { outDir: 'dist/site/cluj', pagesPath: 'cluj/' },
                { outDir: 'dist/site/bacau', pagesPath: 'cluj/' },
            ],
            'two sites ask',
        ],
        [
            'a city folder the root site uses',
            [
                { outDir: 'dist/site/bucharest', pagesPath: '' },
                { outDir: 'dist/site/cluj', pagesPath: 'engine/' },
            ],
            'is a file or folder of the root site',
        ],
    ] as const)('badPath_%s_refusesTheTreeAndWritesNothing', (_name, sites, words) => {
        const files = builtSites();

        expect(() => assemblePages(sites, 'dist/pages', files)).toThrow(words);
        expect(files.isFile('dist/pages/index.html')).toBe(false);
    });

    it('badPath_aPagesFolderOutsideDistIsRefused', () => {
        expect(() => assemblePages([], 'sites', builtSites())).toThrow(SiteBuildError);
        expect(() => assemblePages([], 'dist/../x', builtSites())).toThrow('below dist/');
    });

    it('happyPath_withoutARootSiteEveryCityIsInItsFolder', () => {
        const files = builtSites();

        expect(assemblePages([{ outDir: 'dist/site/cluj', pagesPath: 'cluj/' }], 'dist/pages', files).paths).toEqual(['/cluj/']);
        expect(files.isFile('dist/pages/cluj/index.html')).toBe(true);
    });
});
