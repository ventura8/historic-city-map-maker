import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';
import { isOutputDir } from './output-dir.js';

/**
 * The GitHub Pages tree of every city (M5, `docs/research/M5-interfaces.md` §1.10; `npm run build:site -- --pages
 * dist/pages`): each built site copied to its `pagesPath`, Bucharest at the root (`""`, so the 2015–2022 links and the
 * M1–M4 links keep working) and every other city in a folder of its own (`<city>/`). One origin serves them all, so each
 * city's viewer token stays restricted to it. The tree is refused, and nothing written, when two sites ask for one path,
 * or when a city's folder is a file or a folder of the root site (its `engine/`, `data/`, `config.js`): the reserved city
 * ids make that impossible for a valid id, and this check keeps a hand-edited `site.json` from shadowing one.
 */

/** One built site and where the Pages tree serves it. */
export interface PagesSite {
    /** The site's build (`dist/site/<folder>`). */
    readonly outDir: string;
    /** `""` (the root) or `<folder>/`. */
    readonly pagesPath: string;
}

export interface PagesReport {
    readonly pagesDir: string;
    /** Each site's path in the tree, in build order (`/` for the root). */
    readonly paths: readonly string[];
    readonly files: number;
}

/** The first segment of every file of the root site (`index.html`, `engine`, `data`, ...). */
function rootNames(sites: readonly PagesSite[], files: SiteFileSystem): ReadonlySet<string> {
    const root = sites.find((site) => site.pagesPath === '');
    return new Set(root === undefined ? [] : files.listFiles(root.outDir).map((path) => path.split('/')[0] ?? path));
}

/** Two sites on one path, or a city folder that the root site already uses, refuse the whole tree. */
function checkPaths(sites: readonly PagesSite[], files: SiteFileSystem): void {
    const seen = new Set<string>();
    const taken = rootNames(sites, files);
    for (const site of sites) {
        if (seen.has(site.pagesPath)) {
            throw new SiteBuildError(`two sites ask for the Pages path "/${site.pagesPath}" (site.json → pagesPath)`);
        }
        seen.add(site.pagesPath);
        if (taken.has(site.pagesPath.replace(/\/$/, ''))) {
            throw new SiteBuildError(`the Pages path "/${site.pagesPath}" of ${site.outDir} is a file or folder of the root site`);
        }
    }
}

/** Assembles `pagesDir` (below `dist/`, replaced) from `sites`; throws SiteBuildError, writing nothing, on a clash. */
export function assemblePages(sites: readonly PagesSite[], pagesDir: string, files: SiteFileSystem): PagesReport {
    if (!isOutputDir(pagesDir)) {
        throw new SiteBuildError(`the Pages folder must be below dist/, got "${pagesDir}"`);
    }
    checkPaths(sites, files);
    files.remove(pagesDir);
    let count = 0;
    for (const site of sites) {
        for (const path of files.listFiles(site.outDir)) {
            files.copy(`${site.outDir}/${path}`, `${pagesDir}/${site.pagesPath}${path}`);
            count += 1;
        }
    }
    return { pagesDir, paths: sites.map((site) => `/${site.pagesPath}`), files: count };
}
