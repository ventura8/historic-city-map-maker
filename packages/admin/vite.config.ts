import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';
import { thirdPartyNoticesPlugin } from '../../scripts/site/src/notices.js';
import { uiCataloguesPlugin } from '../../scripts/site/src/ui-catalogues.js';
import { zodStandInsPlugin } from '../../scripts/site/src/zod-stand-ins.js';
import { BUNDLED_LOCALES, UI_LOCALES } from '../shared/src/i18n/locales.js';
import { FONT_FILES } from '../ui/src/fonts/font-files.js';

/**
 * Library build of the admin app: the ES module entry `dist/admin.mjs`, its lazy chunks next to it and `dist/admin.css`.
 * Hosting serves it under `/admin/` (the base; M6) and the public map at the root (`npm run build:hosting` copies this
 * folder to `dist/hosting/admin/`). The page (scripts/site's admin target) holds `<hcm-admin-shell>` and loads `admin.mjs` as a module
 * script, which starts itself (`src/index.ts`). Each editor area's page and store (`src/pages/<area>.ts`), Terra Draw
 * (`@hcm/ui/map/draw`'s loader), the colour library and the analytics SDK are chunks fetched when first needed
 * (DECISIONS-for-review.md §34b); `scripts/ci/check_bundle_budget.py` measures the entry and every chunk. There is no IIFE:
 * an IIFE inlines every dynamic import, and the admin is not distributed for embedding (the engine's IIFE is, on jsDelivr).
 * Mapbox GL stays external exactly as in the engine build.
 *
 * `dist/THIRD_PARTY_NOTICES.txt` lists every npm package bundled into the entry and its chunks, and the fonts' packages
 * (scripts/site's admin target copies the fonts next to it), with their licences (`thirdPartyNoticesPlugin`,
 * scripts/site/src/notices.ts; checked by the `notices` gate).
 *
 * The build is minified (DECISIONS-for-review.md §36): its JavaScript like the engine's (`minify: true`, §17a), and the
 * CSS of the Lit `css` templates by `cssLiteralsPlugin` (scripts/site/src/css-literals.ts), since a template literal's
 * text is beyond the bundler's minifier.
 *
 * Modes (`vite build --mode <mode>`, read in the code as `import.meta.env.MODE`):
 * - `production` (`npm run build`): Firebase's Google popup, App Check when `runtime.json` names a site key;
 * - `e2e` (`npm run build:e2e`): Auth, Firestore, Storage and Functions on the emulators of `firebase.json` and the OAuth
 *   stand-in of the mock APIs instead of Google's popup (docs/research/M2b-interfaces.md §2.6). The mode is a constant
 *   for the bundler, so the production build carries neither the emulator settings nor the stand-in's page logic.
 */
/** The admin map's modules: its box and elements, and the content it draws for every area that shows it. */
const ADMIN_MAP_MODULES =
    /packages[\\/](?:ui[\\/]src[\\/]admin[\\/]map[\\/]|admin[\\/]src[\\/](?:photos[\\/]map|pois[\\/](?:map-session|model)|layers[\\/](?:map-session|preview))\.ts)/;

/**
 * The editors' own words for a field and its problem (`packages/ui/src/admin/editing/field-names.ts`, `issue-text.ts`), which
 * every editor area and History share: their own chunk, kept out of `editor-shared` (DECISIONS-for-review.md §77e).
 */
const EDITOR_TEXT_MODULES = /packages[\\/]ui[\\/]src[\\/]admin[\\/]editing[\\/](?:field-names|issue-text)\.ts$/;

/**
 * The Markdown subset's renderer (`packages/ui/src/viewer/markdown.ts`), which the settings' texts and the place editor's preview
 * share: in `editor-texts`, which has room, so `editor-shared` stays within its 13 KB with M17's stories area beside it
 * (`docs/research/M17-stories.md` §6).
 */
const MARKDOWN_MODULES = /packages[\\/]ui[\\/]src[\\/]viewer[\\/]markdown\.ts$/;

