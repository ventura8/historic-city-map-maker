import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';
import { uiCataloguesPlugin } from '../../scripts/site/src/ui-catalogues.js';
import { BUNDLED_LOCALES, UI_LOCALES } from '../shared/src/i18n/locales.js';

/**
 * The start page's build (`docs/research/M14-start-your-map.md`): one ES module, relative addresses so the tree works on any
 * static host, apart from the admin's folder and its budgets (row `start` of `scripts/ci/check_bundle_budget.py`). `e2e`
 * points the consent at the mock APIs' stand-in; the mode is a constant for the bundler, so production carries neither.
 */
export default defineConfig({
    base: './',
    plugins: [
        cssLiteralsPlugin(),
        // The start page's own texts and the API's errors in the languages it fetches when chosen (docs/I18N.md → Loading).
        uiCataloguesPlugin({
            root: fileURLToPath(new URL('../shared/src/i18n', import.meta.url)),
            locales: UI_LOCALES.filter((locale) => !BUNDLED_LOCALES.includes(locale)),
            families: ['start', 'api'],
        }),
    ],
    build: {
        outDir: '../../dist/start-app',
        emptyOutDir: true,
        minify: true,
        sourcemap: false,
        lib: { entry: 'src/start/index.ts', formats: ['es'], fileName: () => 'start.mjs' },
    },
});
