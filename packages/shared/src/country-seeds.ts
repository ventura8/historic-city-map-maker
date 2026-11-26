/**
 * M28 (`docs/research/M28-sources.md` §10): the curated country lists, as the entry `@hcm/shared/country-seeds`: only
 * `ops.tick` (and the tests and the local stack) read them, so the admin's bundle never carries them.
 */
export { COUNTRY_SEEDS } from './schemas/country-seeds.js';
export type { CountrySeed } from './schemas/country-seeds.js';