/**
 * The value fields of a proposal, which the Contribute page and the Review page's adjust share (M13 §4): their own chunk, kept out
 * of `editor-shared`, which none of the editors would then have to load them with.
 */
const PROPOSAL_FIELD_MODULES = /packages[\\/]ui[\\/]src[\\/]admin[\\/]contribute[\\/]proposal-fields/;

/**
 * The starter place categories (`packages/shared/src/overlays/starter-categories.ts`, `packages/admin/src/pois/starter.ts`,
 * `packages/ui/src/admin/settings/starter-actions.ts`), which the place editor and Settings → Place categories share since
 * finding 41 of 2026-11-01: their own chunk, kept out of `editor-shared` and the settings chunk (DECISIONS-for-review.md §78d).
 */
const STARTER_MODULES =
    /packages[\\/](?:shared[\\/]src[\\/]overlays[\\/]starter-categories|admin[\\/]src[\\/]pois[\\/]starter|ui[\\/]src[\\/]admin[\\/]settings[\\/]starter-actions)\.ts$/;

/**
 * Three small `@hcm/shared` modules only the Imagery area reads (a plan's schema, a label's words, a year in a name): in the
 * `editor-texts` chunk, which has room, so the `imagery` chunk stays within its 18 KB with Locate again (DECISIONS-for-review.md §93).
 */
const IMAGERY_SHARED_MODULES = /packages[\\/]shared[\\/]src[\\/](?:schemas[\\/]imagery-plan|imagery[\\/]labels|migration[\\/]year)\.ts$/;

/**
 * M18 (DECISIONS-for-review.md §101f): the words of a scene's refusal, which the Imagery area and the order card share, in
 * the `editor-texts` chunk too, so `editor-shared` stays within its 13 KB.
 */
const IMAGERY_UI_SHARED_MODULES = /packages[\\/]ui[\\/]src[\\/]admin[\\/]imagery[\\/]scene-refusal\.ts$/;

/**
 * The tolerant reads of an older release's records (`packages/shared/src/schemas/legacy-reads.ts`), which Home, the Imagery
 * lists and a version's page share: their own chunk, kept out of `editor-shared`, which they took to 13.1 KB of its 13
 * (DECISIONS-for-review.md §155).
 */
const LEGACY_READ_MODULES = /packages[\\/]shared[\\/]src[\\/]schemas[\\/]legacy-reads\.ts$/;

/**
 * The wizard funnels (§200): each wizard page's snapshot (`*-funnel.ts`, `*-funnels.ts` of `packages/ui/src/admin/`) and the
 * shared helper, in a chunk of their own so the archive, imagery, worker and editor-shared chunks keep their budgets.
 */
const FUNNEL_MODULES =
    /packages[\\/](?:shared[\\/]src[\\/]telemetry[\\/]wizard-funnel|ui[\\/]src[\\/]admin[\\/][\w-]+[\\/][\w-]+-funnels?)\.ts$/;

/** M4: the editors' assists, their state and intents (`packages/admin/src/assist/`) and their slots (`packages/ui/src/admin/assist/`). */
const ASSIST_MODULES = /packages[\\/](?:admin[\\/]src|ui[\\/]src[\\/]admin)[\\/]assist[\\/]/;

/**
 * Shared georeferencer badge painters and the map's canvas overlay (owner, 2026-11-11; DECISIONS-for-review.md §146): out of
 * the `georef` chunk so it stays within 19 KB after identical scan/map markers, residual tones and pinch-zoom. The linked views
 * (2026-11-12, §156) moved four more helpers here, none of which imports a module of the `georef` chunk (only `@hcm/shared` and
 * `marker-badge`): the pairs' edits (`pairs.ts`), Undo's memory (`history.ts`), the residual tones (`tones.ts`) and full screen's
 * inert cover (`full-screen.ts`). This group loads with the georeferencer's page, so the move relocates code, it defers none: the
 * page's eager download is the same; only the mapping (`linked-views.ts`, in `georef-extras`) loads lazily.
 */
