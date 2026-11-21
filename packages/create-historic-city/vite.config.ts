import { cpSync, mkdirSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vite';

import { thirdPartyNoticesPlugin } from '../../scripts/site/src/notices.js';

/**
 * The CLI's build (docs/research/M5-interfaces.md §4.1): `cli.ts` and everything it imports (`@hcm/shared`, the colour
 * library of `@hcm/ui/dynamic-color`, zod) bundled into one ES module for Node 24, `dist/cli.mjs`, so the published
 * package has no runtime dependency; Node's built-ins stay imports. Beside it: the starter kit's three files
 * (`dist/template/`, copied from templates/starter-kit/ as committed, so a release's CLI scaffolds kits pinned to its
 * own engine) and `dist/THIRD_PARTY_NOTICES.txt` (scripts/site/src/notices.ts; the `notices` gate reads the source map).
 * The self-host bundle (`dist/self-host/`) is assembled afterwards by `npm run build:self-host` (build-self-host.ts).
 */
const TEMPLATE = '../../templates/starter-kit';

function kitTemplatePlugin(): Plugin {
    return {
        name: 'hcm-kit-template',
        closeBundle() {
            mkdirSync('dist/template', { recursive: true });
            for (const file of ['index.html', 'city.json', 'README.md']) {
                cpSync(`${TEMPLATE}/${file}`, `dist/template/${file}`);
            }
        },
    };
}

export default defineConfig({
    plugins: [thirdPartyNoticesPlugin({ product: 'create-historic-city (cli.mjs)' }), kitTemplatePlugin()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        ssr: 'cli.ts',
        target: 'node24',
        sourcemap: true,
        minify: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'cli.mjs', banner: '#!/usr/bin/env node' } },
    },
    ssr: { target: 'node', noExternal: true },
});
