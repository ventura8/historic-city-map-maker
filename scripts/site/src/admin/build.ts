import type { AppFile } from '../app.js';
import { ADMIN_APP_FILES } from './app.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { DEFAULT_SEED_DIR, LEGACY_FOLDER, planLegacyBundle, type AdminFile } from './legacy.js';
import { subresourceIntegrity } from '../sri.js';
import { ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE, renderAdminPage } from './page.js';
import { DEFAULT_PROJECT_FILE, planProjectFile } from './project.js';
import { planRuntimeFile, type BuildEnvironment } from './runtime.js';
import { planStarterList } from './starter.js';

/**
 * Completes the admin's Hosting folder after its Vite build (docs/research/M2b-interfaces.md §4, admin-e2e):
 *
 * ```text
 * <outDir>/admin.mjs, admin.css, …       the Vite build (production, or the `e2e` mode for the admin tier), required;
 *                                        the entry's lazy chunks sit next to it
 * <outDir>/index.html                    generated (page.ts), naming the digest of the pinned mapbox-gl.js
 * <outDir>/runtime.json                  the release and, for a start-up deploy, `startUp` (runtime.ts)
 * <outDir>/project.json                  the committed infra/project.json, checked (project.ts, CR-M2b-26)
 * <outDir>/firebase-messaging-sw.js      M4's web push service worker (service-worker.ts), also the installable app's
 *                                        worker, which keeps nothing (app.ts)
 * <outDir>/app.webmanifest, app.js, …    the installable app's manifest, icons and the page script that registers the
 *                                        worker and keeps the install prompt (app.ts)
 * <outDir>/starter.json                  the release's list of the starter files: their version and SHA-256 (starter.ts), which
 *                                        an installed starter checks a newer file against before it replaces itself
 * <outDir>/fonts/…                       the kit's self-hosted fonts and their licences (packages/ui/fonts), which the
 *                                        admin loads from `fonts/` next to the page, as the engine's site pages do
 * <outDir>/legacy/bucharest/…            the legacy import bundle (legacy.ts)
 * ```
 *
 * The starter files of "Use this computer" are no longer published here (finding 73 of 2026-11-03): the server's
 * `worker.starter` serves them filled, as a download; a `worker/` folder an earlier build left is removed.
 *
 * Every input is read and validated before anything is written, and only `index.html`, `runtime.json`, `project.json`,
 * the service worker, `starter.json`, `fonts/` and `legacy/` are replaced: the Vite output stays. The production folder is `packages/admin/dist` (`firebase.json` → `hosting.public`); a test
 * writes below `dist/`.
 */

export const DEFAULT_ADMIN_DIR = 'packages/admin/dist';

/** The kit's self-hosted fonts (`packages/ui/fonts`, built by its `fonts:build`). */
const DEFAULT_FONTS_DIR = 'packages/ui/fonts';

/** Where the page finds them. */
export const FONTS_FOLDER = 'fonts';

/** Where finding 72's build published the starter templates (finding 73: removed; the server serves the files). */
export const STARTER_FOLDER = 'worker';

/** The pinned Mapbox GL JS release whose digest the page names (a pinned devDependency of `@hcm/e2e`). */
const DEFAULT_MAPBOX_GL_DIR = 'node_modules/mapbox-gl/dist';

export interface AdminBuildOptions {
    /** The admin's Hosting folder: `packages/admin/dist`, or a folder below `dist/`. */
    readonly outDir: string;
    /** The Bucharest seed of the legacy import; default `seed/bucharest`. */
    readonly seedDir?: string;
    /** The kit's fonts; default `packages/ui/fonts`. */
    readonly fontsDir?: string;
    /** The project the admin provisions; default `infra/project.json`. */
    readonly projectFile?: string;
    /** The pinned Mapbox GL JS release; default `node_modules/mapbox-gl/dist`. */
    readonly mapboxGlDir?: string;
    /** The build's environment: the commit (`HCM_COMMIT`, `GITHUB_SHA`) and a start-up deploy (`HCM_ADMIN_START_UP`). */
    readonly env?: BuildEnvironment;
}

export interface AdminBuildReport {
    readonly outDir: string;
    readonly projectId: string;
    readonly release: string;
    readonly photos: number;
    readonly originals: number;
    readonly warnings: number;
    readonly fonts: number;
    readonly files: number;
}

/** A folder name: letters, digits, `_`, `.`, `-`, but never `.` or `..` themselves. */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