const GEOREF_BADGE_MODULES =
    /packages[\\/](?:ui[\\/]src[\\/]admin[\\/]georef[\\/](?:marker-badge|full-screen)|admin[\\/]src[\\/]georef[\\/](?:marker-overlay|pairs|history|tones))\.ts$/;

/**
 * The georeferencer's panes and what the beta.1 requests added beside them (2026-11-12; DECISIONS-for-review.md §172, §173): the two
 * panes' template with the list of what the map shows and Delete pair N (`georef-panes.ts`), the scan pane's gestures and the holder
 * of its sharper scan's tiles (`scan-input.ts`), removing a pair with Undo (`removing.ts`), the scan pane's view arithmetic and drawing (`scan-view.ts`, `scan-draw.ts`, out of `georef-badges`, which was at 3.1 KB of 3 with the turned drawing) and the panes' turning together (`rotation.ts`). None imports a module of the `georef` chunk at run time. Like `georef-badges`, this group loads with the
 * georeferencer's page: it relocates code so that `georef` stays within its 19 KB, it defers none.
 */
const GEOREF_PANE_MODULES =
    /packages[\\/](?:ui[\\/]src[\\/]admin[\\/]georef[\\/](?:georef-panes|scan-input|scan-view|scan-draw)|admin[\\/]src[\\/]georef[\\/](?:removing|rotation))\.ts$/;

/**
 * `re2js` resolves to the admin's stand-in (`src/vendor/re2js-unsupported.ts`): the Firestore SDK needs it only for the
 * regular expressions of Firestore Pipelines, which the admin never evaluates (DECISIONS-for-review.md §65k).
 */
const RE2JS_STAND_IN = fileURLToPath(new URL('src/vendor/re2js-unsupported.ts', import.meta.url));

/**
 * zod's JSON Schema conversion and its English messages, which the admin never uses, resolve to stand-ins
 * (`scripts/site/src/zod-stand-ins.ts`; DECISIONS-for-review.md §86, §93).
 */
const ZOD_STAND_INS = {
    jsonSchema: fileURLToPath(new URL('src/vendor/zod-json-schema-unsupported.ts', import.meta.url)),
    messages: fileURLToPath(new URL('src/vendor/zod-locale-none.ts', import.meta.url)),
};

/** The catalogues' folder, and the languages every page fetches rather than bundles (docs/I18N.md → Loading). */
const SHARED_I18N = fileURLToPath(new URL('../shared/src/i18n', import.meta.url));
const FETCHED_LOCALES = UI_LOCALES.filter((locale) => !BUNDLED_LOCALES.includes(locale));

