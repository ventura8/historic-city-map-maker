import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';
import { engineExtrasPlugin, hostKeyOf } from '../../scripts/site/src/engine-extras.js';
import { i18nCataloguesPlugin } from '../../scripts/site/src/i18n-catalogues.js';
import { thirdPartyNoticesPlugin } from '../../scripts/site/src/notices.js';
import { sidePartPlugin } from '../../scripts/site/src/side-part.js';
import { zodStandInsPlugin } from '../../scripts/site/src/zod-stand-ins.js';
import { VIEWER_CATALOGUES } from '../shared/src/i18n/viewer-catalogues.js';
import { FONT_FILES } from '../ui/src/fonts/font-files.js';

/**
 * Library build of the public viewer engine, two Vite runs into one folder after the side-loaded part's own run
 * (`npm run build`: `vite build -c vite.part.config.ts`, `vite build`, then `vite build --mode iife`, which keeps the
 * second run's files):
 * - dist/engine.mjs is the ES module build, with its lazy chunks (`compare-<hash>.js`, `gamepad-<hash>.js`,
 *   `firebase-sdk-<hash>.js`, `field-sdk-<hash>.js`);
 * - dist/engine.iife.js exposes window.HistoricCityMap for <script> embedding (city starter kit, jsDelivr), with its
 *   extras beside it (`extra-<name>-<hash>.js`, below);
 * - dist/engine.css holds every stylesheet the engine imports.
 * Mapbox GL is never bundled: `mapbox-gl` resolves to the global `mapboxgl` that the page loads
 * from https://api.mapbox.com/mapbox-gl-js/v3.34.1/ (Mapbox terms, CDN caching, bundle budget).
 * - dist/THIRD_PARTY_NOTICES.txt lists every bundled npm package and the fonts' packages (the `fonts:copy` script copies
 *   the fonts next to it) with their licences (scripts/site/src/notices.ts; checked by the `notices` gate).
 * - The CSS of the Lit `css` templates is minified by `cssLiteralsPlugin` (scripts/site/src/css-literals.ts), as the admin's
 *   has been since DECISIONS-for-review.md §36: the bundler's minifier leaves a template literal's comments and indentation,
 *   about 6 KB gzip of the engine; with it the IIFE carries the consented field chunk (web-vitals, §76) within its budget.
 * - zod's JSON Schema conversion, which the engine never calls, resolves to the admin's stand-in that refuses
 *   (scripts/site/src/zod-stand-ins.ts; DECISIONS-for-review.md §100): about 6 KB gzip of both builds. zod's English
 *   messages, which the engine never shows (an issue reaches the visitor as its `validation.*` code), resolve to the admin's
 *   empty stand-in (§120a): about 1 KB gzip of both builds.
 * - The viewer's message catalogues are not in the bundle (`i18nCataloguesPlugin`, scripts/site/src/i18n-catalogues.ts,
 *   DECISIONS-for-review.md §218, which replaced §127a's packing): each of the sixteen languages is
 *   dist/i18n/<locale>.json, fetched when the viewer first shows it (`ENGINE_VERSION` is the package's version, which the
 *   release keeps equal: a file of another version is refused).
 * - dist/engine.extras.js is the side-loaded full-size view (docs/ENGINE_API.md → *Side-loaded parts*), built first by
 *   `vite.part.config.ts` into .tsbuild/part/; `sidePartPlugin` (scripts/site/src/side-part.ts) writes its Subresource
 *   Integrity into src/extras-part.ts, which both builds load it with, and serves it here (the owner's "Load extras on
 *   demand", 2026-11-09: about 1.5 KB gzip out of the IIFE).
 * - The IIFE's extras (`engineExtrasPlugin`, scripts/site/src/engine-extras.ts; DECISIONS-for-review.md §186): an IIFE
 *   cannot split, so it inlined the ES build's lazy chunks (about 24 KB gzip of it). Since §186 they are classic scripts
 *   beside it, `extra-<name>-<hash>.js`, that it loads with their integrity the first time they are wanted
 *   (packages/engine/src/extras/), taking Lit and `@hcm/shared` from the engine's host (`src/extras/host-*.ts`), never
 *   their own copy. A separate run, because one bundle cannot replace `src/extras/imports.ts` for one format only.
 */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const zodStandIns = (): ReturnType<typeof zodStandInsPlugin> =>
    zodStandInsPlugin({
        jsonSchema: here('../admin/src/vendor/zod-json-schema-unsupported.ts'),
        messages: here('../admin/src/vendor/zod-locale-none.ts'),
    });