function isAdminOutputDir(path: string): boolean {
    const [first, ...rest] = path.split('/');
    return path === DEFAULT_ADMIN_DIR || (first === 'dist' && rest.length > 0 && rest.every((segment) => SEGMENT.test(segment)));
}

function requireBundle(files: SiteFileSystem, outDir: string): void {
    for (const name of [ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE]) {
        if (!files.isFile(`${outDir}/${name}`)) {
            throw new SiteBuildError(`${outDir}/${name} is missing: build the admin first (npm run build --workspace @hcm/admin)`);
        }
    }
}

/** The fonts and their licences, every `.woff2` and `LICENSES.md` of `fontsDir`. */
function fontFiles(files: SiteFileSystem, fontsDir: string): AdminFile[] {
    const names = files.isFile(`${fontsDir}/LICENSES.md`) ? files.listFiles(fontsDir) : [];
    const fonts = names.filter((name) => name.endsWith('.woff2'));
    if (fonts.length === 0) {
        throw new SiteBuildError(
            `${fontsDir} holds no font and licence: the admin loads the kit's fonts (npm run fonts:build --workspace @hcm/ui)`,
        );
    }
    return [...fonts, 'LICENSES.md'].map((name) => ({ from: `${fontsDir}/${name}`, to: `${FONTS_FOLDER}/${name}` }));
}

function write(files: SiteFileSystem, outDir: string, file: AdminFile | AppFile): void {
    const target = `${outDir}/${file.to}`;
    if ('content' in file) {
        files.write(target, file.content);
    } else {
        files.copy(file.from, target);
    }
}

/** The input folders of `options`, the defaults where it names none. */
function foldersOf(options: AdminBuildOptions): Required<Pick<AdminBuildOptions, 'fontsDir' | 'seedDir' | 'mapboxGlDir'>> {
    return {
        fontsDir: options.fontsDir ?? DEFAULT_FONTS_DIR,
        seedDir: options.seedDir ?? DEFAULT_SEED_DIR,
        mapboxGlDir: options.mapboxGlDir ?? DEFAULT_MAPBOX_GL_DIR,
    };
}

/** The inputs of `options`, the defaults where it names none. */
function inputsOf(options: AdminBuildOptions): Required<Omit<AdminBuildOptions, 'outDir'>> {
    return { ...foldersOf(options), projectFile: options.projectFile ?? DEFAULT_PROJECT_FILE, env: options.env ?? {} };
}

/** The digest of the pinned `mapbox-gl.js` the first admin map loads from api.mapbox.com (§34h). */
function mapboxGlIntegrity(files: SiteFileSystem, mapboxGlDir: string): string {
    const script = `${mapboxGlDir}/mapbox-gl.js`;
    if (!files.isFile(script)) {
        throw new SiteBuildError(`${script} is missing: install the dependencies (mapbox-gl is a pinned devDependency of @hcm/e2e)`);
    }
    return subresourceIntegrity(files.readBytes(script));
}

/** Writes the page and the legacy bundle into `options.outDir`; throws SiteBuildError (writing nothing) on a bad input. */
export function buildAdminSite(options: AdminBuildOptions, files: SiteFileSystem): AdminBuildReport {
    const { outDir } = options;
    if (!isAdminOutputDir(outDir)) {
        throw new SiteBuildError(`the admin's output folder is ${DEFAULT_ADMIN_DIR} or a folder below dist/, got "${outDir}"`);
    }
    requireBundle(files, outDir);
    const inputs = inputsOf(options);
    const fonts = fontFiles(files, inputs.fontsDir);
    const legacy = planLegacyBundle(files, inputs.seedDir);
    const project = planProjectFile(files, inputs.projectFile);
    const runtime = planRuntimeFile(files, inputs.env);
    const page = renderAdminPage(undefined, { mapboxGlIntegrity: mapboxGlIntegrity(files, inputs.mapboxGlDir) });
    const starter = planStarterList(files);
    const planned: (AdminFile | AppFile)[] = [
        { to: 'index.html', content: page },
        runtime.file,
        project.file,
        ...ADMIN_APP_FILES,
        starter,
        ...fonts,
        ...legacy.files,
    ];
    files.remove(`${outDir}/${FONTS_FOLDER}`);
    files.remove(`${outDir}/${STARTER_FOLDER}`);
    files.remove(`${outDir}/${LEGACY_FOLDER}`);
    for (const file of planned) {
        write(files, outDir, file);
    }
    const counts = { photos: legacy.photos, originals: legacy.originals, warnings: legacy.warnings, fonts: fonts.length - 1 };
    return { outDir, projectId: project.projectId, release: runtime.release, ...counts, files: planned.length };
}
