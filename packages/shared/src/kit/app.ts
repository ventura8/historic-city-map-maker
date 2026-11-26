/**
 * `@hcm/shared/app`: the installable app (`docs/ENGINE_API.md` → *Installable app*): its web app manifest, its service
 * worker and the page script that registers it. Kept apart from `@hcm/shared` so the engine, which carries none of it,
 * never imports it.
 */
export * from './app-page.js';
export * from './app-update.js';
export * from './app-worker.js';
export * from './web-app-manifest.js';
