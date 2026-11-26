// Generates a city theme: the four Material 3 `--md-sys-color-*` token sets (light, dark, high-contrast
// light and dark) of a seed colour, with @material/material-color-utilities (SpecVersion 2025, TonalSpot),
// as the `theme` object of the City Manifest v1. The logic is packages/ui/src/theme/dynamic-color.ts; this
// file only reads the arguments and writes JSON. Run with Node 24 in the quality image:
//
//     node packages/ui/scripts/gen-theme.mjs --seed '#8B5E3C' [--out theme.json]
//
// Without --out the JSON goes to stdout. Exit status: 0 written, 2 usage (missing or invalid seed).
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import process from 'node:process';
import { parseArgs } from 'node:util';

// Run the TypeScript sources directly (Node strips the types): their relative imports say `.js`
// (bundler style) and the colour library's ESM files omit extensions, so a failed relative resolve is
// retried with `.ts`, then with `.js` appended.
registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (!specifier.startsWith('.')) {
                throw error;
            }
            return nextResolve(specifier.endsWith('.js') ? `${specifier.slice(0, -3)}.ts` : `${specifier}.js`, context);
        }
    },
});

const { createLogger } = await import('../../shared/src/log.ts');
const { isHexColor, themeFromSeed } = await import('../src/theme/dynamic-color.ts');

const log = createLogger('gen-theme');

/** The CLI's options, or null after reporting a usage error. */
function readOptions(argv) {
    try {
        const { values } = parseArgs({ args: argv, options: { seed: { type: 'string' }, out: { type: 'string' } }, strict: true });
        if (values.seed === undefined || !isHexColor(values.seed)) {
            log.error('usage: gen-theme.mjs --seed <#rrggbb> [--out <file.json>]', { seed: values.seed ?? null });
            return null;
        }
        return { seed: values.seed, out: values.out };
    } catch (error) {
        log.error('usage: gen-theme.mjs --seed <#rrggbb> [--out <file.json>]', { reason: String(error) });
        return null;
    }
}

const options = readOptions(process.argv.slice(2));
if (options === null) {
    process.exitCode = 2;
} else {
    const json = `${JSON.stringify({ seedColor: options.seed, tokens: themeFromSeed(options.seed) }, null, 4)}\n`;
    if (options.out === undefined) {
        process.stdout.write(json);
    } else {
        writeFileSync(options.out, json, 'utf8');
        log.info('theme written', { seed: options.seed, out: options.out });
    }
}