export default defineConfig({
    // M6 (docs/research/M6-interfaces.md §2.3): Hosting serves the admin under /admin/ (the public map is at the root);
    // `import.meta.env.BASE_URL` names it for the files the admin fetches by absolute path (src/app/config.ts).
    base: '/admin/',
    resolve: { alias: [{ find: /^re2js$/, replacement: RE2JS_STAND_IN }] },
    plugins: [
        zodStandInsPlugin(ZOD_STAND_INS),
        cssLiteralsPlugin(),
        // The languages beyond Romanian and English: `dist/i18n/<locale>.json`, fetched when chosen (docs/I18N.md → Loading).
        uiCataloguesPlugin({ root: SHARED_I18N, locales: FETCHED_LOCALES }),
        thirdPartyNoticesPlugin({
            product: 'the Historic City Map Maker admin (admin.mjs, its chunks and fonts)',
            assets: FONT_FILES.map((font) => ({ package: font.source.package, file: `fonts/${font.file}` })),
        }),
    ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // The maps are written for the notices gate (scripts/ci/check_notices.py reads the module graph from them) and the
        // build's own debugging, but Hosting never serves them (`firebase.json` ignores `**/*.map`): `hidden` leaves out
        // each chunk's `//# sourceMappingURL` line, which only made a browser ask for a missing file (1.1 KB gzip over 31
        // chunks; DECISIONS-for-review.md §86).
        sourcemap: 'hidden',
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: () => 'admin.mjs',
            cssFileName: 'admin',
        },
        rolldownOptions: {
            external: ['mapbox-gl'],
            output: {
                // admin.mjs and its chunks are page scripts that nothing bundles again: minified (the engine's §17a).
                minify: true,
                // What a bundler reads, in chunks no bundler reads again: `/*@__PURE__*/` a hundred and twenty-five times (0.1 KB gzip; M9).
                comments: { annotation: false },
                // Named chunks, so the bundle budget can give each its own: without groups Rolldown splits the code the
                // entry shares with an area into a dozen small chunks named after a module each, which a refactor renames.
                // `admin-core`: everything the entry imports statically (admin.mjs is then a two-line stub that imports it);
                // `editor-shared`: what two or more areas share and the entry does not; `terra-draw`: both Terra Draw packages;
                // `admin-map`: the admin map's box and what it draws (the city's layers, photos and places), which the
                // layers, places, photos and settings areas show (DECISIONS-for-review.md §42a); `firebase-installations`:
                // the Firebase Installations SDK that the lazily loaded Analytics and Messaging SDKs share (M4's web push,
                // DECISIONS-for-review.md §54b), which would otherwise land in `editor-shared`.
                // `assist`: the editors' title suggestions and translation drafts (M4, the photo, place and layer editors share
                // them), kept out of `editor-shared` (DECISIONS-for-review.md §54b). `editor-texts`: a field's name and its
                // problem's words, which every editor shares (§77e). `starter-categories`: the starter place categories, which
                // the place editor and the settings share (§78d). `georef-badges`: shared pair painters and the map overlay (§146).
                // `georef-panes`: the georeferencer's panes, pair removal and the map pane's layers (§173).
                // `legacy-reads`: the tolerant reads of older records, which Home and the Imagery pages share (§155).
                // `funnels`: the wizards' funnel snapshots and the shared helper (§200).
                // M7's `worker` chunk is no group: the natural chunk of its one dynamic entry (`src/worker/worker.ts`), whose
                // namespace is the chunk's own (a group's needs Rolldown's runtime helper, a chunk of its own beside terra-draw's),
                // with its texts on a path of their own (`@hcm/shared/admin-worker`).
                codeSplitting: {
                    groups: [
                        { name: 'terra-draw', test: /node_modules[\\/]terra-draw/, priority: 4 },
                        { name: 'firebase-installations', test: /node_modules[\\/]@firebase[\\/]installations[\\/]/, priority: 2 },
                        { name: 'assist', test: ASSIST_MODULES, priority: 2 },
                        { name: 'georef-badges', test: GEOREF_BADGE_MODULES, priority: 2 },
                        { name: 'georef-panes', test: GEOREF_PANE_MODULES, priority: 2 },
                        { name: 'legacy-reads', test: LEGACY_READ_MODULES, priority: 2 },
                        { name: 'funnels', test: FUNNEL_MODULES, priority: 2 },
                        {
                            name: 'editor-texts',
                            test: (id: string) =>
                                [EDITOR_TEXT_MODULES, IMAGERY_SHARED_MODULES, IMAGERY_UI_SHARED_MODULES, MARKDOWN_MODULES].some((modules) =>
                                    modules.test(id),
                                ),
                            priority: 2,
                        },
                        { name: 'starter-categories', test: STARTER_MODULES, priority: 2 },
                        { name: 'proposal-fields', test: PROPOSAL_FIELD_MODULES, priority: 2 },
                        { name: 'admin-core', tags: ['$initial'], priority: 3 },
                        { name: 'admin-map', test: ADMIN_MAP_MODULES, priority: 2 },
                        { name: 'editor-shared', minShareCount: 2, priority: 1 },
                    ],
                },
            },
        },
    },
});
