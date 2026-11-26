// The TypeScript sources the seed scripts run directly (Node strips the types): their relative imports say `.js`
// (bundler style) and the colour library's ESM files omit extensions, so a failed relative resolve is retried with
// `.ts`, then with `.js` appended.
import { registerHooks } from 'node:module';

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

/** `@hcm/shared`, from its sources. */
export const shared = await import('../../packages/shared/src/index.ts');
