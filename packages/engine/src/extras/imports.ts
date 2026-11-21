/**
 * The engine's extras, each loaded the first time it is wanted (`loader.ts`; docs/ENGINE_API.md → *Extras on demand*).
 * As written here (the tests, a bundler that imports the sources) each is a dynamic import. Both engine builds replace
 * this module (`engineExtrasPlugin`, `scripts/site/src/engine-extras.ts`): there each loads `extra-<name>-<hash>.js` beside
 * the engine with its integrity, so none of them is part of `engine.iife.js` or `engine.mjs`. Every extra the build makes
 * is named in `packages/engine/vite.config.ts` with the same key.
 */
export const extraImports = {
    compare: () => import('../compare/compare.js'),
    gamepad: () => import('@hcm/ui/viewer/gamepad'),
    firebaseSdk: () => import('../telemetry/firebase-sdk.js'),
    fieldSdk: () => import('../telemetry/field-sdk.js'),
};
