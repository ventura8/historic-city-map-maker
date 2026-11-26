import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminTilesKey } from './ro.js';

export type { AdminTilesKey } from './ro.js';

/** The tile-import wizard's texts (`docs/research/M20-import-local.md` §19.11), fetched with the admin's `help` chunk only. */
export const translateAdminTiles = catalogueTranslator<AdminTilesKey>({ ro, en });
