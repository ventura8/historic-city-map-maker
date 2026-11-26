// Lets Node 24 run the repository's TypeScript directly (it strips the types): load with
//
//     node --import ./scripts/site/register-ts.mjs <file>.ts
//
// The sources write their relative imports bundler-style (`./html.js` for `html.ts`, docs/research/M0-handoff.md §5),
// so a relative import that does not resolve is retried with `.ts`. Used by the site build (scripts/site/build-site.ts)
// and by the e2e mock APIs, fixtures and site build (e2e/). The same hook as scripts/seed/migrate-legacy.mjs.
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (!specifier.startsWith('.') || !specifier.endsWith('.js')) {
                throw error;
            }
            return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
        }
    },
});