/** ENGINE_VERSION of src/index.ts: the extras register on this release's entry of the host (src/extras/host.ts). */
function engineVersion(): string {
    const version = /ENGINE_VERSION = '([^']+)'/.exec(readFileSync(here('src/index.ts'), 'utf8'))?.[1];
    if (version === undefined) {
        throw new Error('packages/engine/src/index.ts declares no ENGINE_VERSION');
    }
    return version;
}

/** The engine's version: the release keeps `ENGINE_VERSION` equal to it, and a catalogue file names it. */
const ENGINE_PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { readonly version: string })
    .version;

const HOST_KEY = hostKeyOf(engineVersion());
const HOST = `__hcmEngineHost.${HOST_KEY}`;

const extras = engineExtrasPlugin({
    root: here('.'),
    importsModule: here('src/extras/imports.ts'),
    runtimeModule: here('src/extras/runtime.ts'),
    hostKey: HOST_KEY,
    registry: `${HOST}.extras`,
    ready: `${HOST}.ready`,
    // The keys of src/extras/imports.ts.
    extras: [
        { name: 'compare', global: 'compare', entry: here('src/compare/compare.ts') },
        { name: 'gamepad', global: 'gamepad', entry: here('../ui/src/viewer/gamepad/gamepad.ts') },
        { name: 'firebase-sdk', global: 'firebaseSdk', entry: here('src/telemetry/firebase-sdk.ts') },
        { name: 'field-sdk', global: 'fieldSdk', entry: here('src/telemetry/field-sdk.ts') },
    ],
    // src/extras/host.ts installs these globals.
    host: [
        { specifier: 'lit', global: `${HOST}.lit`, module: here('src/extras/host-lit.ts') },
        { specifier: '@hcm/shared', global: `${HOST}.shared`, module: here('src/extras/host-shared.ts') },
        { specifier: '@hcm/shared/credits', global: `${HOST}.shared`, module: here('src/extras/host-shared.ts') },
    ],
    forbidden: /[\\/]node_modules[\\/](?:lit|lit-html|lit-element|@lit|zod)[\\/]|[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/]/,
    plugins: () => [zodStandIns(), cssLiteralsPlugin()],
});

const IIFE_MODE = 'iife';

export default defineConfig(({ mode }) => {
    const iife = mode === IIFE_MODE;
    return {
        plugins: [
            ...(iife ? [extras] : []),
            zodStandIns(),
            cssLiteralsPlugin(),
            i18nCataloguesPlugin(ENGINE_PACKAGE_VERSION, VIEWER_CATALOGUES),
            // Both runs load the side-loaded part with its integrity; only the ES run emits it.
            sidePartPlugin({
                built: here('.tsbuild/part/engine.extras.js'),
                constantModule: here('src/extras-part.ts'),
                fileName: 'engine.extras.js',
            }),
            thirdPartyNoticesPlugin({
                product: 'the Historic City Map Maker engine (engine.mjs, engine.iife.js, their chunks and fonts)',
                assets: FONT_FILES.map((font) => ({ package: font.source.package, file: `fonts/${font.file}` })),
                ...(iife ? { moreModules: () => extras.modules() } : {}),
            }),
        ],
        build: {
            outDir: 'dist',
            // The IIFE run adds its files to the ES run's.
            emptyOutDir: !iife,
            sourcemap: true,
            lib: {
                entry: 'src/index.ts',
                name: 'HistoricCityMap',
                formats: iife ? ['iife'] : ['es'],
                fileName: (format) => (format === 'es' ? 'engine.mjs' : `engine.${format}.js`),
                cssFileName: 'engine',
            },
            rolldownOptions: {
                external: ['mapbox-gl'],
                // engine.mjs stays the whole entry: what the lazy chunks (swipe compare's `compare-<hash>.js`, the consented
                // `firebase-sdk-<hash>.js`) share with it, they import from engine.mjs, which may export those bindings too.
                // Vite's library default ('strict') moved everything shared into a third chunk that engine.mjs imported at
                // once (`map-sync-<hash>.js`, 44.6 KB: M4 compare, docs/research/M4-interfaces.md §3.2). The IIFE has one chunk
                // and its extras.
                preserveEntrySignatures: 'allow-extension',
                output: {
                    globals: { 'mapbox-gl': 'mapboxgl' },
                    // engine.mjs is a page script that nothing bundles again: minify it like the IIFE.
                    minify: true,
                },
            },
        },
    };
});
