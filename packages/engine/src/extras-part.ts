/**
 * The side-loaded full-size view (docs/ENGINE_API.md → *Side-loaded parts*): its file beside the engine, and its
 * Subresource Integrity, which the engine's build writes here once the part is built (`lightboxPartPlugin`,
 * `packages/engine/vite.config.ts`). Empty in the sources and the tests: the script is then added without integrity.
 */
export const EXTRAS_PART_FILE = 'engine.extras.js';

export const EXTRAS_PART_INTEGRITY = '';
