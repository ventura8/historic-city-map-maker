import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { cssLiteralsPlugin } from '../../scripts/site/src/css-literals.js';
import { KIT_ID, sidePartKitPlugin } from '../../scripts/site/src/side-part.js';

/**
 * The side-loaded full-size view (docs/ENGINE_API.md → *Side-loaded parts*): `.tsbuild/part/engine.extras.js`, an IIFE that
 * registers `<hcm-lightbox>`. Built before the engine (`npm run build`), whose build reads it, writes its integrity into
 * `src/extras-part.ts` and serves it beside `engine.iife.js` and `engine.mjs` (`vite.config.ts`). Only the element, its
 * zoom and its styles are the part's own: every other import (Lit, `@hcm/shared`, the viewer's helpers) reads the kit the
 * engine hands over as `globalThis.__hcmExtrasKit` (`packages/ui/src/viewer/extras-kit.ts`, `extras-loader.ts`).
 */
const VIEWER = fileURLToPath(new URL('../ui/src/viewer/', import.meta.url));
const OWN = new Set(
    ['extras-part.ts', 'hcm-lightbox.ts', 'lightbox-styles.ts', 'zoom.ts', 'map-menu.ts', 'hcm-about-dialog.ts', 'shortcuts-help.ts'].map(
        (file) => `${VIEWER}${file}`,
    ),
);

export default defineConfig({
    plugins: [cssLiteralsPlugin(), sidePartKitPlugin((id) => OWN.has(id))],
    build: {
        outDir: '.tsbuild/part',
        emptyOutDir: true,
        sourcemap: false,
        lib: {
            entry: `${VIEWER}extras-part.ts`,
            name: 'HistoricCityMapExtras',
            formats: ['iife'],
            fileName: () => 'engine.extras.js',
        },
        rolldownOptions: {
            external: [KIT_ID],
            output: { globals: { [KIT_ID]: '__hcmExtrasKit' }, minify: true },
        },
    },
});
