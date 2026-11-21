import { parseArgs } from 'node:util';

import { isUsableCityId, type Logger } from '@hcm/shared';

import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';

/**
 * `npm run site:add -- --city <id> --name-ro <name> --theme <#rrggbb>` (M5, `docs/research/M5-interfaces.md` §1.10): a
 * new city's public site, `sites/<id>/`, written from the M1 files: its `site.json` (the Romanian name as the title, the
 * seed colour, `publicManifest`, the Pages path `<id>/`), its `config.js` (the city) and the page frame `site.css`
 * (Bucharest's). It has no seed manifest: the page reads what the admin publishes to the public bucket, so the build
 * makes it only when it names the bucket (`HCM_PUBLIC_BUCKET`). A repository step, never the admin's (the admin holds no
 * GitHub credential): the change is committed and pushed like any other.
 *
 * Exit status: 0 written, 1 an input is invalid or the site exists, 2 usage.
 */

const SITES_DIR = 'sites';
/** The page frame every city site shares (M1). */
const FRAME_CSS = 'sites/bucharest/site.css';
const COLOUR = /^#[0-9A-Fa-f]{6}$/;

export const ADD_EXIT_OK = 0;
export const ADD_EXIT_INVALID = 1;
export const ADD_EXIT_USAGE = 2;

export interface NewSite {
    readonly cityId: string;
    readonly nameRo: string;
    readonly theme: string;
}

export interface AddSiteContext {
    readonly files: SiteFileSystem;
    readonly log: Logger;
}

function readNewSite(argv: readonly string[]): NewSite {
    const { values } = parseArgs({
        args: [...argv],
        options: { city: { type: 'string' }, 'name-ro': { type: 'string' }, theme: { type: 'string' } },
        strict: true,
        allowPositionals: false,
    });
    const { city, 'name-ro': nameRo, theme } = values;
    if (city === undefined || nameRo === undefined || theme === undefined) {
        throw new TypeError('--city, --name-ro and --theme are required');
    }
    return { cityId: city, nameRo, theme };
}

function nameFits(name: string): boolean {
    return name.trim() !== '' && name.length <= 100;
}

/** What the inputs must be, each check saying why it failed. */
const CHECKS: readonly ((site: NewSite) => string | null)[] = [
    (site) =>
        isUsableCityId(site.cityId)
            ? null
            : `"${site.cityId}" is not a usable city id (lower-case letters, digits, dashes; no reserved word)`,
    (site) => (nameFits(site.nameRo) ? null : 'the Romanian name has 1 to 100 characters'),
    (site) => (COLOUR.test(site.theme) ? null : `the theme colour is #rrggbb, got "${site.theme}"`),
];

/** Why the new site cannot be written, or nothing. */
function problemOf(site: NewSite, files: SiteFileSystem): string | null {
    const problem = CHECKS.map((check) => check(site)).find((found) => found !== null);
    if (problem !== undefined) {
        return problem;
    }
    return files.isFile(`${SITES_DIR}/${site.cityId}/site.json`) ? `${SITES_DIR}/${site.cityId}/ exists already` : null;
}

/** The new site's `site.json`, as the site build reads it (`site-spec.ts`). */
export function siteJson(site: NewSite): string {
    const name = site.nameRo.trim();
    const spec = {
        lang: 'ro',
        title: name,
        description: `${name} de altădată pe harta de azi: fotografii vechi așezate acolo unde au fost făcute și straturi istorice ale orașului.`,
        themeColor: site.theme,
        noscript: {
            ro: `Harta are nevoie de JavaScript. Activează JavaScript în browser ca să vezi fotografiile și straturile istorice ale orașului ${name}.`,
            en: `The map needs JavaScript. Turn JavaScript on in your browser to see the historical photos and layers of ${name}.`,
        },
        publicManifest: true,
        pagesPath: `${site.cityId}/`,
    };
    return `${JSON.stringify(spec, null, 4)}\n`;
}

/** The new site's `config.js`: the city; the build serves a copy that names the public bucket's manifest. */
export function configJs(site: NewSite): string {
    return [
        `// ${site.nameRo.trim()}: the embed configuration the engine boots from (docs/ENGINE_API.md → config.js).`,
        '// The manifest is the one the admin publishes to the public bucket: the site build (with HCM_PUBLIC_BUCKET) serves a',
        "// generated copy of this file whose manifestUrl is the bucket's cities/<city>/manifest.json. This site has no seed",
        '// snapshot, so the address below is only the shape the engine expects (site.json → publicManifest).',
        'window.HistoricCityMapConfig = {',
        `    cityId: '${site.cityId}',`,
        "    manifestUrl: './data/manifest.json',",
        '};',
        '',
    ].join('\n');
}

/** Writes `sites/<id>/`; throws SiteBuildError, writing nothing, when the inputs are invalid or the site exists. */
export function addSite(site: NewSite, files: SiteFileSystem): string {
    const problem = problemOf(site, files);
    if (problem !== null) {
        throw new SiteBuildError(problem);
    }
    const dir = `${SITES_DIR}/${site.cityId}`;
    files.write(`${dir}/site.json`, siteJson(site));
    files.write(`${dir}/config.js`, configJs(site));
    files.copy(FRAME_CSS, `${dir}/site.css`);
    return dir;
}

/** Runs `site:add`: an input problem is logged with exit status 1; anything else is a bug and propagates. */
export function runAddSite(argv: readonly string[], context: AddSiteContext): number {
    let site: NewSite;
    try {
        site = readNewSite(argv);
    } catch (error: unknown) {
        context.log.error('usage: add-site.ts --city <id> --name-ro <name> --theme <#rrggbb>', { reason: String(error) });
        return ADD_EXIT_USAGE;
    }
    try {
        const dir = addSite(site, context.files);
        context.log.info('site added: build it with the public bucket named (HCM_PUBLIC_BUCKET), then commit it', { dir });
        return ADD_EXIT_OK;
    } catch (error: unknown) {
        if (error instanceof SiteBuildError) {
            context.log.error(error.message);
            return ADD_EXIT_INVALID;
        }
        throw error;
    }
}
